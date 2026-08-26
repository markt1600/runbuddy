import Capacitor
import AuthenticationServices
import AVFoundation
import CoreLocation
import CryptoKit
import HealthKit
import Photos
import UIKit

// The native layer the WebView cannot provide for itself:
//
// AUDIO — a real AVAudioSession plus a real AVAudioPlayer. WebKit force-pauses
// every media element in the page the moment the screen locks and refuses new
// play() calls while backgrounded, so the coach's voice cannot live in the
// WebView on a locked phone. Instead the web layer hands each clip (or its
// URL) to play(), which decodes it into an AVAudioPlayer on the app's session
// — exempt from WebKit's policy, happy to start mid-lock. The session is
// .playback + .mixWithOthers (with the "audio" background mode) so Spotify
// keeps running; keepAliveStart() loops a near-silent buffer so the app keeps
// its background-audio claim between phrases even on a treadmill run with no
// GPS. For a speech burst, duckStart() re-activates the session with
// .duckOthers — the system softens other audio — and duckEnd() deactivates
// with .notifyOthersOnDeactivation so the music comes back up.
//
// LOCATION — a CLLocationManager with allowsBackgroundLocationUpdates, so GPS
// fixes keep flowing while the phone is locked or in an armband. Fixes stream
// to JS as "location" events shaped like the web Geolocation API, and the
// same GeoTracker consumes them.

@objc(RunBuddyNativePlugin)
public class RunBuddyNativePlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate,
    AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate, ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "RunBuddyNativePlugin"
    public let jsName = "RunBuddyNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configureAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "duckStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "duckEnd", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopPlayback", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepAliveStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepAliveStop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startLocation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopLocation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "healthAuthorize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "healthRunSummary", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveToPhotos", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "haptic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prefetchAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cacheStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appleSignIn", returnType: CAPPluginReturnPromise),
    ]

    private var locationManager: CLLocationManager?
    private var locationRunning = false
    private var pendingStart = false

    private var voicePlayer: AVAudioPlayer?
    private var voiceCall: CAPPluginCall?
    private var keepAlivePlayer: AVAudioPlayer?

    override public func load() {
        // A phone call or Siri tears the session down; when the interruption
        // ends, put it back so the keep-alive claim (and the run) survives.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleInterruption(_:)),
            name: AVAudioSession.interruptionNotification,
            object: nil
        )
    }

    @objc private func handleInterruption(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
        DispatchQueue.main.async {
            try? self.activateMixing()
            self.resumeKeepAlive()
        }
    }

    // ---- Audio session ----

    private func activateMixing() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try session.setActive(true)
    }

    private func resumeKeepAlive() {
        if let k = keepAlivePlayer, !k.isPlaying { k.play() }
    }

    @objc func configureAudio(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do {
                try self.activateMixing()
                call.resolve()
            } catch {
                call.reject("audio session unavailable: \(error.localizedDescription)")
            }
        }
    }

    @objc func duckStart(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let session = AVAudioSession.sharedInstance()
            // Deactivation fails while anything of ours is still playing, and
            // category options only apply on activation — so pause the loop,
            // bounce the session with .duckOthers, then resume the loop.
            self.keepAlivePlayer?.pause()
            do {
                try session.setActive(false)
                try session.setCategory(.playback, mode: .default, options: [.duckOthers])
                try session.setActive(true)
            } catch {
                // Speech still plays without the duck — never block the coach.
            }
            self.resumeKeepAlive()
            call.resolve()
        }
    }

    @objc func duckEnd(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let session = AVAudioSession.sharedInstance()
            self.keepAlivePlayer?.pause()
            do {
                try session.setActive(false, options: [.notifyOthersOnDeactivation])
            } catch {
                // A busy session refuses deactivation now and then; carry on.
            }
            do {
                try self.activateMixing()
            } catch {
                // Worst case the next configureAudio/duckStart re-establishes it.
            }
            self.resumeKeepAlive()
            call.resolve()
        }
    }

    // ---- Voice playback ----

    // Downloaded phrase files live in Caches keyed by the URL's SHA-256 —
    // the pre-rendered library keeps talking through dead zones, and the OS
    // may purge the folder under pressure, which is exactly right for
    // re-downloadable audio.
    private func cachePath(for url: String) -> URL? {
        guard let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
        else { return nil }
        let dir = base.appendingPathComponent("voice-cache", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let digest = SHA256.hash(data: Data(url.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        return dir.appendingPathComponent(digest + ".mp3")
    }

    @objc func play(_ call: CAPPluginCall) {
        let volume = Float(call.getDouble("volume") ?? 1.0)
        if let b64 = call.getString("data") {
            guard let data = Data(base64Encoded: b64) else {
                call.reject("bad audio data")
                return
            }
            startPlayback(data: data, volume: volume, call: call)
        } else if let urlStr = call.getString("url"), let url = URL(string: urlStr) {
            if let cached = cachePath(for: urlStr), let data = try? Data(contentsOf: cached) {
                startPlayback(data: data, volume: volume, call: call)
                return
            }
            URLSession.shared.dataTask(with: url) { data, _, err in
                if let data = data, err == nil {
                    if let cached = self.cachePath(for: urlStr) {
                        try? data.write(to: cached) // offline next time
                    }
                    self.startPlayback(data: data, volume: volume, call: call)
                } else {
                    call.reject("fetch failed: \(err?.localizedDescription ?? "no data")")
                }
            }.resume()
        } else {
            call.reject("play needs url or data")
        }
    }

    /**
     * Warm the cache with every URL not already on disk. Resolves with the
     * count immediately; downloads run sequentially on a utility queue so
     * pre-run warming never competes with the run itself for bandwidth.
     */
    private static let prefetchQueue = DispatchQueue(label: "runbuddy.voicecache", qos: .utility)

    /** How much of this URL set is already on disk — the progress readout. */
    @objc func cacheStatus(_ call: CAPPluginCall) {
        let urls = call.getArray("urls", String.self) ?? []
        var cached = 0
        for raw in urls.prefix(500) {
            if let path = cachePath(for: raw), FileManager.default.fileExists(atPath: path.path) {
                cached += 1
            }
        }
        call.resolve(["cached": cached, "total": min(urls.count, 500)])
    }

    @objc func prefetchAudio(_ call: CAPPluginCall) {
        let urls = call.getArray("urls", String.self) ?? []
        var missing: [(String, URL)] = []
        for raw in urls.prefix(500) {
            guard let parsed = URL(string: raw), let path = cachePath(for: raw) else { continue }
            if !FileManager.default.fileExists(atPath: path.path) {
                missing.append((raw, parsed))
            }
        }
        call.resolve(["queued": missing.count])
        guard !missing.isEmpty else { return }
        Self.prefetchQueue.async {
            let gate = DispatchSemaphore(value: 0)
            for (raw, url) in missing {
                URLSession.shared.dataTask(with: url) { data, _, _ in
                    if let data = data, !data.isEmpty, let path = self.cachePath(for: raw) {
                        try? data.write(to: path)
                    }
                    gate.signal()
                }.resume()
                gate.wait()
            }
        }
    }

    /**
     * Real gain for quiet voices: AVAudioPlayer.volume tops out at 1.0, so a
     * level above 1 is applied to the decoded samples instead (hard-clamped to
     * full scale). Some ElevenLabs voices render much quieter than others, and
     * this is the only way to lift one at play time. Returns CAF data ready
     * for AVAudioPlayer, or nil to fall back to unamplified playback.
     */
    private func amplified(_ data: Data, gain: Float) -> Data? {
        let tmp = FileManager.default.temporaryDirectory
        let inUrl = tmp.appendingPathComponent(UUID().uuidString + ".mp3")
        let outUrl = tmp.appendingPathComponent(UUID().uuidString + ".caf")
        defer {
            try? FileManager.default.removeItem(at: inUrl)
            try? FileManager.default.removeItem(at: outUrl)
        }
        do {
            try data.write(to: inUrl)
            let file = try AVAudioFile(forReading: inUrl)
            let format = file.processingFormat
            guard file.length > 0,
                  let buf = AVAudioPCMBuffer(
                      pcmFormat: format,
                      frameCapacity: AVAudioFrameCount(file.length)
                  )
            else { return nil }
            try file.read(into: buf)
            guard let channels = buf.floatChannelData else { return nil }
            for ch in 0..<Int(format.channelCount) {
                let samples = channels[ch]
                for i in 0..<Int(buf.frameLength) {
                    samples[i] = max(-1, min(1, samples[i] * gain))
                }
            }
            // Scoped so the writer deinits (flushing the file) before read-back.
            do {
                let out = try AVAudioFile(forWriting: outUrl, settings: format.settings)
                try out.write(from: buf)
            }
            return try Data(contentsOf: outUrl)
        } catch {
            return nil
        }
    }

    private func startPlayback(data: Data, volume: Float, call: CAPPluginCall) {
        // Amplification decodes and rewrites the clip — keep that off the main
        // thread. Lines are a few seconds long, so this is milliseconds.
        var playData = data
        var playVolume = volume
        var hint: String? = nil
        if volume > 1.01, let boosted = amplified(data, gain: volume) {
            playData = boosted
            playVolume = 1.0
            hint = AVFileType.caf.rawValue
        }
        DispatchQueue.main.async {
            // The web queue plays strictly one line at a time, but never leave
            // a superseded call's promise hanging if it ever doubles up.
            self.voicePlayer?.stop()
            self.voiceCall?.resolve()
            do {
                let p = try AVAudioPlayer(data: playData, fileTypeHint: hint)
                p.delegate = self
                p.volume = min(playVolume, 1.0)
                self.voicePlayer = p
                self.voiceCall = call
                if !p.play() {
                    self.voicePlayer = nil
                    self.voiceCall = nil
                    call.reject("player refused to start")
                }
            } catch {
                call.reject("audio decode failed: \(error.localizedDescription)")
            }
        }
    }

    public func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didFinish utterance: AVSpeechUtterance
    ) {
        DispatchQueue.main.async {
            self.speakCall?.resolve()
            self.speakCall = nil
        }
    }

    public func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didCancel utterance: AVSpeechUtterance
    ) {
        DispatchQueue.main.async {
            self.speakCall?.resolve()
            self.speakCall = nil
        }
    }

    public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        DispatchQueue.main.async {
            guard player === self.voicePlayer else { return }
            let call = self.voiceCall
            self.voicePlayer = nil
            self.voiceCall = nil
            if flag { call?.resolve() } else { call?.reject("playback failed") }
        }
    }

    @objc func stopPlayback(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.voicePlayer?.stop()
            // Resolve, not reject: the engine is tearing down and must not
            // trip the caller's synth fallback on its way out.
            self.voiceCall?.resolve()
            self.voicePlayer = nil
            self.voiceCall = nil
            self.speechSynth?.stopSpeaking(at: .immediate)
            self.speakCall?.resolve()
            self.speakCall = nil
            call.resolve()
        }
    }

    // ---- Native speech synthesis (the fallback voice) ----
    //
    // When a phrase has no rendered recording (or its download fails), the
    // web layer falls back to text-to-speech — but WebKit's speechSynthesis
    // is suspended while the screen is locked, which turned every fallback
    // into silence mid-run. AVSpeechSynthesizer sits on the app's audio
    // session like the AVAudioPlayer does, so the robot voice survives the
    // lock screen too.

    private var speechSynth: AVSpeechSynthesizer?
    private var speakCall: CAPPluginCall?

    @objc func speak(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else {
            call.reject("text required")
            return
        }
        let rate = Float(call.getDouble("rate") ?? 1.0)
        let pitch = Float(call.getDouble("pitch") ?? 1.0)
        let lang = call.getString("lang") ?? "en-US"
        DispatchQueue.main.async {
            if self.speechSynth == nil {
                let s = AVSpeechSynthesizer()
                s.delegate = self
                self.speechSynth = s
            }
            self.speakCall?.resolve() // never leave a superseded promise hanging
            self.speakCall = call
            let u = AVSpeechUtterance(string: text)
            u.voice = AVSpeechSynthesisVoice(language: lang)
                ?? AVSpeechSynthesisVoice(language: "en-US")
            // Web rate 1.0 ≈ the platform default; scale around it.
            u.rate = min(max(AVSpeechUtteranceDefaultSpeechRate * rate, 0.1), 0.7)
            u.pitchMultiplier = min(max(pitch, 0.5), 2.0)
            self.speechSynth?.speak(u)
        }
    }

    // ---- Background keep-alive ----

    /** One second of near-silent (amplitude 1 of 32767) 8kHz mono WAV. */
    private func silentWavData() -> Data {
        let rate = 8000
        let n = rate
        var data = Data(capacity: 44 + n * 2)
        func str(_ s: String) { data.append(s.data(using: .ascii)!) }
        func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) } }
        func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) } }
        str("RIFF"); u32(UInt32(36 + n * 2)); str("WAVE")
        str("fmt "); u32(16); u16(1); u16(1)
        u32(UInt32(rate)); u32(UInt32(rate * 2)); u16(2); u16(16)
        str("data"); u32(UInt32(n * 2))
        for i in 0..<n { u16(UInt16(bitPattern: Int16(i % 2))) }
        return data
    }

    @objc func keepAliveStart(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.keepAlivePlayer == nil {
                let p = try? AVAudioPlayer(
                    data: self.silentWavData(),
                    fileTypeHint: AVFileType.wav.rawValue
                )
                p?.numberOfLoops = -1
                self.keepAlivePlayer = p
            }
            self.keepAlivePlayer?.play()
            call.resolve()
        }
    }

    @objc func keepAliveStop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.keepAlivePlayer?.stop()
            self.keepAlivePlayer = nil
            call.resolve()
        }
    }

    // ---- Sign in with Apple ----
    //
    // The native sheet (Face ID, no browser) — the flow Apple requires of an
    // app that offers Google sign-in, and the nicest one anyway. The web
    // layer sends the identity token to /api/auth/apple, which verifies it
    // against Apple's published keys and mints the same session cookie the
    // Google flow does. Name and email only arrive on the very first
    // authorization; the server keeps them from then on.

    private var appleCall: CAPPluginCall?

    @objc func appleSignIn(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.appleCall = call
            controller.performRequests()
        }
    }

    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        defer { appleCall = nil }
        guard let cred = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = cred.identityToken,
              let token = String(data: tokenData, encoding: .utf8) else {
            appleCall?.reject("no identity token")
            return
        }
        var result: [String: Any] = ["identityToken": token]
        let name = [cred.fullName?.givenName, cred.fullName?.familyName]
            .compactMap { $0 }
            .joined(separator: " ")
        if !name.isEmpty { result["name"] = name }
        if let email = cred.email { result["email"] = email }
        appleCall?.resolve(result)
    }

    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        appleCall?.reject("cancelled")
        appleCall = nil
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return bridge?.webView?.window ?? ASPresentationAnchor()
    }

    // ---- Haptics ----
    //
    // The web Vibration API doesn't exist on iOS at all, so in the shell the
    // phone can finally buzz: pause/resume edges, km splits, record moments.

    @objc func haptic(_ call: CAPPluginCall) {
        let kind = call.getString("kind") ?? "medium"
        DispatchQueue.main.async {
            switch kind {
            case "tap":
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            case "heavy":
                UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
            case "success":
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "warning":
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
            default:
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            }
            call.resolve()
        }
    }

    // ---- Photo library (add-only) ----

    /**
     * Save one PNG (the run card) straight into the photo library. Uses the
     * add-only authorization level, so the permission sheet says "add photos"
     * and the app can never read or see the library.
     */
    @objc func saveToPhotos(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"),
              let data = Data(base64Encoded: b64),
              let image = UIImage(data: data) else {
            call.reject("bad image data")
            return
        }
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                call.reject("photos permission denied")
                return
            }
            PHPhotoLibrary.shared().performChanges({
                PHAssetChangeRequest.creationRequestForAsset(from: image)
            }) { ok, err in
                if ok {
                    call.resolve()
                } else {
                    call.reject("save failed: \(err?.localizedDescription ?? "unknown")")
                }
            }
        }
    }

    // ---- Apple Health (read-only) ----
    //
    // The app never writes to Health and never changes how it records runs.
    // After a run, the summary screen asks what Health saw over the same
    // window — a Watch workout, heart rate, Health's own distance — purely
    // for display. HealthKit hides read-permission state by design, so an
    // undenied-but-empty answer and a denied one look identical: no data.

    private lazy var healthStore = HKHealthStore()

    private func healthReadTypes() -> Set<HKObjectType> {
        var types: Set<HKObjectType> = [HKObjectType.workoutType()]
        for id in [HKQuantityTypeIdentifier.heartRate, .distanceWalkingRunning, .activeEnergyBurned] {
            if let t = HKQuantityType.quantityType(forIdentifier: id) { types.insert(t) }
        }
        return types
    }

    @objc func healthAuthorize(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["available": false])
            return
        }
        healthStore.requestAuthorization(toShare: nil, read: healthReadTypes()) { _, _ in
            call.resolve(["available": true])
        }
    }

    @objc func healthRunSummary(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["available": false])
            return
        }
        guard let sinceMs = call.getDouble("sinceMs"),
              let untilMs = call.getDouble("untilMs"),
              untilMs > sinceMs else {
            call.reject("healthRunSummary needs sinceMs < untilMs")
            return
        }
        let since = Date(timeIntervalSince1970: sinceMs / 1000.0)
        let until = Date(timeIntervalSince1970: untilMs / 1000.0)
        // No strict options: anything OVERLAPPING the run window counts, so a
        // Watch workout started a minute before ours still shows up.
        let window = HKQuery.predicateForSamples(withStart: since, end: until)

        var result: [String: Any] = ["available": true]
        let lock = NSLock()
        func put(_ key: String, _ value: Any) {
            lock.lock()
            result[key] = value
            lock.unlock()
        }
        let group = DispatchGroup()

        // An Apple Watch is the wearable of record here: when both it and
        // another tracker (WHOOP, a ring) logged the same run, the Watch's
        // workout wins, and the sample queries below are restricted to the
        // same device so its numbers aren't polluted by a second stream.
        func isWatch(_ w: HKWorkout) -> Bool {
            if w.sourceRevision.productType?.hasPrefix("Watch") == true { return true }
            return w.sourceRevision.source.name.localizedCaseInsensitiveContains("apple watch")
        }

        // The workout first — its source decides how the rest is filtered.
        group.enter()
        let workoutQuery = HKSampleQuery(
            sampleType: .workoutType(),
            predicate: window,
            limit: 10,
            sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
        ) { _, samples, _ in
            let workouts = (samples as? [HKWorkout]) ?? []
            put("workoutCount", workouts.count)
            let running = workouts.filter { $0.workoutActivityType == .running }
            let chosen = running.first(where: isWatch)
                ?? workouts.first(where: isWatch)
                ?? running.first
                ?? workouts.first
            var samplePredicate = window
            if let w = chosen {
                var info: [String: Any] = [
                    "activity": w.workoutActivityType == .running ? "Running" : "Workout",
                    "source": w.sourceRevision.source.name,
                    "startMs": w.startDate.timeIntervalSince1970 * 1000.0,
                    "endMs": w.endDate.timeIntervalSince1970 * 1000.0,
                    "durationSec": w.duration,
                ]
                if #available(iOS 16.0, *) {
                    if let d = w.statistics(for: HKQuantityType(.distanceWalkingRunning))?.sumQuantity() {
                        info["distanceKm"] = d.doubleValue(for: .meter()) / 1000.0
                    }
                    if let e = w.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity() {
                        info["calories"] = e.doubleValue(for: .kilocalorie())
                    }
                }
                put("workout", info)
                if isWatch(w) {
                    put("statsSource", w.sourceRevision.source.name)
                    samplePredicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
                        window,
                        HKQuery.predicateForObjects(from: [w.sourceRevision.source]),
                    ])
                }
            }
            // Sub-queries enter the group before the workout query leaves it,
            // so the notify below can't fire between them.
            self.runHealthSampleQueries(predicate: samplePredicate, group: group, put: put)
            group.leave()
        }
        healthStore.execute(workoutQuery)

        group.notify(queue: .main) {
            call.resolve(result)
        }
    }

    /** HR stats + sample count + distance sum, under the given predicate. */
    private func runHealthSampleQueries(
        predicate: NSPredicate,
        group: DispatchGroup,
        put: @escaping (String, Any) -> Void
    ) {
        if let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate) {
            group.enter()
            let hrStats = HKStatisticsQuery(
                quantityType: hrType,
                quantitySamplePredicate: predicate,
                options: [.discreteAverage, .discreteMin, .discreteMax]
            ) { _, stats, _ in
                defer { group.leave() }
                guard let stats = stats else { return }
                let bpm = HKUnit.count().unitDivided(by: .minute())
                var hr: [String: Any] = [:]
                if let a = stats.averageQuantity() { hr["avg"] = a.doubleValue(for: bpm) }
                if let lo = stats.minimumQuantity() { hr["min"] = lo.doubleValue(for: bpm) }
                if let hi = stats.maximumQuantity() { hr["max"] = hi.doubleValue(for: bpm) }
                if !hr.isEmpty { put("heartRate", hr) }
            }
            healthStore.execute(hrStats)

            group.enter()
            let hrCount = HKSampleQuery(
                sampleType: hrType, predicate: predicate,
                limit: HKObjectQueryNoLimit, sortDescriptors: nil
            ) { _, samples, _ in
                defer { group.leave() }
                if let s = samples, !s.isEmpty { put("heartRateSamples", s.count) }
            }
            healthStore.execute(hrCount)
        }

        // Health's distance over the window. Under a Watch source filter this
        // IS the Watch's record; unfiltered, the statistics sum still applies
        // the Health app's own source de-duplication.
        if let dType = HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning) {
            group.enter()
            let distSum = HKStatisticsQuery(
                quantityType: dType,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum
            ) { _, stats, _ in
                defer { group.leave() }
                if let s = stats?.sumQuantity() {
                    put("distanceKm", s.doubleValue(for: .meter()) / 1000.0)
                }
            }
            healthStore.execute(distSum)
        }
    }

    // ---- Background location ----

    private func manager() -> CLLocationManager {
        if let m = locationManager { return m }
        let m = CLLocationManager()
        m.delegate = self
        m.desiredAccuracy = kCLLocationAccuracyBest
        m.distanceFilter = kCLDistanceFilterNone
        m.activityType = .fitness
        m.pausesLocationUpdatesAutomatically = false
        m.showsBackgroundLocationIndicator = true
        locationManager = m
        return m
    }

    private func beginUpdates(_ m: CLLocationManager) {
        m.allowsBackgroundLocationUpdates = true
        m.startUpdatingLocation()
        locationRunning = true
    }

    @objc func startLocation(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let m = self.manager()
            switch m.authorizationStatus {
            case .authorizedWhenInUse, .authorizedAlways:
                self.beginUpdates(m)
            case .notDetermined:
                self.pendingStart = true
                m.requestWhenInUseAuthorization()
            default:
                self.notifyListeners("locationError", data: [
                    "message": "Location permission denied",
                    "denied": true,
                ])
            }
            call.resolve()
        }
    }

    @objc func stopLocation(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.locationManager?.stopUpdatingLocation()
            self.locationRunning = false
            self.pendingStart = false
            call.resolve()
        }
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            if pendingStart {
                pendingStart = false
                beginUpdates(manager)
            }
        case .denied, .restricted:
            pendingStart = false
            notifyListeners("locationError", data: [
                "message": "Location permission denied",
                "denied": true,
            ])
        default:
            break
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard locationRunning else { return }
        for loc in locations {
            notifyListeners("location", data: [
                "latitude": loc.coordinate.latitude,
                "longitude": loc.coordinate.longitude,
                "accuracy": loc.horizontalAccuracy,
                // -1 = no Doppler solution, same convention the web layer maps
                "speed": loc.speed,
                "timestamp": loc.timestamp.timeIntervalSince1970 * 1000.0,
            ])
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let denied = (error as? CLError)?.code == .denied
        notifyListeners("locationError", data: [
            "message": error.localizedDescription,
            "denied": denied,
        ])
    }
}

// The plugin's real registration is the "RunBuddyNativePlugin" entry in
// capacitor.config.json's packageClassList — the same static path AppPlugin
// and CAPBrowserPlugin use, which bakes the plugin into the bridge script
// before the remote page loads. This subclass remains because the storyboard
// names it; its instance registration is only a fallback for a build whose
// bundled config predates that entry.
@objc(AppViewController)
class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        if bridge?.plugin(withName: "RunBuddyNative") == nil {
            bridge?.registerPluginInstance(RunBuddyNativePlugin())
        }
    }
}
