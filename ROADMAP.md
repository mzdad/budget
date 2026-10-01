# Roadmap - ideas for later

Not built yet. The things that are built are in [CHANGELOG.md](CHANGELOG.md). Newest idea first.

## Add purchases from a screenshot of the bank (asked for 2026-10-01)

Send a screenshot of the bank's list of purchases, and the page adds them on Overblik instead of
you typing them one at a time. Mostly useful for catching up on earlier months; for the current
month it is fine to write them in as the days come.

What it should do:
- Read each line (date, text, amount) and show them in a list **before** anything is saved, so you
  can untick one or fix it.
- Guess the category from the text with the same help as the Note box (a text you used before gets
  its usual category).
- **Say clearly what it could not read** ("3 lines were unclear: ...") and leave those out, so you
  can add them yourself. Never save a guess silently.
- Skip purchases already written in (same day, same amount, same text), so a second screenshot
  that overlaps the first does not add things twice.

Things to decide when we get to it (they change how it is built):
- **How the text is read from the picture.** Reading it inside the page (free, nothing leaves the
  phone, but it makes more mistakes) or sending it to a Claude model (reads much better, but the
  picture of the bank leaves the phone and needs a small server to keep the key secret, and it costs
  a little per picture). Bank screens show account numbers, so privacy matters here.
- Which banks / which look of screenshot to start with (every bank lists things differently).

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
