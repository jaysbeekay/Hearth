# Store listing drafts (App Store and Google Play)

Draft copy for the Hearth mobile app's store listings. A person pastes it into
App Store Connect and the Play Console; nothing here is submitted
automatically. Tracked in #492.

The standalone promise below is the wording agreed in
[`docs/proposals/standalone-backup-226.md`](../proposals/standalone-backup-226.md)
(section 4, "The promise"). It matches the notice on the paywall and in Help
(`DEVICE_ONLY_NOTICE` in `ios-shell/www/app.js` and the paywall in
`ios-shell/www/index.html`). If you change one, change all three. The app's
backup screens say "password", so the listing does too, where the proposal
said "passphrase".

Rules for any edit:

- Don't promise automatic, cloud or synced backups for standalone mode. Avoid
  the words "automatic", "cloud backup" and "sync" next to standalone mode.
- Keep the sentence that data is on this phone only, and that it cannot be
  recovered without a backup.
- Connected mode is free. Standalone mode is a one-time purchase.

## The standalone promise (both stores)

> Standalone mode keeps everything on this phone only. Nothing is sent to
> Hearth or any cloud. Back up regularly to a file protected by your own
> password, and keep it somewhere safe. If you lose your phone and have no
> backup, your data cannot be recovered.

## App Store (App Store Connect)

**Subtitle** (30 characters max):

> Household records, kept private

**Promotional text** (170 characters max):

> Track contracts, warranties, vehicles and documents. Connect to your own
> Hearth server for free, or keep everything on this phone with a one-time
> unlock.

**Description:**

> Hearth keeps track of your household's contracts, warranties, renewals,
> vehicles and documents, and reminds you before things are due.
>
> Two ways to use it:
>
> Connect to your own server (free). Point the app at the Hearth server you
> host yourself. Your household shares one set of records, and the server
> keeps scheduled backups.
>
> Standalone mode (one-time purchase). Use Hearth on this phone without a
> server. Records and documents are stored in encrypted storage on the
> device.
>
> Standalone mode keeps everything on this phone only. Nothing is sent to
> Hearth or any cloud. Back up regularly to a file protected by your own
> password, and keep it somewhere safe. If you lose your phone and have no
> backup, your data cannot be recovered.
>
> To move to a new phone, export a backup on the old one, save the file to
> Files, iCloud Drive or another place you trust, then choose "Restore from a
> backup" after unlocking standalone mode on the new phone. Backups also move
> between iPhone and Android.
>
> Optional: Connected mode keeps your data on your own Hearth server, with
> scheduled server backups.

**In-app purchase display name:** Standalone unlock

**In-app purchase description** (45 characters max):

> Use Hearth on this phone without a server

## Google Play (Play Console)

**Short description** (80 characters max):

> Household contracts, warranties and documents. Your server, or this phone.

**Full description:**

> Hearth keeps track of your household's contracts, warranties, renewals,
> vehicles and documents, and reminds you before things are due.
>
> Two ways to use it:
>
> Connect to your own server (free). Point the app at the Hearth server you
> host yourself. Your household shares one set of records, and the server
> keeps scheduled backups.
>
> Standalone mode (one-time purchase). Use Hearth on this phone without a
> server. Records and documents are stored in encrypted storage on the
> device.
>
> Standalone mode keeps everything on this phone only. Nothing is sent to
> Hearth or any cloud. Back up regularly to a file protected by your own
> password, and keep it somewhere safe. If you lose your phone and have no
> backup, your data cannot be recovered.
>
> To move to a new phone, export a backup on the old one, save the file to
> Google Drive or another place you trust, then choose "Restore from a
> backup" after unlocking standalone mode on the new phone. Backups also move
> between Android and iPhone.
>
> Optional: Connected mode keeps your data on your own Hearth server, with
> scheduled server backups.

**In-app product name:** Standalone unlock

**In-app product description:**

> Use Hearth on this phone without a server. Your data stays on this phone.

## Before submitting

- Check the character limits in the console; they change from time to time.
- The privacy policy ([`PRIVACY.md`](../../PRIVACY.md)) should say that
  standalone data is stored on the device only, is deleted by uninstalling
  the app, and that backups are the user's responsibility (App Store
  guideline 5.1.1(i)).
- Google Play Data safety: standalone records are processed on the device
  only. A backup the user shares through the share sheet is a user-initiated
  share. Declare what the purchase SDK (RevenueCat) and connected mode send,
  as set up in [`revenuecat.md`](revenuecat.md).
