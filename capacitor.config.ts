import type { CapacitorConfig } from "@capacitor/cli";

// This shell does not bundle the Next.js app. ios-shell/www is a small
// bootstrap page that asks the user for the address of their own
// self-hosted server, then hands the WebView off to it — see
// ios-shell/www/app.js and README-ios.md.
const config: CapacitorConfig = {
  appId: "com.jaysbeekay.contracts",
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
};

export default config;
