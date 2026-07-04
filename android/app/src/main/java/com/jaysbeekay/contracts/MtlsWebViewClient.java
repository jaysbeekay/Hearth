package com.jaysbeekay.contracts;

import android.content.Context;
import android.webkit.ClientCertRequest;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Extends Capacitor's BridgeWebViewClient to handle TLS client-certificate
 * challenges from the user's self-hosted server (mTLS).
 *
 * onReceivedClientCertRequest is called on a background thread, so synchronous
 * file I/O in ClientCertManager.loadCredential() is safe here.
 *
 * Android equivalent of the handleWKWebViewURLAuthenticationChallenge override
 * in ios/App/App/ServerConfigPlugin.swift.
 */
public class MtlsWebViewClient extends BridgeWebViewClient {
    private final Context context;

    public MtlsWebViewClient(Bridge bridge) {
        super(bridge);
        this.context = bridge.getContext();
    }

    @Override
    public void onReceivedClientCertRequest(WebView view, ClientCertRequest request) {
        ClientCertManager.Credential cred = ClientCertManager.loadCredential(context);
        if (cred != null) {
            request.proceed(cred.privateKey, cred.chain);
        } else {
            request.cancel();
        }
    }
}
