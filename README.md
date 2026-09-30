# Månedsbudget

A small monthly budget page for phone and PC. Danish, kroner.

## What it does

- **Plan** - write your income, your fixed bills, how much you save, and how much you
  want to spend on each kind of thing (food, transport, fun ...).
- **Overblik** - shows what is left to spend this month, and lets you write in every
  purchase. Each category has a bar that turns amber near its limit and red above it.
- **Udgifter** - every purchase, newest first. Delete a mistake with the ✕.
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
| `budget.js` | The maths: reading amounts, totals, months. No screen code |
| `app.js` | The screens, taps, saving, and the sign-in flow |
| `account.js` | Talks to Firebase (sign in, save and watch the months). No screen code |
| `password.js` | Decides whether a new password is strong enough |
| `firebase-config.js` | Which Firebase project to use (`null` until set up) |
| `firestore.rules` | The privacy rules, published by hand in the Firebase console |
| `firebase.json` | Settings for Firebase's local test copy |
| `SETUP-ACCOUNTS.md` | The 10-minute Firebase setup, step by step |
| `test.js` | Checks for `budget.js` |
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

## Money rule

All amounts are stored as whole **øre** (1 kr = 100 øre) to avoid decimal rounding
errors. Only `formatKr` and `amountToInput` in `budget.js` turn them into kroner.

## Hosting

Published with GitHub Pages at https://mzdad.github.io/budget/ . A push to `main`
redeploys it. The repository holds only the page's code: the numbers never go there.
