import Capacitor
import Foundation
import WebKit

/// The route a Siri intent asked for, held in memory only. It is read once
/// and cleared, never persisted, so it can't fire on a later launch. A route
/// nobody picks up within `lifetime` is dropped: when the app isn't ready
/// (mode picker, paywall, unreachable server, a form with unsaved input) the
/// shortcut just opens the app, with no retry or queue.
///
/// Only touched on the main thread: intents' perform() is @MainActor and the
/// plugin hops to the main queue.
enum PendingRoute {
    static let lifetime: TimeInterval = 15

    private static var route: HearthRoute?
    private static var setAt: Date?

    static func set(_ newRoute: HearthRoute) {
        route = newRoute
        setAt = Date()
        IntentsPlugin.current?.routeArrived()
    }

    /// Returns the pending route, if still fresh, and clears it either way.
    static func take() -> HearthRoute? {
        defer {
            route = nil
            setAt = nil
        }
        guard let pending = route, let time = setAt, Date().timeIntervalSince(time) < lifetime else { return nil }
        return pending
    }
}

/// Hands a Siri route to whichever side can open it.
///
/// Connected mode: once the WebView is on the user's server, app.js isn't
/// running, so this navigates the WebView itself to server URL + route path.
/// On a cold launch the WebView is still on the local shell, and app.js picks
/// the route up in autoConnectIfSaved() before it navigates.
///
/// Standalone mode: app.js calls consumePendingRoute() after standalone opens
/// on launch, on resume, and on the `pendingRoute` event.
@objc(IntentsPlugin)
public class IntentsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "IntentsPlugin"
    public let jsName = "Intents"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "consumePendingRoute", returnType: CAPPluginReturnPromise)
    ]

    /// The live bridge's instance. MainViewController.reloadForUpdatedServerUrl()
    /// replaces the bridge, and the new instance takes over in load().
    static weak var current: IntentsPlugin?

    public override func load() {
        Self.current = self
    }

    @objc func consumePendingRoute(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let route = PendingRoute.take() else {
                call.resolve([:])
                return
            }
            call.resolve(["route": route.rawValue, "path": route.serverPath])
        }
    }

    /// Main thread only (called from PendingRoute.set).
    func routeArrived() {
        if navigateConnectedWebView() { return }
        notifyListeners("pendingRoute", data: [:])
    }

    /// If the WebView is showing the saved server, opens the route there and
    /// returns true. Returns false when the WebView is on the local shell
    /// (mode picker, standalone, paywall, connect screen or the unreachable
    /// server fallback), so app.js decides.
    private func navigateConnectedWebView() -> Bool {
        guard let webView = bridge?.webView,
              let current = webView.url,
              current.scheme == "https" || current.scheme == "http",
              let saved = UserDefaults.standard.string(forKey: ServerConfigPlugin.serverUrlDefaultsKey),
              let server = URL(string: saved),
              server.scheme == current.scheme,
              server.host?.lowercased() == current.host?.lowercased(),
              server.port == current.port else {
            return false
        }
        guard let route = PendingRoute.take(),
              var components = URLComponents(url: server, resolvingAgainstBaseURL: false) else {
            return true
        }
        let basePath = components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path
        components.path = basePath + route.serverPath
        components.query = nil
        components.fragment = nil
        guard let destination = components.url else { return true }
        webView.load(URLRequest(url: destination))
        return true
    }
}
