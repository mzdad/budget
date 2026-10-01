# Roadmap - ideas for later

Not built yet. The things that are built are in [CHANGELOG.md](CHANGELOG.md). Newest idea first.

## Add purchases from a screenshot of the bank - BUILT in 1.12.0, still to improve

Built: "Læs fra skærmbillede" on Overblik (see CHANGELOG 1.12.0). It reads the picture on the phone
(free, nothing leaves the phone). Sending the picture to a Claude model would read better but costs
money for every picture and needs a small server, so it was left out (decided 2026-10-01).

Still to do, once it has been tried on real screenshots from the bank:
- Teach it the way YOUR bank lays out its list (a name and an amount on separate lines, a little
  picture in front of each shop, a total per day, and so on). Needs a real example.
- Several pictures at once, and pictures stitched from a long scroll.
- If the reading is too weak: a stronger reader, or an optional "send to Claude" button for someone
  who is willing to pay for it.

## Choose the currency: euro, dollar, pound and more (asked for 2026-10-01)

A choice (in Indstillinger) of which currency the page uses, instead of only kroner: euro, US dollar,
British pound and more. Today every amount is shown as kroner by one function (`formatKr` in
`budget.js`), and the amounts are stored as whole "øre" (hundredths), which works the same for any
currency that has hundredths, so the stored numbers would not need to change. Things to decide when we
get to it:
- **No conversion, only the label.** Changing the currency would NOT recalculate your numbers (1.000 kr.
  would just become 1.000 €); real exchange rates would be a different, bigger feature. The choice is
  for someone who budgets in another currency from the start.
- Whether the choice is kept per account (follows you to every device) or per device.
- How the numbers look: Danish style (1.250,00 kr.) or the style of the currency's country.
- The things that mention "kr" in words or files: the spreadsheet export, the kid's page, and the bank
  screenshot reader (it must then understand €, $ and £ on the bank's list).
- It goes well together with the language switch below, so the two could be done as one piece of work.

## Danish / English language switch (asked for 2026-10-01)

A switch (in Indstillinger) between Danish and English. Today every word on the screens is written
straight into the code in Danish, so the work is to gather all the texts in one place, one list per
language, and have the screens read from it. Things to decide when we get to it: the money stays in
kroner either way (only the words and the month and day names change); whether the kid's own page
follows the language of the device it is opened on; and which language a new device starts in
(the phone's own setting is the natural pick).

## Colour themes (asked for 2026-10-01)

A way to pick a look for the page, with more than one theme. The first one asked for is a **red and
black** theme. The colours already live in one place at the top of `style.css` (plus the dark-mode
set), so a theme is a new set of those colours and a small "Udseende" choice in Indstillinger that
remembers the pick on the device. Things to decide when we get to it: should the themes also follow
the phone's light/dark setting, and should the kid's own page use the same theme.

## Smaller ideas that were offered but not chosen

- One-off expenses in Fremtid (a holiday, say), and a longer horizon than 12 months.
- A real Excel file (.xlsx) instead of .csv.
- Open the page without internet (a "service worker").
- Spread a yearly bill over the months, as "put aside per month".
- On a kid's "fik": a tick for "only moved inside the pile", so Opsparing does not change.
- Kids with their own username and password instead of a link (needs Firebase's sign-up switched
  on while the kid's login is made).
