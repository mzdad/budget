# Setting up accounts

About 10 minutes, once. The budget keeps accounts in a free **Firebase** project (Google's)
that you own. You create the project; the page only needs its settings. Firebase's free
plan ("Spark") needs no credit card and covers one person's budget for decades.

This is a **separate project from Kortpris**, on purpose: each has its own rules, so a
mistake in one can never open up the other, and your money details never share a database
with card collections.

Firebase moves its menus around now and then. If something below isn't where the guide
says, type its name into **Search for products** at the top left of the Firebase page.

## 1. Create the project

1. Go to <https://console.firebase.google.com> and sign in with your Google account.
2. Click **Create a new Firebase project** (older screens say **Add project**).
3. Name it `maanedsbudget` and click **Continue**.
4. If it offers **Gemini** or **Google Analytics**, switch them off: the budget doesn't use
   them. Click **Create project**, wait for it, then **Continue**.

## 2. Register the web app and send the settings

1. On the project's front page, click **+ Add app** (just under the project name),
   then pick the **`</>`** icon (Web).
2. App nickname: `Budget`. Leave **Firebase Hosting** unticked. Click **Register app**.
3. You'll see code that starts with `const firebaseConfig = {` and has six lines:
   `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`.
   **Copy that block and paste it to Claude in the chat.** It is not secret: every
   visitor's browser needs it to find the project.
4. Click **Continue to console**.

## 3. Switch on username-and-password sign-in

1. Left menu: **Security → Authentication**, then **Get started**.
2. **Sign-in method** tab → **Email/Password** → switch on the first toggle only
   ("Email/Password", not "Email link") → **Save**.

The page turns each username into a made-up address like `emil@budget.example.com`,
so no emails are ever sent.

## 4. Require long passwords on Firebase's side too

1. Still in Authentication: **Settings** tab → **Password policy**.
2. Tick **Require enforcement** and set **Minimum length** to **10**. Firebase often switches
   on the requirements for **uppercase**, **lowercase** and **numeric** characters by default:
   untick them (and leave **symbol** unticked too). The page checks strength itself, and allows
   easy-to-remember phrases like "purple tiger eats rockets". **Save**.

   If you leave those requirements on, it still works: use a password with a capital letter,
   a small letter and a digit, like `Lilla-tiger-raket-47`.

## 5. Create the database for the numbers

1. Left menu: **Databases and storage → Firestore** → **Create database**.
2. If asked for an edition, pick **Standard**.
3. Location: pick one in Europe, such as **eur3 (Europe)** or **europe-north1 (Finland)**.
   It can't be changed later.
4. Choose **Start in production mode** → **Create**.

## 6. Paste the privacy rules

1. In Firestore Database, open the **Rules** tab.
2. Delete everything in the box and paste the whole of `firestore.rules`
   (in this folder, or <https://github.com/mzdad/budget/blob/main/firestore.rules>).
3. Click **Publish**.

These rules are what keep your numbers private: only your own account can read or change
them. Until they are published, the page can't read or save anything in the account.

**When `firestore.rules` changes, do this step again.** It changed once after the first version: the
**Fremtid** screen's money boxes need the newer rules to save into an account.
Until they are published, typing a number there says it could not be saved (everything else keeps
working). It changed again for the **Børn** feature (an optional `pots` field): the kids' numbers
need the newest rules to save into an account. And again for **Penge nu** on Fremtid (an optional
`balances` field): the **Lønkonto** and **Opsparing** numbers need the newest rules to save into an
account.

---

## Afterwards

**Make your account** in the page: the gear **⚙** (Indstillinger) → **Gem dine tal på en konto** → a username and a
password → **Opret ny konto**. Usernames can use a–z, numbers, `-` and `_` (no æ, ø, å).
Passwords need at least 10 characters and must be hard to guess; three words and a number
work well, like `Lilla-tiger-raket-47`. If you already wrote numbers on that device before
making the account, the page asks whether to move them in.

**Sign in on another phone or computer** the same way, with **Log ind**.

**Stop strangers from making accounts** (recommended once your account exists): Authentication
→ **Settings** → **User actions** → untick **Enable create (sign-up)** → **Save**. Signing in
keeps working. Tick it again whenever you want to add an account.

**Forgot the password?** The made-up emails can't receive a reset link. Instead: Authentication
→ **Users** → find `yourname@budget.example.com` → **⋮** → **Delete account**. Then make the
account again in the page with the same username and a new password (tick "Enable create"
first if you switched it off). Your numbers are still there, because they are saved under the
username.

**Delete everything for good:** Authentication → **Users** → **⋮** → **Delete account**, and in
Firestore Database delete the `budgets` collection (it holds one document per month).

## One thing to know

Each month is saved as one piece. If you change the **same month** on two devices **while one
of them has no internet**, the one that reconnects last wins, and the other's change to that
month is lost. With internet on both, changes show up on the other device within a second or
two, so this only matters when you work offline on two devices at once.
