# Månedsbudget

A small monthly budget page for phone and PC. Danish, kroner.

## What it does

- **Plan** - write your income, your fixed bills, how much you save, and how much you
  want to spend on each kind of thing (food, transport, fun ...). An income or fixed-bill row can
  have a first and a last day ("Fra/til dato"), for a new job, a contract that ends, a new
  subscription. In a month where it counts for only some days, it counts pro rata by days. A fixed
  bill or an income (børnepenge) can also come every 2nd, 3rd or 6th month, or once a year (the
  whole amount in the months it is due).
- **Overblik** - shows what is left to spend this month, and lets you write in every
  purchase (the Note box suggests notes you have used before, and picks their usual category).
  The categories card can be folded to a small view. Each category has a bar that turns amber near its limit and red above it.
- **Udgifter** - every purchase, newest first. Delete a mistake with the ✕.
- **Fremtid** - type what is on your two accounts, **Lønkonto** and **Opsparing** (each shows
  when it was last updated), and it keeps the plan going for 12 months from the total and shows
  what you would have (two versions: spending exactly your category limits, and only saving your
  planned savings). Each month uses its own plan if you have set it up (a new job from October,
  say); a month you have not set up repeats the month before it. It is arithmetic, not a
  prediction. The newest number you type always wins. Opsparing follows the kids: when a kid
  "brugte" money it goes down, when a kid "fik" money it goes up (only what happens after you
  typed it; a kid's start amount was already in the pile and never counts). Lønkonto never moves
  by itself. (In the code: `balances` in the month, and `moneyNow` in budget.js.)
- **Eksport** (on Plan) - a report for one month or a whole year, on screen. Download it for
  Excel (.csv, Danish format with ; and decimal comma) or print it / save it as PDF.
- **Børn** - add your kids under Plan, and each gets a card on Overblik with what they have,
  "brugte" and "fik" buttons, and a history. All the kids' money sits in your one pile; Fremtid
  shows how much of it is theirs. (In the code a kid is a "person" with entries, stored in the
  month's `pots` field.)
- A new month starts as a copy of the last month's plan, with no spending.
- **Saving your numbers**, two ways:
  - **No account:** saved on the device only (the browser's localStorage). Nothing is sent
    anywhere.
  - **With an account** (username + password): saved online, the same on every phone and
    computer you sign in on, and kept safe if you lose your phone. Only your own account can
    read it (see `firestore.rules`). The account box is hidden until Firebase is set up: see
    [SETUP-ACCOUNTS.md](SETUP-ACCOUNTS.md).
- "Gem kopi som fil" on the Plan screen makes a backup file either way.

## Files

| File | What it is |
|---|---|
| `index.html` | The page frame, top bar and tab bar |
| `style.css` | How it looks (colours at the top; dark mode follows the phone) |
| `budget.js` | The maths: amounts, totals, months, the forecast, the reports and spreadsheet text. No screen code |
| `app.js` | The screens, taps, saving, and the sign-in flow |
| `account.js` | Talks to Firebase (sign in, save and watch the months). No screen code |
| `password.js` | Decides whether a new password is strong enough |
| `firebase-config.js` | Which Firebase project to use (`null` until set up) |
| `firestore.rules` | The privacy rules, published by hand in the Firebase console |
| `firebase.json` | Settings for Firebase's local test copy |
| `SETUP-ACCOUNTS.md` | The 10-minute Firebase setup, step by step |
| `test.js` | Checks for `budget.js`, and that every own file in `index.html` has the same version |
| `CHANGELOG.md` | What changed in each version |
| `dev_set_version.py` | Sets the version number in `index.html` (not part of the app) |
| `dev_rules_checks.js` | Checks for `firestore.rules` against the local test copy |
| `manifest.webmanifest`, `icon-*.png` | So it can sit on the home screen like an app |
| `dev_make_icons.py` | Draws the icons (not part of the app) |

## Try it

Serve the folder and open it:

```
python -m http.server 8767
```

then visit http://localhost:8767.

## Test

The maths:

```
node test.js
```

Prints PASS or FAIL for each check and exits with an error if any fail.

The accounts and privacy rules run against Firebase's **local test copy**, which needs
`firebase-tools` and Java 21 and never goes online:

```
firebase emulators:start --project demo-budget --only auth,firestore
node dev_rules_checks.js
```

and the page itself can use that test copy at http://localhost:8767/?emulator (a fake
account can be made there without touching any real project).

## Releasing a new version

The version number (shown at the bottom of the page) lives in one place: the `?v=...` at the end of
each of our own files in `index.html`. To release:

```
python dev_set_version.py 1.3.0
```

then add a `## 1.3.0` section to `CHANGELOG.md`, run `node test.js` (it checks that every file has the
same version and that the changelog has a section for it), commit and push. Phones then fetch the new
files because their addresses changed.

## Money rule

All amounts are stored as whole **øre** (1 kr = 100 øre) to avoid decimal rounding
errors. Only `formatKr` and `amountToInput` in `budget.js` turn them into kroner.

## Hosting

Published with GitHub Pages at https://mzdad.github.io/budget/ . A push to `main`
redeploys it. The repository holds only the page's code: the numbers never go there.
