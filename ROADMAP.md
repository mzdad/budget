# Månedsbudget roadmap

What to build next, and why. Started 1 October 2026 at version 1.11.0, and kept up to date: finished
items move to "Done" with their version, and keep their number. Biggest wins first within each part;
the size is a rough guess of the work (S = an hour or two, M = a session, L = several sessions).
Everything built before 1.11.0 is in [CHANGELOG.md](CHANGELOG.md).

## Done in 1.16.0

- **3.5 A short report: only the important numbers** (you said: "make it so the report is possible to only print the
  important numbers, not all the posts"). A button on the report screen, "Vis kun de vigtigste tal" / "Vis alle poster".
  The decisions I made:
  - **Kept:** for a month the overview and the categories; for a year month by month and spent per category.
    **Left out:** each income, each fixed expense and every purchase.
  - It applies to the screen and the printout (PDF); **the spreadsheet always has everything**, since a spreadsheet is
    where you want the details.
  - It is a button you tap each time, not a remembered setting: the report starts with everything.

## Done in 1.15.0

- **2.3 Choose the currency: euro, dollar, pound and more** (you said: "Later, I want it possible to change currency, for
  euro dollar pounds and more", and then "do 2.1-2-3"). Indstillinger -> "Valuta · Currency" (12 currencies). The
  decisions I made for the open questions:
  - **No conversion, only the label**: 1.000 kr. becomes 1.000 €; nothing is recalculated.
  - **Per device**, not per account (no change to Firebase's rules): see 2.4 for keeping it in the account.
  - **Number style follows the language** (49,95 € in Danish, €49.95 in English), and the amount boxes ask "Beløb i EUR".
  - **The things that said kr:** the amount boxes and the kid's question ("Hvor mange kroner?") now name the currency; the
    spreadsheet holds plain numbers; the kid's link carries `&cur=`; the bank-picture reader reads €, $, £, the currency
    codes and English thousands (1,250.00).
  - A device that has used the page before stays on kroner; a brand new one takes its browser's country's currency.

## Done in 1.14.0

- **2.2 Danish / English language switch** (you said: "danish/english shifter for language", and later "do 2.1-2-3").
  Indstillinger -> "Sprog · Language". The decisions I made for the open questions:
  - **Money stays in kroner** in both languages; only the NUMBER STYLE changes (12.500 kr. / DKK 12,500) and the dates
    (30.09.2026 / 30/09/2026, "30. september" / "30 September"). Typed amounts are understood in both styles.
  - **The kid's page follows the one who gave the link**: a kid's link now ends in `&lang=da` or `&lang=en`, and the kid's
    phone keeps it. Older links follow the kid's own phone.
  - **A new device starts in the phone's language** (Danish for a Danish phone, English for any other). **A device that has
    used the page before stays Danish**: found while testing, this computer's browser is English, so without this rule your
    computer would have turned English by itself. Choose English in the box if you want it.
  - Kept per device (no change to Firebase's rules). The spreadsheet follows the language (`;` and decimal comma in Danish,
    `,` and decimal point in English).
  - How: every text is `t("Danish text")` in the code (about 330), English in `texts.js`; checked by tests (none missing,
    none left over, same `{names}`), and by drawing every screen in English. Danish was compared screen for screen with
    1.13.1 before and after (66 screens and message sets, character for character): only the new box is different.
  - The bank-picture reader also reads English dates and words ("Tuesday 30 September", "Oct 2", "Today", "Balance").

## Done in 1.13.1

- **1.2 (first part) Your bank's layout** (you sent a real screenshot and said: "the black numbers need to be
  ignored, the red numbers are what the stuff cost, it added nothing from this screenshot"). It had the date in a
  column at the left ("29" over "SEP", on the first line of each day only) and the cost in red at the right with
  the small black balance under it, and the whole picture read as one block came out wrong. Now the page finds
  the columns and reads each on its own, enlarged; the biggest number beside a name is the cost (the small one under it, the balance,
  is left out) and red counts as a cost; the amount column is read at two sizes and a line the two readings
  disagree on says "tjek beløbet"; a comma the reader lost is put back (and says so). Details in CHANGELOG 1.13.1.
  Tested on a layout I drew from your screenshot, not on your file: see 1.2 below for what is left.

## Done in 1.13.0

- **2.1 Colour themes, the first one red and black** (you said: "i would like one thats has kinda red and black in
  it", and later "do 2.1-2-3"). Indstillinger -> Udseende: **Grøn** (the page's normal colours, following the phone's
  light or dark setting) and **Rød og sort**. The decisions I made for the open questions:
  - Red and black is **always dark**, whatever the phone's setting says: black is the point of it.
  - Red is the brand colour (buttons, links, the lit tab); good news is still green and a bar close to its limit
    amber, and "over" a lighter red, so the page's red does not read as a warning. (A separate colour `--good` was
    added for this; before, the brand colour was also the colour of good news.)
  - The choice is kept **per device**, not in the account (no change to Firebase's rules); the kid's own page uses the
    kid's device's choice.
  - Adding a theme later is one block of colours in `style.css` plus one line in `app.js`; a test checks that every
    theme sets every colour.

## Done in 1.12.0

- **1.1 Add purchases from a screenshot of the bank** (you said: "could be cool if I can send a screenshot of my
  bank and the app would add on Overblik instead of me adding 1 at a time ... if the app has problems reading some
  of them it tells me what it could not read"). On Overblik, "Læs fra skærmbillede" under "Tilføj udgift":
  - The picture is read **on the phone** with a free reader (Tesseract.js, `scan.js`); it is never sent anywhere. The
    reader itself (about 6 MB) is downloaded from jsdelivr the first time, so that first time needs internet.
  - What it found is shown **before anything is saved**: a tick, a text, an amount, the day and a category on each
    line, all editable. "Se billedet" shows the picture again for comparing. A shop you wrote before gets its usual
    category, also when the bank's text is longer ("REMA 1000 AARHUS C" finds "Rema 1000"), and picking a category on
    one line fills it in for the same shop on the others.
  - **What it could not read is listed** in a box ("Kunne ikke læses") and never guessed, so you can add it yourself.
  - A purchase already written in (same day and amount) is not ticked ("findes allerede"), so a second picture that
    overlaps the first adds nothing twice. A line that looks like money coming in is not ticked either.
  - Only lines from the month on screen are added; lines from other months are counted and left out (choose the
    picture again in that month).
  - **Why in the app and not Claude** (your rule: use Claude if it is free for others to use, else read in the app):
    Claude's API costs money for every picture and needs a small server to keep the key secret, and the picture would
    leave the phone. So it reads in the page.
  - Tested on pictures drawn by the test itself (light, dark mode, and a small blurry one: all read exactly) and with
    the page's own 480-odd checks. **Not yet on a real bank screenshot**: see 1.2.

## Done in 1.11.1

- **A category you make now goes into every month** (you said: "when I make categories in October, they don't go back
  to September"). Each month keeps its own category list, so a category made in October never reached September. Now a
  new category is added to every saved month, with no limit there (the limit counts only in the month you set it in);
  renaming or deleting still only changes the month you are in. For categories made before: a button "Brug disse
  kategorier i alle måneder" under Indstillinger -> Kategorier.

## Done in 1.11.0

- **4.1 The kids' own page** (you said: "make it possible for my kids to log in, see what money they have and type if
  they use money, nothing else"). Under Indstillinger -> Børn each kid gets a private link ("Giv Nathan sit eget
  link"). Opened on the kid's phone it shows only what the kid has and a box to write what they used: no budget, no
  tabs, no way to add money. What the kid writes shows on their card on Overblik (marked "selv"), in "Heraf" and
  lowers Opsparing on Fremtid. You can delete a post or take the link away. It needs an account. A link and not a
  username and password, because Firebase's sign-up is switched off on your project and a link needs no setup in
  Firebase's console: see 4.2. Tested against the local test copy (two "devices"); the rules were published by you on
  1 October 2026, but a real kid's phone has not been tried: see 5.2.

## 1. Reading the bank's list from a picture

| | What | Why | Size |
|---|---|---|---|
| 1.2 | **Try it on your real screenshot, and on other banks' layouts.** | 1.13.1 reads the layout of the screenshot you sent (as I drew it from the picture: I only had it as a picture in the chat, not as a file). Every bank lists things differently, so more real examples help: save a screenshot in `dev-local\` (never published) and I can test on the file itself. Still open: a list where the date is on every line at the far right, amounts in a colour other than red, and a picture so blurry that numbers are misread the same way twice (the page then shows what it read, but cannot know it is wrong). | M |
| 1.3 | **Several pictures at once**, and a long list stitched from a scroll. | A month is more than one screen of the bank's list. Today each picture is read on its own, and a very long picture is made smaller until it fits (12 million pixels), which makes the letters smaller. | S-M |
| 1.4 | **A stronger reader**, or an optional "send to Claude" button. | If the reading proves too weak on real pictures. A Claude model reads much better, but costs a little for every picture, needs a small server to keep the key secret, and the picture of the bank (account numbers!) leaves the phone, so it would be a choice you make for each picture, never the default. | M |

## 2. How it looks and speaks

| | What | Why | Size |
|---|---|---|---|
| 2.4 | **Keep the currency, the language and the colours in the account**, so a phone and a computer on the same account always agree. | They are kept per device today (in 1.13.0, 1.14.0 and 1.15.0) because keeping them in the account needs a change to Firebase's rules, which you would have to publish by hand once more. A phone and a computer can therefore show different currencies for the same numbers: choose the same on both for now. | S-M |
| 2.5 | **More currencies**, and currencies with no hundredths (yen, Icelandic króna). | The list has 12 currencies that all have hundredths. A currency without them would show the stored hundredths wrongly, so it needs its own handling. Tell me which you need. | S |

## 3. Money and planning

| | What | Why | Size |
|---|---|---|---|
| 3.1 | **One-off expenses in Fremtid** (a holiday, say), and a longer horizon than 12 months. | Fremtid only repeats the plan month after month, so a big expense you know is coming is not in it. | M |
| 3.2 | **A real Excel file (.xlsx)** instead of .csv. | The .csv opens fine in Excel (Danish format), but a real file keeps the look. Needs a library. | M |
| 3.3 | **Spread a yearly bill over the months**, as "put aside per month". | A bill that comes once a year is charged in full in its month and 0 in the others. Spread out, each month carries its share. | S |
| 3.4 | **On a kid's "fik": a tick for "only moved inside the pile"**, so Opsparing does not change. | A kid's "fik" always raises Opsparing (your choice, option A, 1.8.0); if it was only money moved inside the pile you retype the real Opsparing today. | S |

## 4. Kids

| | What | Why | Size |
|---|---|---|---|
| 4.2 | **Kids with their own username and password** instead of a link. | A link is the key: anyone who has it can write on the kid's page. A login is safer if the link is passed on. Needs Firebase's sign-up switched on while the kid's login is made (you turned it off on purpose), so it is more setup for you. | M |

## 5. Keeping the app working

| | What | Why | Size |
|---|---|---|---|
| 5.1 | **Open the page without internet** (a "service worker"). | Today the page needs internet to start, even though the numbers are saved on the phone. The Kortpris app has one. | M |
| 5.2 | **Try a kid's link on a real phone.** | I could only test it against the local test copy of Firebase, never your real project (I never sign in to it). Make a link, open it on a phone, write something, and see it on the kid's card. | S (you) |

## Not planned

- **Sending every bank picture to a Claude model for everyone** (decided 1 October 2026, see 1.1 and 1.4). It costs
  money for every picture, needs a server, and the picture of the bank would leave the phone. Only maybe as an
  optional button, for a single picture you choose.
