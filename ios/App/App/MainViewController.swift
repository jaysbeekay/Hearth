import Capacitor
import UIKit

// ServerConfigPlugin is local to the app target (not an npm package), so it
// isn't in capacitor.config.json's auto-registered packageClassList — it has
// to be registered manually. capacitorDidLoad() is Capacitor's documented
// hook for this: it runs after `bridge` exists but before the webview loads
// its first URL.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(ServerConfigPlugin())
    }

    // By default Capacitor opens any toplevel navigation to an external host
    // in Safari instead of the WebView (WebViewDelegationHandler.decidePolicyFor),
    // unless that host is in allowedNavigationHostnames — see
    // CAPInstanceConfiguration.shouldAllowNavigation. That list is static
    // config baked in at bridge-creation time, but our server address is only
    // known at runtime, so we inject it here rather than allow-listing "*"
    // (which would let any site the WebView ever loads call native plugins —
    // including certificate import — not just the user's own server).
    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        if let saved = UserDefaults.standard.string(forKey: ServerConfigPlugin.serverUrlDefaultsKey),
           let host = URL(string: saved)?.host {
            descriptor.allowedNavigationHostnames += [host]
        }
        return descriptor
    }

    // allowedNavigationHostnames is read once into the bridge's (readonly)
    // configuration when this view controller's loadView() runs, so it can't
    // be updated for an already-running bridge. Saving a new server URL
    // therefore needs a fresh MainViewController — instanceDescriptor() above
    // will then pick up the new host — rather than just navigating the
    // existing WebView.
    static func reloadForUpdatedServerUrl() {
        guard let window = (UIApplication.shared.delegate as? AppDelegate)?.window else { return }
        window.rootViewController = MainViewController()
    }
}
