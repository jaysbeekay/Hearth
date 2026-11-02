# iOS builds and TestFlight

`.github/workflows/ios-testflight.yml` builds the Capacitor shell, signs it for
App Store distribution and uploads it to TestFlight.

## When it runs

| Trigger | Builds a signed IPA | Uploads to TestFlight |
| --- | --- | --- |
| Push of a `v*` tag | Yes | Yes |
| Manual run (Actions → Build iOS and upload to TestFlight) against a `v*` tag | Yes | Yes |
| Manual run against a branch | Yes | Only if **Upload to TestFlight** is ticked |

**Expected failure until it is configured.** Until the secrets below exist,
every pushed `v*` tag starts a run that fails at its first step ("Require
signing and App Store Connect secrets") and lists the missing names. That
failure is expected and doesn't affect `release.yml`, Docker or Android. Once
the secrets are in place, a red run on a tag is a real failure and needs
looking at. Check the Actions tab after each release until the proof run has
passed.

This workflow is deliberately **not yet** one of the builds `release.yml`'s
`artifacts` job dispatches and waits for, so a missing or broken iOS setup
can't fail a release. Until it is, a tag created by running `release.yml` from
the Actions tab (which doesn't fire push workflows, because GitHub doesn't for
refs its own token creates) needs this workflow run manually against it:
Actions → Build iOS and upload to TestFlight → Run workflow, with "Use workflow
from" set to the tag.

**Joining the release.** Once a proof run (below) has reached TestFlight, add
`ios-testflight.yml` to the `workflows=(…)` array in `release.yml`'s
`artifacts` job and raise that job's `timeout-minutes` to 90, since the iOS job
has a 45-minute timeout plus macOS runner queueing. From then on a failed iOS
build fails the release run.

Tag runs use the `release` GitHub environment, like the Android and Docker
jobs. Keep the iOS secrets at repository level until the proof run from `main`
(below) has passed, because a run from a branch can't read environment
secrets. After that you can move them into `release`.

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
- **Build** (`CFBundleVersion`, `CURRENT_PROJECT_VERSION`): a UTC timestamp,
  `<YYYYMMDD>.<HHMMSS>` with the time's leading zeros dropped, e.g.
  `20261031.140501` or `20261031.90501`. It only ever increases, so re-running
  a failed upload, moving or re-cutting a tag, or a manual run never collides
  with or sorts below a build App Store Connect has already seen. A build
  uploaded by hand from Xcode with a small number (e.g. `1`) sorts below these
  and doesn't conflict, but don't hand-upload a build number above today's
  timestamp.

### Pre-release tags

Every `v*` tag is uploaded as a new build of its base version:
`v0.20.0-rc.1`, `v0.20.0-rc.2` and `v0.20.0` all become builds of 0.20.0, in
that order. That is how TestFlight is meant to be used: testers get each
candidate, and you submit the build from the final tag for App Store review.
Once a version has been released on the App Store, App Store Connect rejects
further uploads of it, so a late `-rc` of an already-released version fails at
the upload step. Bump the version instead.

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
chat. The workflow fails before doing any work if any are absent, and fails
right after importing them if the certificate doesn't match the profile, the
profile has expired, or the profile is missing an entitlement the app declares.

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
development profile.

The profile must also cover every capability in the app's entitlements. If
`ios/App/App/App.entitlements` exists (iCloud Documents, container
`iCloud.com.hearthapp.app`), first enable **iCloud** with that container on the
`com.hearthapp.app` identifier (Identifiers → the App ID → Capabilities). Then
generate or regenerate the profile, because a profile made before a capability
was added won't include it, and archiving will fail. A profile is tied to its certificate, so regenerate it
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

- **Prove the pipeline once.** After adding the secrets and merging, run the
  workflow manually from `main` with **Upload to TestFlight** ticked. That
  exercises the macOS runner, archive, signing, export, upload and App Store
  Connect processing end to end with the `package.json` version, without
  cutting a tag. Check:
  - the run is green and the build appears under the app's TestFlight tab
    once processing finishes;
  - its version and build number are what the run logged;
  - the entitlements App Store Connect shows for the build match the app,
    including iCloud if #500 has merged;
  - the export-compliance question, if asked, is answered;
  - re-running the job uploads a second build with a higher number.

  Then add the workflow to `release.yml` (see "Joining the release" above).

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

## Rollback

- **A bad build in TestFlight:** expire it in App Store Connect (the app →
  TestFlight → the build → Expire Build). Nothing reaches the App Store until
  you submit a build for review yourself.
- **The pipeline is blocking releases** (after it joins `release.yml`): remove
  `ios-testflight.yml` from the `artifacts` job's `workflows` array. Docker and
  Android releases then go ahead without it.
- **Turn it off entirely:** disable the workflow (Actions → Build iOS and upload
  to TestFlight → ⋯ → Disable workflow), or delete the file.

## Runner

The job runs on `macos-26` (Xcode 26, iOS 26 SDK), which App Store Connect
requires for new uploads. The **Show Xcode version** step logs what the runner
actually used.
