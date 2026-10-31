# iOS builds and TestFlight

`.github/workflows/ios-testflight.yml` builds the Capacitor shell, signs it for
App Store distribution and uploads it to TestFlight.

## When it runs

| Trigger | Builds a signed IPA | Uploads to TestFlight |
| --- | --- | --- |
| Push of a `v*` tag | Yes | Yes |
| Manual run (Actions → Build iOS and upload to TestFlight) against a `v*` tag | Yes | Yes |
| Manual run against a branch | Yes | Only if **Upload to TestFlight** is ticked |

A tag created by running `release.yml` from the Actions tab does not trigger
push workflows (GitHub doesn't fire them for refs its own token creates), so in
that case run this workflow manually against the new tag, as with
`docker-publish.yml`.

The signed IPA is also kept as a workflow artifact for 30 days. It is not
attached to the public GitHub Release: an App Store–signed IPA can't be
installed outside TestFlight or the App Store.

## Versioning

The committed Xcode project stays at version 1.0, build 1 for local work. The
workflow stamps the App target's Release configuration at build time only:

- **Version** (`CFBundleShortVersionString`, `MARKETING_VERSION`): the tag
  without its `v`, e.g. `v0.20.0` → `0.20.0`. A pre-release suffix is dropped
  (`v0.20.0-rc.1` → `0.20.0`), because Apple accepts at most three
  dot-separated integers. On a manual run against a branch it comes from
  `package.json`.
- **Build** (`CFBundleVersion`, `CURRENT_PROJECT_VERSION`):
  `<run number>.<run attempt>`, e.g. `57.1`. It always increases, so re-running
  a failed upload or re-cutting a tag never collides with a build App Store
  Connect has already seen.

## Signing

The project uses automatic signing with an Apple Development certificate for
local Xcode work. In CI the workflow switches only the App target's Release
configuration to manual signing with an **Apple Distribution** certificate and
an **App Store Connect** provisioning profile for `com.hearthapp.app` (team
`NANJZZ9DQR`). Swift Package targets are left alone. The certificate is
imported into a temporary keychain that is deleted at the end of the job.

## Secrets to add

Add these under **Settings → Secrets and variables → Actions → New repository
secret** in `jaysbeekay/Hearth`. Never paste their values into issues, PRs or
chat. The workflow fails early with a list of missing names if any are absent.

| Secret | What it is |
| --- | --- |
| `IOS_DIST_CERT_P12_BASE64` | Apple Distribution certificate and its private key, exported as `.p12`, base64-encoded |
| `IOS_DIST_CERT_PASSWORD` | The password you set when exporting that `.p12` |
| `IOS_PROVISIONING_PROFILE_BASE64` | App Store Connect distribution profile for `com.hearthapp.app`, base64-encoded |
| `ASC_API_KEY_ID` | App Store Connect API key ID (10 characters) |
| `ASC_API_ISSUER_ID` | App Store Connect issuer ID (a UUID shown above the keys list) |
| `ASC_API_KEY_P8_BASE64` | The downloaded `AuthKey_<KEY_ID>.p8` file, base64-encoded |

### 1. Apple Distribution certificate (`.p12`)

1. On a Mac, open Xcode → Settings → Accounts, select the team, click
   **Manage Certificates…**, then **+ → Apple Distribution**. (Or create one at
   developer.apple.com → Certificates, Identifiers & Profiles → Certificates.)
2. In Keychain Access, find **Apple Distribution: … (NANJZZ9DQR)** under My
   Certificates, expand it to check the private key is there, right-click →
   **Export…**, save as `.p12` and set a strong password.
3. `base64 -i Distribution.p12 | pbcopy`, then paste into
   `IOS_DIST_CERT_P12_BASE64`. Put the password in `IOS_DIST_CERT_PASSWORD`.

### 2. Provisioning profile

1. developer.apple.com → Certificates, Identifiers & Profiles → Profiles →
   **+**.
2. Choose **App Store Connect** (under Distribution), App ID
   `com.hearthapp.app`, and the certificate from step 1.
3. Download the `.mobileprovision`, then
   `base64 -i Hearth_AppStore.mobileprovision | pbcopy` into
   `IOS_PROVISIONING_PROFILE_BASE64`.

The workflow refuses a profile for a different App ID, and an Ad Hoc or
development profile. A profile is tied to its certificate, so regenerate it
whenever the certificate is renewed (yearly) and update both secrets.

### 3. App Store Connect API key

1. App Store Connect → Users and Access → Integrations → App Store Connect API
   → Team Keys → **+**. Name it e.g. `GitHub Actions TestFlight`, role
   **App Manager** (enough to upload builds; Admin is not needed).
2. Download the `.p8`. Apple only lets you download it once.
3. Copy the **Key ID** into `ASC_API_KEY_ID` and the **Issuer ID** into
   `ASC_API_ISSUER_ID`.
4. `base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy` into `ASC_API_KEY_P8_BASE64`.

## Before the first upload

- The app record for `com.hearthapp.app` must exist in App Store Connect (My
  Apps → **+** → New App). Uploads to a bundle ID with no app record fail.
- **Export compliance.** `Info.plist` has no `ITSAppUsesNonExemptEncryption`
  key, so App Store Connect asks the encryption question on every build and
  the build waits in TestFlight under "Missing Compliance" until it is
  answered. Once you have decided the answer for Hearth (standalone mode
  encrypts its local SQLite database), adding the key to `Info.plist` makes
  this automatic.
- TestFlight processing takes several minutes after the upload step finishes;
  the build then appears under the app's TestFlight tab.

## Runner

The job runs on `macos-26` (Xcode 26, iOS 26 SDK), which App Store Connect
requires for new uploads. The **Show Xcode version** step logs what the runner
actually used.
