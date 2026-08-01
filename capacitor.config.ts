import type { CapacitorConfig } from "@capacitor/cli";

// This shell is the bundled mobile entrypoint. It lets the user choose between
// standalone on-device storage and a connected self-hosted Hearth server.
// Connected mode hands the WebView off to the configured server, while
// standalone mode stays inside ios-shell/www and uses native Capacitor storage.
const config: CapacitorConfig = {
  appId: "com.hearthapp.app",
  appName: "Hearth",
  webDir: "ios-shell/www",
  server: {
    iosScheme: "capacitor",
    androidScheme: "capacitor",
    // On a load failure (e.g. unreachable self-hosted server), Capacitor's
    // WebViewDelegationHandler reloads the WebView to this local file instead
    // of showing a blank WKWebView error page. app.js detects the bounce-back
    // via a localStorage debounce flag (no query params are passed here).
    errorPath: "index.html",
  },
  plugins: {
    CapacitorSQLite: {
      iosDatabaseLocation: "Library/CapacitorDatabase",
      iosIsEncryption: true,
      iosKeychainPrefix: "hearth-standalone",
      iosBiometric: {
        biometricAuth: false,
        biometricTitle: "Unlock Hearth standalone storage",
      },
      androidIsEncryption: true,
      androidBiometric: {
        biometricAuth: false,
        biometricTitle: "Unlock Hearth standalone storage",
        biometricSubTitle: "Use your device unlock method",
      },
    },
  },
};

export default config;
