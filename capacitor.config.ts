import type { CapacitorConfig } from "@capacitor/cli";

// This shell does not bundle the Next.js app. ios-shell/www is a small
// bootstrap page that asks the user for the address of their own
// self-hosted server, then hands the WebView off to it — see
// ios-shell/www/app.js and README-ios.md.
//
// SPIKE (#148, unverified — see mobile-standalone/README.md): the `Nodejs`
// plugin block below is Phase 0 scaffolding for an alternate "run locally,
// no server" mode. `mobile-standalone/scripts/build-standalone-server.sh`
// assembles ios-shell/www/nodejs (gitignored — not checked in) from
// mobile-standalone/nodejs/'s templates plus a fresh Next.js standalone
// build. Nothing here is wired into the app's actual sign-in flow yet.
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
    Nodejs: {
      nodeDir: "nodejs",
      // Manual start (rather than auto-start on every launch) so the
      // native "Set up locally" vs "Connect to a server" choice — not yet
      // implemented, see README.md — can decide whether to start the
      // embedded runtime at all.
      startMode: "manual",
    },
  },
};

export default config;
