import Foundation
import UIKit
import Security
import UniformTypeIdentifiers

enum ClientCertError: LocalizedError {
    case cancelled
    case invalidPKCS12
    case keychainFailure(OSStatus)

    var errorDescription: String? {
        switch self {
        case .cancelled:
            return "Cancelled"
        case .invalidPKCS12:
            return "Couldn't read that .p12 file — check the password and try again."
        case .keychainFailure(let status):
            return "Couldn't save the certificate to Keychain (status \(status))."
        }
    }
}

// Imports a client .p12 (picked from the Files app) into the Keychain so it
// can answer mTLS challenges from the user's self-hosted server — see
// deploy/nginx/contracts-mtls.conf.example and ServerConfigPlugin.
final class ClientCertManager: NSObject {
    static let shared = ClientCertManager()

    private static let identityTag = "com.hearthapp.app.clientIdentity".data(using: .utf8)!

    private var pendingCompletion: ((Result<String, Error>) -> Void)?

    func presentImportFlow(from viewController: UIViewController, completion: @escaping (Result<String, Error>) -> Void) {
        pendingCompletion = completion

        let picker: UIDocumentPickerViewController
        if let p12Type = UTType(filenameExtension: "p12") {
            picker = UIDocumentPickerViewController(forOpeningContentTypes: [p12Type])
        } else {
            picker = UIDocumentPickerViewController(forOpeningContentTypes: [.data])
        }
        picker.delegate = self
        picker.allowsMultipleSelection = false
        viewController.present(picker, animated: true)
    }

    /// Looks up the previously imported identity, for use answering an
    /// NSURLAuthenticationMethodClientCertificate challenge.
    func storedIdentity() -> (SecIdentity, [SecCertificate])? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassIdentity,
            kSecAttrApplicationTag as String: Self.identityTag,
            kSecReturnRef as String: true
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let result else {
            return nil
        }
        // swiftlint:disable:next force_cast
        let identity = result as! SecIdentity
        var certificate: SecCertificate?
        SecIdentityCopyCertificate(identity, &certificate)
        return (identity, certificate.map { [$0] } ?? [])
    }

    private func promptPassword(from viewController: UIViewController, completion: @escaping (String?) -> Void) {
        let alert = UIAlertController(
            title: "Certificate password",
            message: "Enter the password for this .p12 file.",
            preferredStyle: .alert
        )
        alert.addTextField { $0.isSecureTextEntry = true }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completion(nil) })
        alert.addAction(UIAlertAction(title: "Import", style: .default) { [weak alert] _ in
            completion(alert?.textFields?.first?.text ?? "")
        })
        viewController.present(alert, animated: true)
    }

    private func importP12(data: Data, password: String) throws -> SecIdentity {
        let options = [kSecImportExportPassphrase as String: password]
        var rawItems: CFArray?
        let status = SecPKCS12Import(data as CFData, options as CFDictionary, &rawItems)
        guard status == errSecSuccess,
              let items = rawItems as? [[String: Any]],
              let identity = items.first?[kSecImportItemIdentity as String] else {
            throw ClientCertError.invalidPKCS12
        }
        // swiftlint:disable:next force_cast
        return identity as! SecIdentity
    }

    private func persist(identity: SecIdentity) throws {
        let deleteQuery: [String: Any] = [
            kSecClass as String: kSecClassIdentity,
            kSecAttrApplicationTag as String: Self.identityTag
        ]
        SecItemDelete(deleteQuery as CFDictionary)

        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassIdentity,
            kSecValueRef as String: identity,
            kSecAttrApplicationTag as String: Self.identityTag
        ]
        let status = SecItemAdd(addQuery as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw ClientCertError.keychainFailure(status)
        }
    }
}

extension ClientCertManager: UIDocumentPickerDelegate {
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        let completion = pendingCompletion
        pendingCompletion = nil
        guard let url = urls.first, let presenter = controller.presentingViewController else {
            completion?(.failure(ClientCertError.cancelled))
            return
        }
        promptPassword(from: presenter) { password in
            guard let password else {
                completion?(.failure(ClientCertError.cancelled))
                return
            }
            do {
                let accessed = url.startAccessingSecurityScopedResource()
                defer { if accessed { url.stopAccessingSecurityScopedResource() } }
                let data = try Data(contentsOf: url)
                let identity = try self.importP12(data: data, password: password)
                try self.persist(identity: identity)
                var certificate: SecCertificate?
                SecIdentityCopyCertificate(identity, &certificate)
                let label = certificate.flatMap { SecCertificateCopySubjectSummary($0) as String? } ?? url.lastPathComponent
                completion?(.success(label))
            } catch {
                completion?(.failure(error))
            }
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        let completion = pendingCompletion
        pendingCompletion = nil
        completion?(.failure(ClientCertError.cancelled))
    }
}
