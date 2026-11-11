import Capacitor
import Foundation

// Keeps standalone mode's document files out of iCloud and Finder device
// backups (#492), so "everything stays on this phone" holds on iOS too. The
// shell stores them under Capacitor's DATA directory, which on iOS is the
// app's Documents folder, and Documents is backed up by default. The
// encrypted SQLite database needs nothing here: the SQLite plugin already
// excludes its own folder.
//
// excludeFolders({ paths }) creates each folder under Documents if needed and
// sets isExcludedFromBackup on it. Apple's guidance is to group files in a
// folder and exclude the folder ("Optimizing Your App's Data for iCloud
// Backup"), so files written into it later are covered too. The flag is lost
// when a folder is deleted, so the shell calls this at launch and after it
// removes and recreates one. Apple calls the flag guidance for the system,
// not a guarantee; a real-device check is listed on the PR.
@objc(BackupExclusionPlugin)
public class BackupExclusionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BackupExclusionPlugin"
    public let jsName = "BackupExclusion"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "excludeFolders", returnType: CAPPluginReturnPromise)
    ]

    @objc func excludeFolders(_ call: CAPPluginCall) {
        guard let paths = call.getArray("paths", String.self), !paths.isEmpty else {
            call.reject("Missing paths")
            return
        }
        // Only plain folder names directly under Documents: no separators,
        // no "." or "..", so a caller can't reach outside the app's folder.
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
        for path in paths where path.isEmpty || path.unicodeScalars.contains(where: { !allowed.contains($0) }) {
            call.reject("Invalid folder name: \(path)")
            return
        }
        do {
            let manager = FileManager.default
            let documents = try manager.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            for path in paths {
                var folder = documents.appendingPathComponent(path, isDirectory: true)
                try manager.createDirectory(at: folder, withIntermediateDirectories: true, attributes: nil)
                var values = URLResourceValues()
                values.isExcludedFromBackup = true
                try folder.setResourceValues(values)
            }
            call.resolve()
        } catch {
            call.reject("Could not exclude folders from backup: \(error.localizedDescription)")
        }
    }
}
