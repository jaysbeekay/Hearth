package com.jaysbeekay.contracts;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.security.KeyChain;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Android counterpart of the iOS ServerConfigPlugin (ServerConfigPlugin.swift).
 *
 * Stores the server URL in SharedPreferences so it survives restarts (and can
 * be read by MainActivity before the bridge is built). When the URL changes the
 * activity is recreated — MainActivity.onCreate() then builds a CapConfig that
 * includes the new hostname in allowNavigation, which keeps the WebView
 * in-app instead of handing navigation off to the device browser.
 *
 * Client certificate import delegates to the Android system KeyChain UI.
 * In-WebView mTLS (intercepting onReceivedClientCertRequest) is deferred
 * to a future phase — it requires forking into BridgeWebViewClient.
 */
@CapacitorPlugin(name = "ServerConfig")
public class ServerConfigPlugin extends Plugin {

    static final String PREFS_NAME = "ServerConfig";
    static final String SERVER_URL_KEY = "server_url";

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
        // the new hostname in allowNavigation — same pattern as iOS's
        // MainViewController.reloadForUpdatedServerUrl().
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }

    @PluginMethod
    public void clearServerUrl(PluginCall call) {
        getContext().getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE)
                .edit().remove(SERVER_URL_KEY).apply();
        call.resolve();
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }

    /**
     * Opens the Android system KeyChain certificate installer. The user browses
     * to their PKCS12 file and enters the password — Android stores the cert in
     * the system KeyStore. We resolve immediately rather than waiting for the
     * system-UI result, because the return code is unreliable across OEM ROMs.
     */
    @PluginMethod
    public void importClientCertificate(PluginCall call) {
        Intent intent = KeyChain.createInstallIntent();
        intent.putExtra(Intent.EXTRA_TITLE, "Import client certificate");
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open certificate installer: " + e.getMessage());
        }
    }
}
