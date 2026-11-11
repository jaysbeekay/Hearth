import Capacitor
import UIKit
import UniformTypeIdentifiers

// Copies a secret, the standalone backup password (#226), so that it doesn't
// outlive its use:
// - the item is local-only, so Universal Clipboard never syncs it to the
//   user's other devices;
// - iOS removes it by itself when it expires, even if Hearth is killed first;
// - clearIfUnchanged() removes it early only while the pasteboard still holds
//   that same item. It tells from changeCount, without reading the pasteboard,
//   so something the user copied in another app since is never wiped, and no
//   paste prompt is shown.
@objc(SecureClipboardPlugin)
public class SecureClipboardPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureClipboardPlugin"
    public let jsName = "SecureClipboard"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearIfUnchanged", returnType: CAPPluginReturnPromise)
    ]

    // The pasteboard's changeCount right after Hearth's write; nil when there
    // is nothing of Hearth's left to clear. Only touched on the main queue.
    private var writtenChangeCount: Int?

    @objc func write(_ call: CAPPluginCall) {
        guard let value = call.getString("value"), !value.isEmpty else {
            call.reject("Missing value")
            return
        }
        let seconds = max(1, (call.getDouble("expiresInMs") ?? 60_000) / 1000)
        DispatchQueue.main.async {
            let pasteboard = UIPasteboard.general
            pasteboard.setItems(
                [[UTType.utf8PlainText.identifier: value]],
                options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(seconds)]
            )
            self.writtenChangeCount = pasteboard.changeCount
            call.resolve()
        }
    }

    // Resolves { cleared, changed }: cleared when Hearth's item was still
    // there and is now gone; changed when something else replaced it (or it
    // already expired), so there is nothing left for Hearth to clear.
    @objc func clearIfUnchanged(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let pasteboard = UIPasteboard.general
            guard let written = self.writtenChangeCount else {
                call.resolve(["cleared": false, "changed": true])
                return
            }
            self.writtenChangeCount = nil
            guard pasteboard.changeCount == written else {
                call.resolve(["cleared": false, "changed": true])
                return
            }
            pasteboard.items = []
            call.resolve(["cleared": true, "changed": false])
        }
    }
}
