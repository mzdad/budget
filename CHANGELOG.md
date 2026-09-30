# Changelog

The version number is shown at the bottom of the page. It is set in one place (`index.html`,
by `python dev_set_version.py X.Y.Z`). Newest first.

## 1.5.0 - 2026-09-30

- **Fixed bills can come every few months, or once a year.** Under each fixed bill a small line says
  "Hver måned". Tap it to choose "Hver 2. / 3. / 6. måned" or "Hvert år", and the first payment
  date (only the month counts). In the months it is due the whole amount counts, in the others
  nothing. Overblik, Fremtid (you see the dips) and the reports follow. Choosing a frequency fills
  in this month as the first payment, so it works at once.
- **A cleverer Note in "Tilføj udgift".** As you type, the notes you have used before are suggested
  (most used first). Picking one, or typing one in full, also picks the category you used for it
  last time - unless you have chosen a category yourself. Note now comes before Kategori in the form.
- No Firebase rules change is needed.

## 1.4.0 - 2026-09-30

- **From / to dates on income and fixed bills** (Plan: "Fra/til dato" under each such row). A row
  counts from its first day to its last day, both included. Use it for a change of income: "Dagpenge"
  to 11.10.2026 and "Løn" from 12.10.2026 hand over to each other by themselves, from one plan.
  In a month where a row counts for only some of the days, its amount counts pro rata by days
  (20 of October's 31 days = 20/31), and the row says what it counts that month. Overblik, Fremtid
  and the reports all follow the dates. No Firebase rules change is needed.

## 1.3.0 - 2026-09-30

- **Fremtid follows months you have set up differently.** Before, it repeated the plan of the
  month on screen for a whole year. Now each of the 12 months uses its own plan if you have set
  it up (a new job from October, say), and a month you have not set up (marked with *) repeats
  the month before it. The screen says when the amount changes from month to month.

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
