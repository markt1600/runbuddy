import Capacitor
import AVFAudio
import CoreLocation
import UIKit

// The native layer the WebView cannot provide for itself:
//
// AUDIO — a real AVAudioSession. Configured .playback + .mixWithOthers so the
// coach's audio keeps playing with the screen locked (with the "audio"
// background mode) while Spotify keeps running at full volume. For a speech
// burst, duckStart() re-activates the session with .duckOthers — the system
// softens other audio — and duckEnd() deactivates with
// .notifyOthersOnDeactivation so the music comes back up, then restores the
// mixing session. This replaces the web audioSession workaround, which
// WKWebView doesn't support anyway.
//
// LOCATION — a CLLocationManager with allowsBackgroundLocationUpdates, so GPS
// fixes keep flowing while the phone is locked or in an armband. Fixes stream
// to JS as "location" events shaped like the web Geolocation API, and the
// same GeoTracker consumes them.

@objc(RunBuddyNativePlugin)
public class RunBuddyNativePlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "RunBuddyNativePlugin"
    public let jsName = "RunBuddyNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configureAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "duckStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "duckEnd", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startLocation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopLocation", returnType: CAPPluginReturnPromise),
    ]

    private var locationManager: CLLocationManager?
    private var locationRunning = false
    private var pendingStart = false

    // ---- Audio session ----

    private func activateMixing() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try session.setActive(true)
    }

    @objc func configureAudio(_ call: CAPPluginCall) {
        do {
            try activateMixing()
            call.resolve()
        } catch {
            call.reject("audio session unavailable: \(error.localizedDescription)")
        }
    }

    @objc func duckStart(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        do {
            // Category options only apply on activation, so bounce the session.
            try session.setActive(false)
            try session.setCategory(.playback, mode: .default, options: [.duckOthers])
            try session.setActive(true)
            call.resolve()
        } catch {
            // Speech still plays without the duck — never block the coach.
            call.resolve()
        }
    }

    @objc func duckEnd(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setActive(false, options: [.notifyOthersOnDeactivation])
        } catch {
            // A busy session refuses deactivation now and then; carry on.
        }
        do {
            try activateMixing()
        } catch {
            // Worst case the next configureAudio/duckStart re-establishes it.
        }
        call.resolve()
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

// The storyboard instantiates this instead of the stock bridge controller so
// the plugin above is registered before the web app loads.
@objc(AppViewController)
class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(RunBuddyNativePlugin())
    }
}
