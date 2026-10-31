import Foundation
import Capacitor
import Security

// Standalone-mode backups to the user's own iCloud Drive (#226).
//
// The shell's JavaScript builds and encrypts the backup (backup-format.js);
// this plugin only moves the finished file in and out of the app's iCloud
// container, so nothing readable ever reaches iCloud. Files go to the
// container's Documents folder, which iCloud Drive shows as a "Hearth" folder
// (NSUbiquitousContainers in Info.plist), so a user can also see, share or
// delete them from the Files app.
//
// The automatic-backup password is kept in the device keychain
// (ThisDeviceOnly, never synced) so a scheduled backup can run without a
// prompt. Restoring on a new phone still needs the user to type it.
@objc(ICloudBackupPlugin)
public class ICloudBackupPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ICloudBackupPlugin"
    public let jsName = "ICloudBackup"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "upload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAutoBackupPassword", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAutoBackupPassword", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAutoBackupPassword", returnType: CAPPluginReturnPromise)
    ]

    // Must match the container in App.entitlements and Info.plist.
    static let containerIdentifier = "iCloud.com.hearthapp.app"
    static let fileExtension = "hearthbackup"
    static let keychainService = "com.hearthapp.app.backup"
    static let keychainAccount = "auto-backup-password"
    static let downloadTimeout: TimeInterval = 180

    private let queue = DispatchQueue(label: "com.hearthapp.app.icloud-backup", qos: .userInitiated)

    // url(forUbiquityContainerIdentifier:) can block, so it is only ever
    // called on `queue`, never the main thread.
    private func backupFolder() throws -> URL {
        guard FileManager.default.ubiquityIdentityToken != nil else {
            throw PluginError.message("iCloud Drive is off or you are not signed in to iCloud.")
        }
        guard let container = FileManager.default.url(forUbiquityContainerIdentifier: Self.containerIdentifier) else {
            throw PluginError.message("Hearth's iCloud folder is unavailable. Check Settings > [your name] > iCloud > iCloud Drive.")
        }
        let folder = container.appendingPathComponent("Documents", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }

    // A backup name from JavaScript becomes a path, so only plain
    // `something.hearthbackup` names are accepted.
    private func validName(_ name: String?) throws -> String {
        guard let name = name, !name.isEmpty, name.count <= 200,
              !name.contains("/"), !name.contains("\\"), !name.hasPrefix("."),
              name.hasSuffix(".\(Self.fileExtension)") else {
            throw PluginError.message("Invalid backup name.")
        }
        return name
    }

    private func run(_ call: CAPPluginCall, _ work: @escaping () throws -> [String: Any]) {
        queue.async {
            do {
                call.resolve(try work())
            } catch PluginError.message(let message) {
                call.reject(message)
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        queue.async {
            do {
                _ = try self.backupFolder()
                call.resolve(["available": true])
            } catch PluginError.message(let message) {
                call.resolve(["available": false, "reason": message])
            } catch {
                call.resolve(["available": false, "reason": error.localizedDescription])
            }
        }
    }

    // Copies a finished local backup (a file:// URI from Filesystem.getUri)
    // into iCloud, then keeps only the newest `keep` backups there.
    @objc func upload(_ call: CAPPluginCall) {
        run(call) {
            guard let path = call.getString("path"), let source = URL(string: path), source.isFileURL else {
                throw PluginError.message("Missing backup file.")
            }
            let name = try self.validName(call.getString("name"))
            let keep = max(1, call.getInt("keep") ?? 7)
            let folder = try self.backupFolder()
            let destination = folder.appendingPathComponent(name)
            try self.coordinatedWrite(to: destination) { url in
                if FileManager.default.fileExists(atPath: url.path) {
                    try FileManager.default.removeItem(at: url)
                }
                try FileManager.default.copyItem(at: source, to: url)
            }
            let removed = try self.prune(folder: folder, keep: keep)
            return ["name": name, "pruned": removed]
        }
    }

    @objc func list(_ call: CAPPluginCall) {
        run(call) {
            let folder = try self.backupFolder()
            return ["backups": try self.entries(in: folder).map { $0.json }]
        }
    }

    // Downloads a backup that iCloud has not yet put on this device (always
    // the case on a new phone), waits for it, and returns its size.
    @objc func prepare(_ call: CAPPluginCall) {
        run(call) {
            let name = try self.validName(call.getString("name"))
            var url = try self.backupFolder().appendingPathComponent(name)
            try? FileManager.default.startDownloadingUbiquitousItem(at: url)
            let deadline = Date().addingTimeInterval(Self.downloadTimeout)
            while true {
                // URL caches resource values; drop them so each poll sees
                // the download's current state.
                url.removeAllCachedResourceValues()
                let resource = try url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey, .fileSizeKey])
                let downloaded = resource.ubiquitousItemDownloadingStatus == .current
                    || (resource.ubiquitousItemDownloadingStatus == nil && FileManager.default.fileExists(atPath: url.path))
                if downloaded, let size = resource.fileSize {
                    return ["size": size]
                }
                if Date() > deadline {
                    throw PluginError.message("The backup is still downloading from iCloud. Try again in a moment.")
                }
                Thread.sleep(forTimeInterval: 0.5)
            }
        }
    }

    // Returns `length` bytes from `offset` as UTF-8 text. Backups are ASCII
    // (a JSON header plus base64 lines), so any byte range is valid text.
    @objc func readChunk(_ call: CAPPluginCall) {
        run(call) {
            let name = try self.validName(call.getString("name"))
            let offset = max(0, call.getInt("offset") ?? 0)
            let length = min(max(0, call.getInt("length") ?? 0), 8 * 1024 * 1024)
            let url = try self.backupFolder().appendingPathComponent(name)
            var data = Data()
            var coordinationError: NSError?
            var readError: Error?
            NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { readURL in
                do {
                    let handle = try FileHandle(forReadingFrom: readURL)
                    defer { try? handle.close() }
                    try handle.seek(toOffset: UInt64(offset))
                    data = try handle.read(upToCount: length) ?? Data()
                } catch {
                    readError = error
                }
            }
            if let error = coordinationError ?? readError { throw error }
            guard let text = String(data: data, encoding: .utf8) else {
                throw PluginError.message("The backup file is damaged.")
            }
            return ["data": text]
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        run(call) {
            let name = try self.validName(call.getString("name"))
            let url = try self.backupFolder().appendingPathComponent(name)
            try self.coordinatedDelete(url)
            return [:]
        }
    }

    @objc func setAutoBackupPassword(_ call: CAPPluginCall) {
        guard let password = call.getString("password"), password.count >= 8 else {
            call.reject("Backup password must be at least 8 characters.")
            return
        }
        let status = Keychain.set(password, service: Self.keychainService, account: Self.keychainAccount)
        status == errSecSuccess ? call.resolve() : call.reject("Could not save the password to the keychain (\(status)).")
    }

    @objc func getAutoBackupPassword(_ call: CAPPluginCall) {
        call.resolve(["password": Keychain.get(service: Self.keychainService, account: Self.keychainAccount) ?? ""])
    }

    @objc func clearAutoBackupPassword(_ call: CAPPluginCall) {
        Keychain.delete(service: Self.keychainService, account: Self.keychainAccount)
        call.resolve()
    }

    // MARK: - Files

    private struct Entry {
        let name: String
        let size: Int
        let modifiedAt: Date
        let downloaded: Bool
        var json: [String: Any] {
            ["name": name, "size": size, "modifiedAt": ISO8601DateFormatter().string(from: modifiedAt), "downloaded": downloaded]
        }
    }

    // A backup iCloud has not downloaded shows up as a placeholder named
    // `.name.hearthbackup.icloud`; both forms are listed under the real name.
    private func entries(in folder: URL) throws -> [Entry] {
        let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey, .ubiquitousItemDownloadingStatusKey]
        let urls = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: keys, options: [])
        var seen = [String: Entry]()
        for url in urls {
            var name = url.lastPathComponent
            var placeholder = false
            if name.hasPrefix("."), name.hasSuffix(".icloud") {
                name = String(name.dropFirst().dropLast(".icloud".count))
                placeholder = true
            }
            guard name.hasSuffix(".\(Self.fileExtension)") else { continue }
            let values = try? url.resourceValues(forKeys: Set(keys))
            let entry = Entry(
                name: name,
                size: values?.fileSize ?? 0,
                modifiedAt: values?.contentModificationDate ?? Date.distantPast,
                downloaded: !placeholder && (values?.ubiquitousItemDownloadingStatus ?? .current) == .current
            )
            if seen[name] == nil || entry.downloaded { seen[name] = entry }
        }
        // Names carry their timestamp (hearth-standalone-YYYY-MM-DD-HHMMSS),
        // so newest first by name, falling back to modification date.
        return seen.values.sorted { ($0.name, $0.modifiedAt) > ($1.name, $1.modifiedAt) }
    }

    private func prune(folder: URL, keep: Int) throws -> Int {
        let stale = try entries(in: folder).filter { $0.name.hasPrefix("hearth-standalone-") }.dropFirst(keep)
        for entry in stale {
            try? coordinatedDelete(folder.appendingPathComponent(entry.name))
        }
        return stale.count
    }

    private func coordinatedWrite(to url: URL, _ body: (URL) throws -> Void) throws {
        var coordinationError: NSError?
        var bodyError: Error?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordinationError) { writeURL in
            do { try body(writeURL) } catch { bodyError = error }
        }
        if let error = coordinationError ?? bodyError { throw error }
    }

    private func coordinatedDelete(_ url: URL) throws {
        var coordinationError: NSError?
        var bodyError: Error?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forDeleting, error: &coordinationError) { deleteURL in
            do { try FileManager.default.removeItem(at: deleteURL) } catch { bodyError = error }
        }
        if let error = coordinationError ?? bodyError { throw error }
    }

    private enum PluginError: Error {
        case message(String)
    }
}

// Generic-password keychain item, readable only on this device after its
// first unlock (so a backup can run when the app opens), and never synced to
// iCloud Keychain or included in a device backup.
private enum Keychain {
    static func query(service: String, account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    static func set(_ value: String, service: String, account: String) -> OSStatus {
        delete(service: service, account: account)
        var item = query(service: service, account: account)
        item[kSecValueData as String] = Data(value.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(item as CFDictionary, nil)
    }

    static func get(service: String, account: String) -> String? {
        var item = query(service: service, account: account)
        item[kSecReturnData as String] = true
        item[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(item as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    static func delete(service: String, account: String) -> OSStatus {
        SecItemDelete(query(service: service, account: account) as CFDictionary)
    }
}
