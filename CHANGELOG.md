# Changelog

The version number is shown at the bottom of the page. It is set in one place (`index.html`,
by `python dev_set_version.py X.Y.Z`). Newest first.

## 1.17.0 - 2026-10-01

- **Not logged in: only a taste ("try mode").** When nobody is logged in, every screen has a note at the top:
  *"Du er ikke logget ind. Opret en konto eller log ind først for at få den fulde version med gemte tal ..."*,
  with a button to the login box.
  - **Can still be tried:** Overblik (add expenses), Udgifter, Plan and the categories. **Nothing is saved**: what you
    write is gone when the page closes.
  - **Says "log in first":** Fremtid, the report (Eksport), Børn, "Læs fra skærmbillede" (the bank picture) and the backup
    (Sikkerhedskopi). The colours, the language and the currency can still be chosen.
  - **Numbers an earlier version left on the device are not touched**: not shown, not changed, not deleted. The note says so,
    and at the first login the page still offers to move them into the account.
  - Logging out leaves an empty page to try (nothing of the account stays on the screen).
  - Only when accounts are switched on (`firebase-config.js`); without Firebase the page works as before, saving on the device.
  - **To remember:** Firebase's "Enable create (sign-up)" is switched off on the project (you did that on purpose), so
    "Opret ny konto" will say no until it is switched on again: see SETUP-ACCOUNTS.md.

## 1.16.0 - 2026-10-01

- **A short report: only the important numbers.** On the report screen (Indstillinger -> Eksport -> Åbn rapport) there is a new
  button **"Vis kun de vigtigste tal"**. It leaves out every single post and keeps the numbers that add up; tap
  **"Vis alle poster"** to bring them back.
  - **Month:** the overview (income, fixed, savings, available, spent, left) and the categories (limit, spent, left). Left out: each
    income, each fixed expense and every purchase.
  - **Year:** month by month and spent per category. Left out: every purchase.
  - It applies to the screen and to what you print or save as PDF. The spreadsheet (.csv) always has everything.
  - The choice is not remembered: the report starts with everything each time the page is opened.

## 1.15.0 - 2026-10-01

- **Choose the currency.** Under Indstillinger there is a new box **"Valuta · Currency"**: kroner (DKK), euro, US dollar, British
  pound, Swedish and Norwegian kroner, Swiss franc, zloty, Canadian, Australian and New Zealand dollars, and Czech koruna.
  Every amount on every screen, in the report and on the kids' pages is shown in it (12.500 kr., 12.500 €, US$12,500 ...,
  in the number style of the language).
  - **Nothing is converted.** The numbers you have written stay as they are: 1.000 kr. becomes 1.000 €. The choice is for
    budgeting in another currency from the start, not for exchange rates.
  - **The amount boxes ask in the currency** ("Beløb i EUR"); in kroner they say what they always said ("Beløb i kroner").
    A typed amount may carry the currency's sign or code: €12,50, 12.50 EUR, $1,250.50, kr. 50.
  - **Kept per device** (like the language and the colours; no change to Firebase's rules). A device that has used the page
    before stays on kroner; a brand new device takes the currency of the country in its browser's language
    (en-GB: pound, en-US: dollar, de-DE: euro, anything else: kroner).
  - **Kids' links carry the currency** (`&cur=EUR`), so the kid's page shows money in the same currency.
  - **The bank reader knows €, $ and £** (in front of or behind the amount, with the minus before or after the sign) and the
    codes EUR, USD, GBP ..., and English thousands (1,250.00).
- **To remember:** because the choice is per device, a phone and a computer on the same account can show different
  currencies. Choose the same on both. (Roadmap 2.4: keep it in the account.)

## 1.14.0 - 2026-10-01

- **Danish / English.** Under Indstillinger there is a new box **"Sprog · Language"** with Dansk and English.
  Every text on every screen changes, also the tabs at the bottom, the month buttons, the messages, the
  questions the page asks, the report and the kid's page.
  - **Numbers and dates follow the language.** Danish: 12.500 kr., 30.09.2026, "30. september". English: DKK 12,500,
    30/09/2026, "30 September". The money is still in kroner (the currency choice is the next item).
    Typed amounts are understood in both styles: 49,95 and 49.95, 1.250,50 and 1,250.50.
  - **The spreadsheet follows too**: Danish Excel gets `;` between cells and a decimal comma, English Excel gets `,` and a
    decimal point. The headings are in the language.
  - **A new month starts with names in the language** (Løn / Salary, Husleje / Rent, Mad og dagligvarer / Food and
    groceries ...). What you have written yourself (categories, notes, names) stays as you wrote it.
  - **Which language a device starts in:** the one you choose, kept on that phone or computer. A device that has never
    used the page starts in the language of its phone or browser (Danish for a Danish one, English for any other). **A
    device that has used the page before stays Danish**, so a Danish computer with an English browser does not turn
    English on its own; choose English in the box if you want it.
  - **Kids' links carry the language** (`&lang=da` / `&lang=en`): the kid's page opens in the language of the one who gave the
    link, and keeps it on the kid's phone. (Existing links, made before this, follow the kid's own phone.)
  - **The bank reader understands English** too: "Tuesday 30 September", "Oct 2", "Today", "Yesterday", "Balance".
- **For whoever adds texts later:** a text on a screen is written in the code as `t("Dansk tekst")`; the Danish text is also
  the key, and the English one is added in `texts.js` (a test fails if one is missing, or has other `{names}`).
  New file `texts.js`.

## 1.13.1 - 2026-10-01

- **Bug fix: "Læs fra skærmbillede" added nothing from a bank list laid out in columns** (you sent a real
  screenshot: the date in a column at the left, "29" with "SEP" under it, only on the first line of each day;
  the cost in red at the right with the small black balance under it; a little red tick box at the very end).
  Read as one block of text the numbers came out wrong (commas lost, the day numbers garbled), so no line had
  both a date and an amount. Now:
  - **The page finds the columns and reads each one on its own**, enlarged: the whole picture for the names,
    the amount column for the numbers (digits only), and the date column for the days. They are put back
    together by where each word sits on the picture.
  - **Red is a cost, black is ignored**: the biggest number beside a name is the amount (the balance under it
    is smaller and left out), and a red number counts as a cost even when its minus sign was not read. A black
    number without a sign is not a purchase ("ligner penge ind", not chosen).
  - **The amount column is read twice, at two sizes.** If the two readings of a number disagree, the line
    says **"tjek beløbet"** (it is still chosen, but look at it). A comma the reader lost ("-14895" in a list
    where every other amount has two decimals) is put back and says "tjek beløbet" too, so a cost of 148,95
    can no longer turn into 14.895 kr. unnoticed.
  - A name line whose amount could not be found at all is listed under "Kunne ikke læses".
  - "Forretning:" (shop) in front of a name is dropped; the whole picture is read at a bigger size; and the
    reader is no longer thrown by the tick boxes.
  - Lines above the first date on the screen (their date was scrolled away) are listed under "Kunne ikke
    læses" with their amounts, so you can add them by hand.
- **Tested** on a copy of your screenshot's layout that I drew myself (so, not on your real file): in light and
  dark, small, enlarged, and as a blurry JPEG, 22 purchases each; the light, dark, small and enlarged ones are
  exact, and a very blurry JPEG gets flagged lines. Lists with the amount on the same line as the name (like a
  phone's) read as before. **Please try your screenshot again.** If a line is wrong, save the screenshot in
  `D:\Claude - Budget\dev-local\` (that folder is never published) and tell me.

## 1.13.0 - 2026-10-01

- **Colour themes.** Under Indstillinger there is a new box **Udseende** with two looks to choose from:
  - **Grøn**: the colours the page has always had. It follows the phone's light or dark setting.
  - **Rød og sort**: red and black. It is always dark, whatever the phone's setting is. Buttons, links and the
    lit tab are red. Good news stays green (the big "Tilbage at bruge" number, bars that are fine), a bar
    that is close to its limit is amber, and one that is over is a lighter red, so red as the page's colour
    does not look like a warning.
  - The choice is remembered on this phone or computer only (it is not part of your account). The page
    puts the colours on before anything is drawn, so it does not flash in the other colours first. The
    phone's top bar takes the colour too.
  - The kid's own page uses what the kid's device has chosen (the normal green if nothing).
  - More themes can be added later: a theme is one block of colours in `style.css` and one line in
    `THEMES` in `app.js`; a test checks that every theme sets every colour.

## 1.12.0 - 2026-10-01

- **Add purchases from a screenshot of the bank.** On Overblik, under "Tilføj udgift", there is a new
  button **"Læs fra skærmbillede"**. Choose a screenshot of the bank's list of purchases and the page
  reads it and shows what it found, for you to check before anything is saved:
  - Each line has a tick, a text, an amount, the day and a category. Change the text or the amount, pick
    another category, or untick a line. "Se billedet" shows the picture again for comparing.
  - A shop you wrote before gets its usual category, also when the bank's text is longer ("REMA 1000
    AARHUS C" finds "Rema 1000"). Pick a category on one line and the same shop on the other lines
    follows.
  - **Lines it could not read are listed** in a box ("Kunne ikke læses"), never guessed, so you can write
    them in yourself.
  - A purchase already written in (same day and amount) is not ticked ("findes allerede"). A line that
    looks like money coming in is not ticked either ("ligner penge ind").
  - Only lines from the month on screen are added; lines from other months are counted and left out
    (choose the picture again in that month).
  - It reads dark-mode screenshots too. Dates like "Tirsdag 30. september", "30. sep.", "30-09-2026",
    "30/09", "I dag" and "I går" are understood; amounts like "-45,00 kr.", "−1.234,50 kr." and "+25.000,00".
- **How it works, and what leaves the phone.** The picture is read **on the phone** with a free reader
  (Tesseract.js). The picture is never sent anywhere. The reader itself (about 6 MB) is downloaded from
  jsdelivr the first time you use the button, so that first time needs internet. Sending the picture to
  a Claude model would read better, but it costs money for every picture, so it was not chosen.
- **Tested** on pictures drawn by the test itself (light, dark and small blurry ones) and with the
  page's own checks. Real bank screenshots look different from bank to bank: if one reads badly, tell
  me what the bank's list looks like.
- New file `scan.js`.

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
