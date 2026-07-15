package com.hearthapp.app;

import android.content.SharedPreferences;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;
import java.net.URL;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register before super.onCreate() calls load()
        registerPlugin(ServerConfigPlugin.class);

        // Read the stored server URL and inject its hostname into the bridge config
        // so Capacitor keeps in-app navigation rather than handing off to the browser.
        // On first launch (no URL stored) we fall through to the default config from
        // assets, which just shows the local bootstrap page.
        SharedPreferences prefs = getSharedPreferences(ServerConfigPlugin.PREFS_NAME, MODE_PRIVATE);
        String serverUrl = prefs.getString(ServerConfigPlugin.SERVER_URL_KEY, null);
        if (serverUrl != null) {
            try {
                String host = new URL(serverUrl).getHost();
                config = new CapConfig.Builder(this)
                        .setAndroidScheme("capacitor")
                        .setErrorPath("index.html")
                        .setAllowNavigation(new String[]{host})
                        .create();
            } catch (Exception ignored) {
                // Malformed URL — fall back to default config from assets
            }
        }

        super.onCreate(savedInstanceState);

        // Replace Capacitor's default BridgeWebViewClient with our mTLS-aware one.
        // This must run after super.onCreate() has created the bridge.
        // MtlsWebViewClient delegates all non-cert behaviour to BridgeWebViewClient
        // and overrides onReceivedClientCertRequest to supply the stored client cert.
        if (bridge != null) {
            bridge.setWebViewClient(new MtlsWebViewClient(bridge));
        }
    }
}
