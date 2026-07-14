package com.jaysbeekay.contracts;

import android.content.Context;
import android.util.Log;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.util.Enumeration;

/**
 * Manages the client certificate used for mTLS WebView connections.
 *
 * The user's PKCS12 file is parsed once (with their password), then
 * re-encoded with a fixed internal password and stored in the app's
 * private files directory (context.getFilesDir()/client.p12).
 * App-private storage means the file is not readable by other apps on
 * non-rooted devices — the fixed password is a defence-in-depth layer.
 *
 * Android equivalent of ios/App/App/ClientCertManager.swift.
 */
public class ClientCertManager {
    private static final String TAG = "ClientCertManager";
    private static final String CERT_FILE = "client.p12";
    // Fixed password for the stored copy — protects against casual offline access.
    private static final char[] STORE_PASS = "hearth-mtls-internal".toCharArray();

    public static class Credential {
        public final PrivateKey privateKey;
        public final X509Certificate[] chain;

        Credential(PrivateKey key, X509Certificate[] chain) {
            this.privateKey = key;
            this.chain = chain;
        }
    }

    /**
     * Parse a PKCS12 from raw bytes, re-encode with the internal password,
     * and persist to filesDir/client.p12.
     *
     * @return The Common Name extracted from the leaf certificate, or "Certificate"
     *         if no CN attribute is present.
     * @throws Exception if the bytes cannot be parsed or the password is wrong.
     */
    public static String importPkcs12(Context context, byte[] p12Bytes, String userPassword)
            throws Exception {
        char[] userPass = userPassword.toCharArray();

        // Parse the user-supplied file
        KeyStore src = KeyStore.getInstance("PKCS12");
        src.load(new ByteArrayInputStream(p12Bytes), userPass);

        // Find the first key entry (may be under any alias)
        PrivateKey key = null;
        Certificate[] chain = null;
        String label = "Certificate";

        Enumeration<String> aliases = src.aliases();
        while (aliases.hasMoreElements()) {
            String alias = aliases.nextElement();
            if (src.isKeyEntry(alias)) {
                key = (PrivateKey) src.getKey(alias, userPass);
                chain = src.getCertificateChain(alias);
                if (chain != null && chain.length > 0) {
                    X509Certificate leaf = (X509Certificate) chain[0];
                    label = extractCN(leaf.getSubjectX500Principal().getName());
                }
                break;
            }
        }

        if (key == null || chain == null) {
            throw new Exception("No private key found in the certificate file");
        }

        // Re-encode under our fixed internal password
        KeyStore dest = KeyStore.getInstance("PKCS12");
        dest.load(null, STORE_PASS);
        dest.setKeyEntry("client", key, STORE_PASS, chain);

        File outFile = new File(context.getFilesDir(), CERT_FILE);
        try (FileOutputStream fos = new FileOutputStream(outFile)) {
            dest.store(fos, STORE_PASS);
        }

        return label;
    }

    /**
     * Load the persisted credential, or null if none has been imported.
     * Safe to call from any thread — performs synchronous file I/O.
     */
    public static Credential loadCredential(Context context) {
        File file = new File(context.getFilesDir(), CERT_FILE);
        if (!file.exists()) return null;

        try {
            KeyStore store = KeyStore.getInstance("PKCS12");
            try (FileInputStream fis = new FileInputStream(file)) {
                store.load(fis, STORE_PASS);
            }
            PrivateKey key = (PrivateKey) store.getKey("client", STORE_PASS);
            Certificate[] raw = store.getCertificateChain("client");
            if (key == null || raw == null) return null;

            X509Certificate[] chain = new X509Certificate[raw.length];
            for (int i = 0; i < raw.length; i++) {
                chain[i] = (X509Certificate) raw[i];
            }
            return new Credential(key, chain);
        } catch (Exception e) {
            Log.e(TAG, "Failed to load client credential", e);
            return null;
        }
    }

    /** Delete the persisted certificate file. */
    public static void deleteCredential(Context context) {
        new File(context.getFilesDir(), CERT_FILE).delete();
    }

    public static boolean hasCredential(Context context) {
        return new File(context.getFilesDir(), CERT_FILE).exists();
    }

    private static String extractCN(String dn) {
        for (String part : dn.split(",")) {
            String t = part.trim();
            if (t.regionMatches(true, 0, "CN=", 0, 3)) {
                return t.substring(3);
            }
        }
        return dn.isEmpty() ? "Certificate" : dn;
    }
}
