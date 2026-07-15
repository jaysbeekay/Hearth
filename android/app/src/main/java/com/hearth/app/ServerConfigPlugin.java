package com.hearth.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.text.InputType;
import android.widget.EditText;
import android.widget.LinearLayout;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * Android counterpart of the iOS ServerConfigPlugin (ServerConfigPlugin.swift).
 *
 * Stores the server URL in SharedPreferences so it survives restarts and can
 * be read by MainActivity before the Capacitor bridge is built.
 *
 * importClientCertificate:
 *  1. Opens a system file-picker for .p12/.pfx files.
 *  2. Shows a native password dialog.
 *  3. Parses the PKCS12 with the user's password (background thread).
 *  4. Re-stores with a fixed internal password in filesDir/client.p12.
 *  5. Returns { label } to JS (matches the iOS API surface).
 *  MtlsWebViewClient.onReceivedClientCertRequest then loads the stored
 *  credential and calls request.proceed(key, chain) automatically.
 */
@CapacitorPlugin(name = "ServerConfig")
public class ServerConfigPlugin extends Plugin {

    static final String PREFS_NAME = "ServerConfig";
    static final String SERVER_URL_KEY = "server_url";
    private static final String CERT_LABEL_KEY = "cert_label";

    // ─── Server URL ──────────────────────────────────────────────────────────

    @PluginMethod
    public void getServerUrl(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE);
        JSObject result = new JSObject();
        result.put("url", prefs.getString(SERVER_URL_KEY, ""));
        call.resolve(result);
    }

    @PluginMethod
    public void setServerUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("Missing url");
            return;
        }
        getContext().getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE)
                .edit().putString(SERVER_URL_KEY, url.trim()).apply();
        call.resolve();
        // Recreate so MainActivity.onCreate() rebuilds the bridge config with
        // the new hostname in allowNavigation — mirrors iOS reloadForUpdatedServerUrl().
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }

    @PluginMethod
    public void clearServerUrl(PluginCall call) {
        getContext().getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE)
                .edit().remove(SERVER_URL_KEY).apply();
        call.resolve();
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }

    // ─── Client certificate (mTLS) ───────────────────────────────────────────

    /**
     * Step 1: launch file picker for .p12 / .pfx files.
     * The result is handled by handleCertFileResult().
     */
    @PluginMethod
    public void importClientCertificate(PluginCall call) {
        saveCall(call);
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.setType("*/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        // Hint the picker — not all file managers honour EXTRA_MIME_TYPES
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                "application/x-pkcs12",
                "application/pkcs12",
                "application/octet-stream"
        });
        startActivityForResult(call, intent, "handleCertFileResult");
    }

    /**
     * Step 2: file selected — show a password dialog on the main thread.
     */
    @ActivityCallback
    private void handleCertFileResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK
                || result.getData() == null
                || result.getData().getData() == null) {
            call.reject("Cancelled");
            return;
        }
        Uri fileUri = result.getData().getData();
        getActivity().runOnUiThread(() -> showPasswordDialog(call, fileUri));
    }

    /**
     * Step 3: native AlertDialog asking for the PKCS12 password.
     */
    private void showPasswordDialog(PluginCall call, Uri fileUri) {
        EditText passwordInput = new EditText(getActivity());
        passwordInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        passwordInput.setHint("Certificate password");

        // Add some padding so the EditText isn't flush against the dialog edges
        LinearLayout container = new LinearLayout(getActivity());
        container.setPadding(48, 16, 48, 8);
        container.addView(passwordInput);

        new AlertDialog.Builder(getActivity())
                .setTitle("Import client certificate")
                .setView(container)
                .setPositiveButton("Import", (dialog, which) -> {
                    String password = passwordInput.getText().toString();
                    importInBackground(call, fileUri, password);
                })
                .setNegativeButton("Cancel", (dialog, which) -> call.reject("Cancelled"))
                .setCancelable(false)
                .show();
    }

    /**
     * Step 4: parse PKCS12 + store on a background thread (file I/O).
     */
    private void importInBackground(PluginCall call, Uri fileUri, String password) {
        new Thread(() -> {
            try {
                // Read the file bytes
                byte[] bytes;
                try (InputStream is = getContext().getContentResolver().openInputStream(fileUri)) {
                    if (is == null) throw new Exception("Could not read the selected file");
                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                    byte[] chunk = new byte[8192];
                    int n;
                    while ((n = is.read(chunk)) != -1) buf.write(chunk, 0, n);
                    bytes = buf.toByteArray();
                }

                // Parse and re-store
                String label = ClientCertManager.importPkcs12(getContext(), bytes, password);

                // Persist the display label
                getContext().getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE)
                        .edit().putString(CERT_LABEL_KEY, label).apply();

                JSObject result = new JSObject();
                result.put("label", label);
                call.resolve(result);

            } catch (Exception e) {
                String msg = e.getMessage();
                // Wrong password shows as a generic "keystore tampered" or "mac verify failure"
                if (msg != null && (msg.contains("mac") || msg.contains("tampered") || msg.contains("password"))) {
                    call.reject("Wrong password or invalid certificate file");
                } else {
                    call.reject(msg != null ? msg : "Import failed");
                }
            }
        }).start();
    }
}
