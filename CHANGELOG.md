# Changelog

The version number is shown at the bottom of the page. It is set in one place (`index.html`,
by `python dev_set_version.py X.Y.Z`). Newest first.

## 1.2.0 - 2026-09-30

- The page shows its version number at the bottom, and every own file in `index.html` carries
  it (`?v=1.2.0`), so a phone never mixes old and new files after a release.
- Signing in on a device that already has numbers of its own now merges them properly. A month
  the account has keeps the account's plan and gets the purchases that only exist on the device
  (matched to the account's categories by name). Before, such a month was left alone and the
  device's purchases stayed behind.
- Tested with two separate "devices" on the same login: changes show up on the other one by
  themselves, and everything is in the online storage.

## 1.1.0 - 2026-09-30

- **Fremtid:** type the money you have at the start of the month and see what you would have
  after 12 months if the month's plan is kept going.
- **Eksport** (under Plan): a report for a month or a whole year, to download for Excel (.csv) or
  print / save as PDF.
- `firestore.rules`: optional `startBalance` field (the rules must be republished to save the
  "money I have now" box into an account).

## 1.0.0 - 2026-09-30

- First release: Plan, Overblik (what is left, add purchases, category bars), Udgifter.
- Saves on the device, or online in an account (username and password, Firebase) with private
  rules; backup to and from a file.
