package com.hearthapp.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.text.TextUtils;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanner;
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * On-device document scanning and text recognition for the standalone shell
 * (ios-shell/www/app.js, Plugins.HearthScan). Android counterpart of
 * HearthScanPlugin.swift.
 *
 * Scanning uses the ML Kit Document Scanner, whose UI and models Google Play
 * services download on first use (devices without Play services, or with
 * less than 1.7GB RAM, reject and the shell keeps its file picker). Text
 * recognition uses the bundled ML Kit Latin model. Nothing leaves the phone.
 */
@CapacitorPlugin(name = "HearthScan")
public class HearthScanPlugin extends Plugin {

    // Same cap as the server's OCR pass (src/lib/documents/textExtraction.ts).
    private static final int MAX_OCR_PAGES = 5;
    private static final int MAX_SCAN_PAGES = 10;
    // Longest edge, in pixels, of a PDF page or photo handed to OCR.
    private static final int MAX_OCR_DIMENSION = 2000;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private TextRecognizer recognizer;

    private synchronized TextRecognizer recognizer() {
        if (recognizer == null) recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        return recognizer;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        // Whether the Play services scanner module can run is only known when
        // a scan starts; scanDocument rejects if it can't.
        result.put("scanner", true);
        result.put("textRecognition", true);
        call.resolve(result);
    }

    @PluginMethod
    public void scanDocument(PluginCall call) {
        GmsDocumentScannerOptions options = new GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(false)
            .setPageLimit(MAX_SCAN_PAGES)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG, GmsDocumentScannerOptions.RESULT_FORMAT_PDF)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
            .build();
        GmsDocumentScanner scanner = GmsDocumentScanning.getClient(options);
        scanner
            .getStartScanIntent(getActivity())
            .addOnSuccessListener(intentSender -> {
                // Capacitor launches Intents, so wrap the IntentSender the way
                // the activity result registry does; this also lets Capacitor
                // restore the call if the activity is recreated mid-scan.
                Intent intent = new ActivityResultContracts.StartIntentSenderForResult()
                    .createIntent(getContext(), new IntentSenderRequest.Builder(intentSender).build());
                startActivityForResult(call, intent, "handleScanResult");
            })
            .addOnFailureListener(error -> call.reject("Document scanning isn't available on this device: " + error.getMessage(), "UNAVAILABLE"));
    }

    @ActivityCallback
    private void handleScanResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }
        Intent data = result.getData();
        GmsDocumentScanningResult scan = data == null ? null : GmsDocumentScanningResult.fromActivityResultIntent(data);
        if (result.getResultCode() != Activity.RESULT_OK || scan == null || scan.getPdf() == null) {
            call.reject("The scan didn't return a document.");
            return;
        }
        executor.execute(() -> {
            try {
                byte[] pdf = readUri(scan.getPdf().getUri());
                List<String> texts = new ArrayList<>();
                List<GmsDocumentScanningResult.Page> pages = scan.getPages();
                if (pages != null) {
                    for (int index = 0; index < pages.size() && index < MAX_OCR_PAGES; index++) {
                        texts.add(recognize(InputImage.fromFilePath(getContext(), pages.get(index).getImageUri())));
                    }
                }
                JSObject scanned = new JSObject();
                scanned.put("cancelled", false);
                scanned.put("pdf", Base64.encodeToString(pdf, Base64.NO_WRAP));
                scanned.put("pageCount", scan.getPdf().getPageCount());
                scanned.put("text", TextUtils.join("\n", texts));
                call.resolve(scanned);
            } catch (Exception error) {
                call.reject("Could not read the scan: " + error.getMessage());
            }
        });
    }

    @PluginMethod
    public void recognizeText(PluginCall call) {
        String base64 = call.getString("data");
        String mimeType = call.getString("mimeType", "");
        if (base64 == null) {
            call.reject("Missing data");
            return;
        }
        executor.execute(() -> {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                String text = "application/pdf".equals(mimeType) ? pdfText(bytes) : imageText(bytes);
                JSObject result = new JSObject();
                result.put("text", text);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Could not read text: " + error.getMessage());
            }
        });
    }

    private String imageText(byte[] bytes) throws Exception {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return "";
        BitmapFactory.Options options = new BitmapFactory.Options();
        int sample = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_OCR_DIMENSION) sample *= 2;
        options.inSampleSize = sample;
        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (bitmap == null) return "";
        try {
            // Photos from the picker can carry EXIF rotation that
            // BitmapFactory ignores; ML Kit's Latin model copes with modest
            // skew but not sideways text, which the scanner flow avoids.
            return recognize(InputImage.fromBitmap(bitmap, 0));
        } finally {
            bitmap.recycle();
        }
    }

    // No Android API reads a PDF's text layer, so every page is rendered and
    // OCR'd — text PDFs and scans alike, first MAX_OCR_PAGES pages only.
    private String pdfText(byte[] bytes) throws Exception {
        File temp = File.createTempFile("hearth-ocr", ".pdf", getContext().getCacheDir());
        try {
            try (FileOutputStream out = new FileOutputStream(temp)) {
                out.write(bytes);
            }
            List<String> texts = new ArrayList<>();
            try (
                ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(temp, ParcelFileDescriptor.MODE_READ_ONLY);
                PdfRenderer renderer = new PdfRenderer(descriptor)
            ) {
                for (int index = 0; index < renderer.getPageCount() && index < MAX_OCR_PAGES; index++) {
                    try (PdfRenderer.Page page = renderer.openPage(index)) {
                        int longest = Math.max(page.getWidth(), page.getHeight());
                        if (longest <= 0) continue;
                        float scale = (float) MAX_OCR_DIMENSION / longest;
                        int width = Math.max(1, Math.round(page.getWidth() * scale));
                        int height = Math.max(1, Math.round(page.getHeight() * scale));
                        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
                        try {
                            bitmap.eraseColor(Color.WHITE);
                            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                            texts.add(recognize(InputImage.fromBitmap(bitmap, 0)));
                        } finally {
                            bitmap.recycle();
                        }
                    }
                }
            }
            return TextUtils.join("\n", texts);
        } finally {
            //noinspection ResultOfMethodCallIgnored
            temp.delete();
        }
    }

    // Runs on the executor thread, never the main thread (Tasks.await).
    private String recognize(InputImage image) throws Exception {
        Text text = Tasks.await(recognizer().process(image));
        return text.getText();
    }

    private byte[] readUri(Uri uri) throws Exception {
        try (InputStream input = getContext().getContentResolver().openInputStream(uri); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IllegalStateException("Scan file is missing");
            byte[] buffer = new byte[16384];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            return output.toByteArray();
        }
    }
}
