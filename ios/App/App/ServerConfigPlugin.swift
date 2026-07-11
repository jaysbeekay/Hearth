import Foundation
import Capacitor

@objc(ServerConfigPlugin)
public class ServerConfigPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ServerConfigPlugin"
    public let jsName = "ServerConfig"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getServerUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setServerUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearServerUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "importClientCertificate", returnType: CAPPluginReturnPromise)
    ]

    // Shared with Settings.bundle (root.plist) so the server address can also
    // be changed from iOS Settings > Hearth, not just the in-app form.
    static let serverUrlDefaultsKey = "server_url"

    @objc func getServerUrl(_ call: CAPPluginCall) {
        call.resolve(["url": UserDefaults.standard.string(forKey: Self.serverUrlDefaultsKey) ?? ""])
    }

    @objc func setServerUrl(_ call: CAPPluginCall) {
        guard let url = call.getString("url"), !url.isEmpty else {
            call.reject("Missing url")
            return
        }
        UserDefaults.standard.set(url, forKey: Self.serverUrlDefaultsKey)
        call.resolve()
        // Restart so the new host is added to the bridge's
        // allowedNavigationHostnames — see MainViewController.instanceDescriptor().
        // Without this, navigating the WebView straight to `url` would get
        // bounced out to Safari instead of loading in-app.
        DispatchQueue.main.async {
            MainViewController.reloadForUpdatedServerUrl()
        }
    }

    @objc func clearServerUrl(_ call: CAPPluginCall) {
        UserDefaults.standard.removeObject(forKey: Self.serverUrlDefaultsKey)
        call.resolve()
        DispatchQueue.main.async {
            MainViewController.reloadForUpdatedServerUrl()
        }
    }

    @objc func importClientCertificate(_ call: CAPPluginCall) {
        guard let viewController = bridge?.viewController else {
            call.reject("No view controller available")
            return
        }
        DispatchQueue.main.async {
            ClientCertManager.shared.presentImportFlow(from: viewController) { result in
                switch result {
                case .success(let label):
                    call.resolve(["label": label])
                case .failure(let error):
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    // Capacitor calls this for every registered plugin when the WKWebView
    // hits an HTTP auth challenge (see WebViewDelegationHandler in
    // @capacitor/ios). Returning false defers to the default disposition
    // (.rejectProtectionSpace), which is what mTLS-protected servers need
    // when no client certificate has been imported yet.
    public override func handleWKWebViewURLAuthenticationChallenge(
        _ challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) -> Bool {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodClientCertificate,
              let (identity, certificates) = ClientCertManager.shared.storedIdentity() else {
            return false
        }
        let credential = URLCredential(identity: identity, certificates: certificates, persistence: .forSession)
        completionHandler(.useCredential, credential)
        return true
    }
}
