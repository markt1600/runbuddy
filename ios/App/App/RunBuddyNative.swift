import Capacitor
import AVFoundation
import CoreLocation
import HealthKit
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
public class RunBuddyNativePlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate, AVAudioPlayerDelegate {
    public let identifier = "RunBuddyNativePlugin"
    public let jsName = "RunBuddyNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configureAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "duckStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "duckEnd", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopPlayback", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepAliveStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepAliveStop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startLocation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopLocation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "healthAuthorize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "healthRunSummary", returnType: CAPPluginReturnPromise),
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

    @objc func play(_ call: CAPPluginCall) {
        let volume = Float(call.getDouble("volume") ?? 1.0)
        if let b64 = call.getString("data") {
            guard let data = Data(base64Encoded: b64) else {
                call.reject("bad audio data")
                return
            }
            startPlayback(data: data, volume: volume, call: call)
        } else if let urlStr = call.getString("url"), let url = URL(string: urlStr) {
            URLSession.shared.dataTask(with: url) { data, _, err in
                if let data = data, err == nil {
                    self.startPlayback(data: data, volume: volume, call: call)
                } else {
                    call.reject("fetch failed: \(err?.localizedDescription ?? "no data")")
                }
            }.resume()
        } else {
            call.reject("play needs url or data")
        }
    }

    private func startPlayback(data: Data, volume: Float, call: CAPPluginCall) {
        DispatchQueue.main.async {
            // The web queue plays strictly one line at a time, but never leave
            // a superseded call's promise hanging if it ever doubles up.
            self.voicePlayer?.stop()
            self.voiceCall?.resolve()
            do {
                let p = try AVAudioPlayer(data: data)
                p.delegate = self
                p.volume = volume
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
            call.resolve()
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

        // The workout Health recorded over our window — prefer a run.
        group.enter()
        let workoutQuery = HKSampleQuery(
            sampleType: .workoutType(),
            predicate: window,
            limit: 10,
            sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
        ) { _, samples, _ in
            defer { group.leave() }
            let workouts = (samples as? [HKWorkout]) ?? []
            put("workoutCount", workouts.count)
            guard let w = workouts.first(where: { $0.workoutActivityType == .running }) ?? workouts.first
            else { return }
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
        }
        healthStore.execute(workoutQuery)

        if let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate) {
            group.enter()
            let hrStats = HKStatisticsQuery(
                quantityType: hrType,
                quantitySamplePredicate: window,
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
                sampleType: hrType, predicate: window,
                limit: HKObjectQueryNoLimit, sortDescriptors: nil
            ) { _, samples, _ in
                defer { group.leave() }
                if let s = samples, !s.isEmpty { put("heartRateSamples", s.count) }
            }
            healthStore.execute(hrCount)
        }

        // Health's own distance over the window: a statistics sum applies the
        // Health app's source de-duplication, so Watch + iPhone don't double.
        if let dType = HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning) {
            group.enter()
            let distSum = HKStatisticsQuery(
                quantityType: dType,
                quantitySamplePredicate: window,
                options: .cumulativeSum
            ) { _, stats, _ in
                defer { group.leave() }
                if let s = stats?.sumQuantity() {
                    put("distanceKm", s.doubleValue(for: .meter()) / 1000.0)
                }
            }
            healthStore.execute(distSum)
        }

        group.notify(queue: .main) {
            call.resolve(result)
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
