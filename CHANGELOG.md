# Changelog

The version number is shown at the bottom of the page. It is set in one place (`index.html`,
by `python dev_set_version.py X.Y.Z`). Newest first.

## 1.11.1 - 2026-10-01

- **Bug fix: a category you make now goes into the other months too.** Before, each month kept its
  own list, so a category made in October was missing in September (and the purchases you wanted to
  write in September had nowhere to go). Now a new category is added to every saved month, with no
  limit there; the limit you give it counts only in the month you set it in. Renaming or deleting a
  category still only changes the month you are in.
- **For categories made before this fix:** under Indstillinger -> Kategorier a button
  "Brug disse kategorier i alle måneder" shows while some month lacks one of this month's categories.
  One tap, and they are in every month.

## 1.11.0 - 2026-10-01

- **The kids' own page.** Under Indstillinger -> Børn each kid can get a **private link**
  ("Giv Nathan sit eget link"). Opened on the kid's phone it shows only "Nathan har 4.700 kr." and a
  box to write what he used ("Skriv ind"). No budget, no tabs, and no way to add money.
  - What the kid writes shows on his card on Overblik (marked "· selv"), counts in "Heraf Nathan",
    and lowers Opsparing on Fremtid, like what you write yourself.
  - What you write for the kid (he got money, you changed something) shows on his page by itself.
  - You can delete one of his posts (the x in the card's Historik) or **take the link away**; what he
    wrote stays in your numbers. Removing the kid removes the link too.
  - There is no password: the link is the key (24 random letters and digits). Send it only to the kid.
    The page remembers the link on the kid's phone, so the home-screen icon opens it too.
  - Needs an account. Why a link and not a username and password: Firebase's sign-up is switched off
    for your project (on purpose), and a link needs no setup in Firebase's console.
- **Firebase rules changed again** (a `kidpages` area): publish the new rules for the links to work.
- ROADMAP.md is new: ideas for later (add purchases from a bank screenshot, colour themes).

## 1.10.1 - 2026-10-01

- **Udgifter: the category headings are easier to see.** Each category is now a clear band with a
  green edge, with the name and the total in bold, instead of small grey text.

## 1.10.0 - 2026-10-01

- **A settings tab (the gear ⚙ at the right end of the tab bar).** Everything about how the page
  works now lives there: your **account**, the **categories** (add, rename, and what you want to spend
  on each, with a line saying how much of your money the limits hand out), the **kids**, **Eksport**
  and the **backup**. Plan is shorter now: only the month's summary, **Indkomst**, **Faste udgifter**
  and **Opsparing**, with a link over to the categories. Everything works as before, it just sits in a
  new place. The report's "Tilbage" button goes back to Indstillinger.
- **Fixed: "Åbn rapport" and "Gem kopi som fil" did nothing since 1.6.0.** An edit in 1.6.0
  accidentally dropped the code behind the report (Eksport) and the file download, so those two
  buttons did nothing. It is back, and `node test.js` now opens every screen and checks that every
  button on it has working code behind it, so this cannot slip through again. (Your numbers were
  never affected; they are saved as usual. But no backup file was made by that button in between.)

## 1.9.0 - 2026-10-01

- **Udgifter is split by category.** Each category gets a heading with what was spent in it, and
  under it the purchases, newest day first. Each line shows its day ("2. sep."). Categories with no
  purchases are left out, and purchases with no category come last under "Uden kategori".

## 1.8.2 - 2026-10-01

- **"Tilføj udgift" keeps the date you used.** After adding a purchase, the date box now stays on
  that day instead of jumping back to today (or the 1st), so you can write in several purchases
  from the same day without changing the date each time. It starts over on a new day, and when you
  go to another month.

## 1.8.1 - 2026-10-01

- **A folded "Hvor ofte?" box stays folded.** The small box under an income or fixed-bill row opens
  by itself when it has a frequency or dates. If you folded it, it opened again the next time the
  screen was drawn (for example when you changed month). Now it stays the way you left it, in every
  month and after a restart, for each row on its own. (Rows you never touched behave as before.)

## 1.8.0 - 2026-10-01

- **Penge nu: Lønkonto and Opsparing.** On Fremtid you type what is on your two accounts. Each
  gets a small "Opdateret 1. okt." line, and Fremtid now starts from the total of the two. The
  newest number you type always wins, so typing the real number from the bank is how you correct
  it. (A number you typed on Fremtid before 1.8.0 is still used until you type the two new ones,
  and it says so.)
- **Opsparing follows the kids.** When a kid "brugte" money, Opsparing goes down by that; when a kid
  "fik" money, it goes up. The kid's card says what Opsparing is now. Only things that happen
  after you typed the number count (what came before is already in it), and the money you give a
  kid when you add them (their start amount) never counts, because it was already in the pile.
  Lønkonto never moves by itself. If a "fik" was only money moved inside the pile, type the real
  Opsparing number again.
- **Firebase rules changed again** (an optional `balances` field): publish the new rules for the two
  numbers to save into an account. Nothing else is affected until then.

## 1.7.0 - 2026-09-30

- **The categories card on Overblik can be folded.** Tap "Dine kategorier" to fold it. Folded, it
  shows a small view instead: one line per category with a thin bar and what is left ("200 kr.
  over" in red when a limit is passed). The fold is remembered, also when you add an expense or
  come back later.

## 1.6.0 - 2026-09-30

- **Børn: your kids' savings in your pile.** Under Plan -> "Børn" you add a kid (any name, any
  number of kids) and what they have now. Each kid gets a card on Overblik: "Nathan har 4.450 kr.",
  with one amount box and two buttons, "Nathan brugte" and "Nathan fik". It answers "Nathan brugte
  300 kr. Nu har Nathan 4.450 kr. tilbage." The history is one tap away, and a kid can be removed
  again. On Fremtid one extra line shows how much of the pile is the kids' and how much is yours.
- **Income can come every few months too** (børnepenge every 3rd month): the same "Hver måned"
  line as on fixed bills.
- **Calmer screens.** The explanations are much shorter, and what is left sits behind small "tap for
  more" lines. Fremtid went from 236 to 45 words, Plan from 284 to 186, and the month-by-month
  table is folded until you want it.
- **Firebase rules changed again** (an optional `pots` field): the new rules must be published for
  the kids' numbers to save into an account. Nothing else is affected until then.

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
