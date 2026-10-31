import Foundation
import Capacitor
import PDFKit
import UIKit
import Vision
import VisionKit

/// On-device document scanning and text recognition for the standalone shell
/// (ios-shell/www/app.js, `Plugins.HearthScan`). Everything runs on the
/// phone: VisionKit's document camera, Vision text recognition and PDFKit.
/// No network, no Apple Intelligence requirement; works from iOS 13.
///
/// Android counterpart: android/app/src/main/java/com/hearthapp/app/HearthScanPlugin.java.
@objc(HearthScanPlugin)
public class HearthScanPlugin: CAPPlugin, CAPBridgedPlugin, VNDocumentCameraViewControllerDelegate {
    public let identifier = "HearthScanPlugin"
    public let jsName = "HearthScan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanDocument", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recognizeText", returnType: CAPPluginReturnPromise)
    ]

    // Same cap as the server's OCR pass (src/lib/documents/textExtraction.ts).
    static let maxOcrPages = 5
    // Below this, a PDF's text layer is treated as missing (a scanned PDF).
    static let minTextLayerLength = 40
    // Longest edge of a scanned page as stored in the PDF; keeps a few pages
    // well under the shell's 15MB upload limit.
    static let maxPageDimension: CGFloat = 2000
    static let pageJpegQuality: CGFloat = 0.7

    private var pendingScanCall: CAPPluginCall?
    private let workQueue = DispatchQueue(label: "com.hearthapp.app.hearthscan", qos: .userInitiated)

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve([
            "scanner": VNDocumentCameraViewController.isSupported,
            "textRecognition": true
        ])
    }

    @objc func scanDocument(_ call: CAPPluginCall) {
        guard VNDocumentCameraViewController.isSupported else {
            call.reject("Document scanning isn't supported on this device.", "UNAVAILABLE")
            return
        }
        DispatchQueue.main.async {
            guard self.pendingScanCall == nil else {
                call.reject("A scan is already in progress.", "BUSY")
                return
            }
            guard let viewController = self.bridge?.viewController else {
                call.reject("No view controller available")
                return
            }
            self.pendingScanCall = call
            let scanner = VNDocumentCameraViewController()
            scanner.delegate = self
            viewController.present(scanner, animated: true)
        }
    }

    @objc func recognizeText(_ call: CAPPluginCall) {
        guard let base64 = call.getString("data"), let data = Data(base64Encoded: base64) else {
            call.reject("Missing or invalid data")
            return
        }
        let mimeType = call.getString("mimeType") ?? ""
        workQueue.async {
            let text: String
            if mimeType == "application/pdf" {
                text = Self.pdfText(data)
            } else if let image = UIImage(data: data) {
                text = Self.recognize(image)
            } else {
                text = ""
            }
            call.resolve(["text": text])
        }
    }

    // MARK: - VNDocumentCameraViewControllerDelegate

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
        var pages: [UIImage] = []
        for index in 0..<scan.pageCount {
            pages.append(scan.imageOfPage(at: index))
        }
        controller.dismiss(animated: true)
        guard let call = takePendingScanCall() else { return }
        workQueue.async {
            let compressed = pages.map { Self.compressedPage($0) }
            let pdf = Self.pdfData(from: compressed)
            let text = compressed.prefix(Self.maxOcrPages).map { Self.recognize($0) }.joined(separator: "\n")
            call.resolve([
                "cancelled": false,
                "pdf": pdf.base64EncodedString(),
                "pageCount": compressed.count,
                "text": text
            ])
        }
    }

    public func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true)
        takePendingScanCall()?.resolve(["cancelled": true])
    }

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
        controller.dismiss(animated: true)
        takePendingScanCall()?.reject(error.localizedDescription)
    }

    private func takePendingScanCall() -> CAPPluginCall? {
        let call = pendingScanCall
        pendingScanCall = nil
        return call
    }

    // MARK: - Helpers

    /// Text layer first (the `pdftotext` equivalent); if it is missing or
    /// negligible, render the first pages and OCR them like a scan.
    static func pdfText(_ data: Data) -> String {
        guard let document = PDFDocument(data: data) else { return "" }
        let layer = document.string ?? ""
        if layer.trimmingCharacters(in: .whitespacesAndNewlines).count >= minTextLayerLength {
            return layer
        }
        var texts: [String] = []
        for index in 0..<min(document.pageCount, maxOcrPages) {
            guard let page = document.page(at: index) else { continue }
            let bounds = page.bounds(for: .mediaBox)
            let longest = max(bounds.width, bounds.height)
            guard longest > 0 else { continue }
            let scale = maxPageDimension / longest
            let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
            texts.append(recognize(page.thumbnail(of: size, for: .mediaBox)))
        }
        return texts.joined(separator: "\n")
    }

    static func recognize(_ image: UIImage) -> String {
        guard let cgImage = image.cgImage else { return "" }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        let handler = VNImageRequestHandler(cgImage: cgImage, orientation: cgOrientation(image.imageOrientation), options: [:])
        do {
            try handler.perform([request])
        } catch {
            return ""
        }
        let observations = request.results ?? []
        // Vision's bounding boxes are normalised with the origin at the
        // bottom left: read top to bottom, then left to right, so a label and
        // its value on one printed line stay next to each other.
        let ordered = observations.sorted { a, b in
            let rowDelta = a.boundingBox.midY - b.boundingBox.midY
            if abs(rowDelta) > 0.01 { return rowDelta > 0 }
            return a.boundingBox.minX < b.boundingBox.minX
        }
        return ordered.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    }

    static func compressedPage(_ image: UIImage) -> UIImage {
        let longest = max(image.size.width, image.size.height)
        let scale = longest > maxPageDimension ? maxPageDimension / longest : 1
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        guard let jpeg = resized.jpegData(compressionQuality: pageJpegQuality), let decoded = UIImage(data: jpeg) else {
            return resized
        }
        return decoded
    }

    static func pdfData(from pages: [UIImage]) -> Data {
        let document = PDFDocument()
        for (index, image) in pages.enumerated() {
            if let page = PDFPage(image: image) {
                document.insert(page, at: index)
            }
        }
        return document.dataRepresentation() ?? Data()
    }

    static func cgOrientation(_ orientation: UIImage.Orientation) -> CGImagePropertyOrientation {
        switch orientation {
        case .up: return .up
        case .upMirrored: return .upMirrored
        case .down: return .down
        case .downMirrored: return .downMirrored
        case .left: return .left
        case .leftMirrored: return .leftMirrored
        case .right: return .right
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
    }
}
