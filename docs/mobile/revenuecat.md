# RevenueCat setup for the standalone unlock

Standalone mode in the mobile shell (`ios-shell/www/app.js`) is a one-time
paid unlock sold through RevenueCat (`@revenuecat/purchases-capacitor`).
Connected mode (pointing the app at your own Hearth server) is free and never
calls RevenueCat. This page covers the one-off dashboard setup and how the
keys get into the app. Tracked in #399.

The shell expects these exact identifiers. If you change any of them, change
the matching constant at the top of `ios-shell/www/app.js` too.

| What | Value | Constant in `app.js` |
| --- | --- | --- |
| Bundle ID / package name | `com.hearthapp.app` | (from `capacitor.config.ts`) |
| Store product ID (both stores) | `standalone_unlock` | `STANDALONE_PRODUCT_ID` |
| RevenueCat entitlement ID | `standalone_mode` | `STANDALONE_ENTITLEMENT_ID` |
| iOS public SDK key | starts `appl_` | `REVENUECAT_API_KEY_IOS` |
| Android public SDK key | starts `goog_` | `REVENUECAT_API_KEY_ANDROID` |

## 1. Store products

**App Store Connect** (app `com.hearthapp.app`):

1. Monetization → In-App Purchases → create a **Non-Consumable** with product
   ID `standalone_unlock`. Fill in price, display name, description and the
   review screenshot so it can leave "Missing Metadata".
2. Agreements, Tax and Banking: the Paid Apps agreement must be active, or
   sandbox purchases won't load.
3. Users and Access → Integrations → In-App Purchase: generate an
   **In-App Purchase Key** (`.p8`). Note the Key ID and Issuer ID; RevenueCat
   needs all three.

**Google Play Console** (app `com.hearthapp.app`):

1. Play only lets you create in-app products after a build that includes
   the billing library has been uploaded to a track. Upload a release AAB to
   **Internal testing** first (the Purchases plugin adds the `BILLING`
   permission through manifest merge).
2. Monetize → Products → In-app products → create `standalone_unlock`
   (one-time, not a subscription) and activate it.
3. Create a Google Cloud service account with access to the Play Developer
   API, invite it in Play Console with financial-data permissions, and
   download its JSON key for RevenueCat. Follow RevenueCat's current
   "Google Play service credentials" guide for the exact grants; Google can
   take up to a day to accept new credentials.

## 2. RevenueCat project

1. Create a project (e.g. "Hearth") and add two apps:
   - **App Store** app: bundle ID `com.hearthapp.app`, upload the `.p8`
     In-App Purchase Key with its Key ID and Issuer ID.
   - **Play Store** app: package `com.hearthapp.app`, upload the service
     account JSON.
2. **Products**: import or add `standalone_unlock` for each app.
3. **Entitlements**: create `standalone_mode` and attach both
   `standalone_unlock` products.
4. **Offerings**: make sure the offering marked *current* has a package
   (a "Lifetime" package fits) containing `standalone_unlock` for both apps.
   The shell reads `offerings.current` and looks for that product ID, so a
   product that isn't in the current offering never shows a price.
5. Project settings → API keys: copy the **public** app-specific SDK keys,
   one `appl_…` and one `goog_…`. Never use a secret key (`sk_…`); the shell
   is shipped to every device.

## 3. Put the keys in the shell

1. Replace the two placeholder values of `REVENUECAT_API_KEY_IOS` and
   `REVENUECAT_API_KEY_ANDROID` in `ios-shell/www/app.js`.
2. `npm run cap:sync` to copy the shell into `ios/` and `android/`.
3. `npm run test:mobile-packages` and `npm run test:standalone`.

Public SDK keys are designed to be embedded in client apps, so committing
them is fine. They only identify the app to RevenueCat; they can't grant
entitlements or read other customers' data.

## 4. Sandbox testing

- **iOS**: sign in with a Sandbox Apple Account (Settings → App Store →
  Sandbox Account on the device), run a debug build from Xcode, buy the
  unlock, then delete and reinstall the app and use **Restore purchases**.
- **Android**: add your tester account to the internal-testing track and to
  Play Console's license testers, install from the internal-testing link,
  buy, uninstall, reinstall and restore.
- In both cases the purchase should appear under the sandbox customer in the
  RevenueCat dashboard with `standalone_mode` active.

## Rotating or replacing keys

If a public SDK key is ever regenerated or the RevenueCat project is
replaced, update the constants, run `npm run cap:sync`, and ship a new build
to both stores. Builds already on devices keep using the key they shipped
with, so don't revoke an old key until the new build has rolled out.
Entitlements belong to the RevenueCat project, so keep the same project
whenever possible: moving to a new one means existing buyers must restore
purchases against the new project.

## Before going live

Standalone users' data lives only on their device, so the standalone backup
question (#226) should be settled before the paid unlock ships.
