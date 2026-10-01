// app.js - the screens.
//
// It draws the page, reacts to taps and saves everything on this device.
// The maths and text formatting live in budget.js (loaded before this file).
//
// How drawing works: each screen is a function that builds a piece of HTML as
// text and puts it into <main id="view">. After every change we simply draw the
// whole screen again from the saved numbers - simple, and never out of date.

// The version number lives in one place: the ?v=... at the end of this file's own address in
// index.html (see dev_set_version.py). Reading it from there means it can never disagree with
// the files the phone actually loaded. "dev" when the page is opened without one.
const APP_VERSION = new URL(document.currentScript.src).searchParams.get("v") || "dev";

const STORAGE_KEY = "budget.v1";
// Whether the categories card on Overblik is open or folded. Only a convenience, kept on this device.
const CATEGORIES_OPEN_KEY = "budget.categoriesOpen";
// The same for the small dates / "Hvor ofte?" box under each income and fixed-bill row: what you
// chose for each row ({ rowId: true or false }), kept on this device.
const DATES_OPEN_KEY = "budget.datesOpen";
const MOST_REMEMBERED_ROWS = 300;
// Which colours the page has (Indstillinger -> Udseende), kept on this device.
const THEME_KEY = "budget.theme";
// A theme is a set of colours in style.css, switched on by data-theme="..." on <html>. The first one,
// "green", is the page's normal colours (and has no attribute); it follows the phone's light or dark
// setting. "red" is red and black, always dark. `bar` is the colour of the phone's top bar.
const THEMES = [
	{ id: "green", name: T("Grøn"), note: T("Følger telefonens lyse eller mørke udseende"), color: "#1f7a5a", back: "#111614", bar: "#1f7a5a" },
	{ id: "red", name: T("Rød og sort"), note: T("Altid mørk"), color: "#ff4d4f", back: "#0b0b0c", bar: "#0b0b0c" },
];
// Remembers which account was signed in, so that at the next start the page waits for that
// account's numbers instead of showing (and letting you edit) this device's own copy.
const SIGNED_IN_HINT_KEY = "budget.signedInAs";

// The three lists of rows (income and fixed bills on Plan, categories on Indstillinger) are drawn
// by the same code. Only the texts and the name of the amount field differ ("limit" for categories).
const INCOME_SECTION = {
	key: "income",
	title: T("Indkomst"),
	hint: T("Det du får, efter skat."),
	amountField: "amount",
	addLabel: T("+ Tilføj indkomst"),
	mostRows: MOST_INCOME_ROWS,
	hasDates: true,
	hasFrequency: true,   // income can come every few months too (børnepenge every 3rd month)
};
const FIXED_SECTION = {
	key: "fixed",
	title: T("Faste udgifter"),
	hint: T("Regninger og abonnementer."),
	amountField: "amount",
	addLabel: T("+ Tilføj fast udgift"),
	mostRows: MOST_FIXED_ROWS,
	hasDates: true,
	hasFrequency: true,   // a bill can come every few months, or once a year
};
const CATEGORY_SECTION = {
	key: "categories",
	title: T("Kategorier"),
	hint: T("Det du bruger penge på, og hvor meget du højst vil bruge på hver. En ny kategori kommer i alle måneder; grænsen gælder kun denne måned."),
	amountField: "limit",
	addLabel: T("+ Tilføj kategori"),
	mostRows: MOST_CATEGORIES,
};
const SECTIONS = {
	income: INCOME_SECTION,
	fixed: FIXED_SECTION,
	categories: CATEGORY_SECTION,
};


// --- What the app remembers while it is open --------------------------------

// The account whose numbers are on screen, or null when nobody is signed in and the numbers
// are this device's own copy (in localStorage). Only used when accounts are switched on.
let accountName = accountsAvailable() ? loadSignedInHint() : null;
let watchedAccount = null;                    // the account we are listening to right now
let stopWatching = null;                      // call it to stop listening
let accountReady = false;                     // true once the account's months have arrived
let accountFailed = false;                    // true if Firebase could not be reached at start
let justSignedIn = false;                     // true between pressing "Log ind" and the numbers arriving
let pendingSaves = 0;                         // changes made here that Firebase hasn't confirmed yet
let arrived = null;                           // the newest news from the account: { fresh, hasPendingWrites }
let syncState = "saved";                      // "saved" or "saving"
// The kids' own pages (a private link for each kid, Indstillinger -> Børn). Only while signed in.
let kidPages = {};                            // { <token>: { person, parentSide } }: the pages that exist
let kidEntries = {};                          // { <token>: [...] }: what each kid has written on their page
let kidEntryWatchers = {};                    // { <token>: a function that stops listening }
let stopKidPages = null;                      // call it to stop listening for pages
let kidPagesLoaded = false;                   // true once the account has said which pages exist
let kidPublished = {};                        // { <token>: the parentSide we sent and have not seen come back }
let kidLinkNote = "";                         // what the last link button said, shown under the link buttons

let data = accountName === null ? signedOutData() : { months: {} };   // { months: { "2026-09": {...} } }
let viewMonth = monthKeyOf(new Date());       // the month on screen
let activeTab = "overview";                   // "overview", "expenses", "future", "plan", "settings" or "report"
let reportScope = null;                       // what the report shows: { type: "month" | "year", key }
let reportShort = false;                      // true: the report leaves out the single items and keeps the totals
let lastCategoryId = "";                      // so the next purchase starts on the same category
let lastDate = { date: "", chosenOn: "" };    // so the next purchase starts on the same day (see addFormHtml)
let categoriesOpen = loadCategoriesOpen();    // is the categories card on Overblik open?
let datesOpen = loadDatesOpen();              // rows whose dates box you opened or folded yourself
let currentTheme = loadTheme();               // which colours the page has (see THEMES)
let shareNote = "";                           // what "Brug disse kategorier i alle måneder" said, shown once
let bankImport = null;                        // a picture of the bank being read or checked (see "Add purchases from a picture")


// --- Saving and loading ------------------------------------------------------
//
// localStorage is a small notebook the browser keeps for this page, on this
// device only. Nothing is sent anywhere.

function loadData() {
	try {
		const text = localStorage.getItem(STORAGE_KEY);
		if (text) {
			return cleanData(JSON.parse(text));
		}
	} catch (error) {
		// Damaged text, or the browser blocks storage. Start with an empty notebook.
		console.warn("Could not read the saved budget:", error);
	}
	return { months: {} };
}

// --- Try mode: nobody is logged in ----------------------------------------------
//
// When accounts are switched on and nobody is logged in, the page is only a taste. Overblik,
// Udgifter, Plan and the categories can be tried, but NOTHING is saved: it is gone when the page
// closes. Fremtid, the report, the kids, the bank picture and the backup say "log in first".
// Numbers that an earlier version left on this device are never read, changed or deleted in this
// mode: the first login offers to move them into the account (offerToMoveDeviceData).
// Without accounts (firebase-config.js empty) the page works as it always did, saving on the device.

function tryMode() {
	return accountsAvailable() && accountName === null;
}

// The numbers to start from when nobody is logged in.
function signedOutData() {
	return tryMode() ? { months: {} } : loadData();
}

// A card that says "log in first" in the place of something that needs an account.
function lockedHtml(title) {
	return `
		<section class="card">
			<h2>${title}</h2>
			<p class="hint">${t("Log ind eller opret en konto først for at bruge dette.")}</p>
			<button class="secondary" data-action="go-login">${t("Log ind eller opret konto")}</button>
		</section>`;
}

// The note at the top of every screen while nobody is logged in.
function tryBannerHtml() {
	// Numbers from before, still on this device: say that they are safe.
	let kept = "";
	if (Object.keys(loadData().months).length > 0) {
		kept = `<p class="hint">${t("Tal, der er gemt på denne enhed fra før, er ikke væk: du kan lægge dem ind på kontoen, når du logger ind.")}</p>`;
	}
	// On Indstillinger the login box is right below, so no button there.
	const button = activeTab === "settings"
		? ""
		: `<button class="secondary" data-action="go-login">${t("Log ind eller opret konto")}</button>`;
	return `
		<section class="card try-banner">
			<h2>${t("Du er ikke logget ind")}</h2>
			<p>${t("Opret en konto eller log ind først for at få den fulde version med gemte tal. Indtil da kan du kun prøve det af: det du skriver, bliver ikke gemt og er væk, når du lukker siden.")}</p>
			${kept}
			${button}
		</section>`;
}

function noStorageWarning() {
	return t("Din browser vil ikke gemme tal her (måske et privat vindue?). Det du skriver, forsvinder, når du lukker siden.");
}

// Shows a message in the orange bar under the month switcher; "" hides it.
function setWarning(text) {
	const bar = document.getElementById("save-warning");
	bar.textContent = text;
	bar.hidden = text === "";
}

function saveData() {
	if (tryMode()) {
		return;   // nothing is saved while nobody is logged in
	}
	let worked = true;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
	} catch (error) {
		worked = false;
	}
	setWarning(worked ? "" : noStorageWarning());
}

// Some browsers (private windows) refuse to save. Find out at start, so the
// warning shows before the user types anything.
function checkStorage() {
	if (tryMode()) {
		return;   // nothing is going to be saved here, so there is nothing to warn about
	}
	let worked = true;
	try {
		localStorage.setItem("budget.check", "1");
		localStorage.removeItem("budget.check");
	} catch (error) {
		worked = false;
	}
	setWarning(worked ? "" : noStorageWarning());
}

function loadCategoriesOpen() {
	try {
		return localStorage.getItem(CATEGORIES_OPEN_KEY) !== "0";   // open unless it was folded
	} catch (error) {
		return true;
	}
}

function saveCategoriesOpen(isOpen) {
	try {
		localStorage.setItem(CATEGORIES_OPEN_KEY, isOpen ? "1" : "0");
	} catch (error) {
		// Only a convenience; the page works without it.
	}
}

function loadDatesOpen() {
	try {
		const saved = JSON.parse(localStorage.getItem(DATES_OPEN_KEY));
		return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
	} catch (error) {
		return {};
	}
}

// Remembers that you opened or folded this row's box. Only the newest MOST_REMEMBERED_ROWS rows
// are kept, so rows you deleted long ago don't pile up.
function rememberDatesOpen(rowId, isOpen) {
	delete datesOpen[rowId];
	datesOpen[rowId] = isOpen;   // (re-added last, so it counts as the newest)
	for (const oldest of Object.keys(datesOpen).slice(0, -MOST_REMEMBERED_ROWS)) {
		delete datesOpen[oldest];
	}
	try {
		localStorage.setItem(DATES_OPEN_KEY, JSON.stringify(datesOpen));
	} catch (error) {
		// Only a convenience; the page works without it.
	}
}

// ---- The language ---------------------------------------------------------------------
//
// The texts of the page are written in Danish in the code, inside t("...") (texts.js); with English
// chosen t() gives the English text. The few texts that sit in index.html (the tabs, the month
// buttons) carry data-i18n="the Danish text" and are put in here.

const LANGUAGE_KEY = "budget.language";
const CURRENCY_KEY = "budget.currency";

// The saved choice. With none: a device that has used this page before stays Danish (a Danish person's
// computer with an English browser must not turn the page English on its own). A brand new device
// starts in the language of the phone or browser: Danish for a Danish one, English for any other.
function loadLanguage() {
	try {
		const saved = localStorage.getItem(LANGUAGE_KEY);
		if (LANGUAGES.some((language) => language.id === saved)) {
			return saved;
		}
		if ([STORAGE_KEY, SIGNED_IN_HINT_KEY, CATEGORIES_OPEN_KEY, THEME_KEY].some((key) => localStorage.getItem(key) !== null)) {
			return DEFAULT_LANGUAGE;
		}
	} catch (error) {
		// Nothing readable: the phone's own.
	}
	return languageOfPhone(navigator.languages && navigator.languages.length > 0 ? navigator.languages : [navigator.language]);
}

// The language to start in. A link can name one (?lang=en; a kid's link does, so the kid's page is
// in the language of the one who gave the link) and that is then kept on this device, so the
// home-screen icon, which has no link, keeps it. Otherwise loadLanguage().
function languageForStart() {
	const fromLink = new URLSearchParams(location.search).get("lang");
	if (LANGUAGES.some((language) => language.id === fromLink)) {
		saveLanguage(fromLink);
		return fromLink;
	}
	return loadLanguage();
}

function saveLanguage(id) {
	try {
		localStorage.setItem(LANGUAGE_KEY, id);
	} catch (error) {
		// Only a convenience; the page works without it.
	}
}

// The currency, kept per device like the language: the saved choice; a device that has used the page before
// stays on kroner; a brand new device takes the currency of the country in its browser's language.
function loadCurrency() {
	try {
		const saved = localStorage.getItem(CURRENCY_KEY);
		if (CURRENCIES.includes(saved)) {
			return saved;
		}
		if ([STORAGE_KEY, SIGNED_IN_HINT_KEY, CATEGORIES_OPEN_KEY, THEME_KEY].some((key) => localStorage.getItem(key) !== null)) {
			return DEFAULT_CURRENCY;
		}
	} catch (error) {
		// Nothing readable: the country's own.
	}
	return currencyOfPhone(navigator.languages && navigator.languages.length > 0 ? navigator.languages : [navigator.language]);
}

function saveCurrency(code) {
	try {
		localStorage.setItem(CURRENCY_KEY, code);
	} catch (error) {
		// Only a convenience; the page works without it.
	}
}

// The currency to start in: one named by a link (?cur=EUR; a kid's link names it) and then kept on this
// device, else loadCurrency().
function currencyForStart() {
	const fromLink = new URLSearchParams(location.search).get("cur");
	if (CURRENCIES.includes(fromLink)) {
		saveCurrency(fromLink);
		return fromLink;
	}
	return loadCurrency();
}

// The texts in index.html: elements marked data-i18n (the text), data-i18n-aria (aria-label) and
// data-i18n-title (title), plus the page's title and language.
function applyStaticTexts() {
	for (const element of document.querySelectorAll("[data-i18n]")) {
		element.textContent = t(element.dataset.i18n);
	}
	for (const element of document.querySelectorAll("[data-i18n-aria]")) {
		element.setAttribute("aria-label", t(element.dataset.i18nAria));
	}
	for (const element of document.querySelectorAll("[data-i18n-title]")) {
		element.setAttribute("title", t(element.dataset.i18nTitle));
	}
	document.title = t("Månedsbudget");
	document.documentElement.lang = getLanguage();
	document.getElementById("app-version").textContent = t("Version {version}", { version: APP_VERSION });
}

// ---- The look: colour themes (the list is THEMES, at the top) ---------------------------

function loadTheme() {
	try {
		const saved = localStorage.getItem(THEME_KEY);
		return THEMES.some((theme) => theme.id === saved) ? saved : THEMES[0].id;
	} catch (error) {
		return THEMES[0].id;
	}
}

function saveTheme(id) {
	try {
		localStorage.setItem(THEME_KEY, id);
	} catch (error) {
		// Only a convenience; the page works without it.
	}
}

// Puts the theme on the page (and the phone's top bar).
function applyTheme(id) {
	const theme = THEMES.find((other) => other.id === id) || THEMES[0];
	if (theme.id === THEMES[0].id) {
		document.documentElement.removeAttribute("data-theme");
	} else {
		document.documentElement.setAttribute("data-theme", theme.id);
	}
	const bar = document.querySelector('meta[name="theme-color"]');
	if (bar) {
		bar.setAttribute("content", theme.bar);
	}
	currentTheme = theme.id;
}

function loadSignedInHint() {
	try {
		return localStorage.getItem(SIGNED_IN_HINT_KEY);
	} catch (error) {
		return null;
	}
}

function saveSignedInHint(username) {
	try {
		if (username === null) {
			localStorage.removeItem(SIGNED_IN_HINT_KEY);
		} else {
			localStorage.setItem(SIGNED_IN_HINT_KEY, username);
		}
	} catch (error) {
		// Only a convenience; the page works without it.
	}
}

// Saves one month: to the account when signed in, otherwise to this device.
function saveMonth(key, month) {
	if (accountName === null) {
		saveData();
		return;
	}
	syncState = "saving";
	showSyncStatus();

	// Count the change as "on its way" until Firebase confirms it (offline: until we are online
	// again). While any are on their way, news from the account is NOT taken (see takeArrivedNews).
	const account = accountName;
	pendingSaves += 1;
	saveAccountMonth(account, key, month)
		.catch((error) => {
			console.error(error);
			setWarning(t("Kunne ikke gemme på kontoen: {problem}", { problem: accountProblemText(error) }));
		})
		.finally(() => {
			if (account === accountName) {
				pendingSaves -= 1;
				takeArrivedNews();
			}
		});
}

// The month to show. A month nobody has saved yet is built on the fly from the
// nearest saved month's plan - but only SAVED once something in it changes, so
// just browsing forward never leaves stale copies behind.
function getMonth(key) {
	if (data.months[key]) {
		return data.months[key];
	}
	const source = nearestMonthWithData(data.months, key);
	if (source) {
		return copyPlanOf(data.months[source]);
	}
	return starterMonth();
}

// Every change goes through here: get the month, let `change` edit it, save.
function changeMonth(change, key) {
	const monthKey = key || viewMonth;
	const month = getMonth(monthKey);
	change(month);
	data.months[monthKey] = month;
	saveMonth(monthKey, month);
}


// --- Small helpers ------------------------------------------------------------

// Names typed by the user end up inside HTML text. Without this, a name like
// <b> would break the page (and a backup file could inject code).
function esc(text) {
	return String(text)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function categoryName(month, categoryId) {
	for (const category of month.categories) {
		if (category.id === categoryId) {
			return category.name || t("(uden navn)");
		}
	}
	return t("Uden kategori");
}

function findRow(list, id) {
	return list.find((row) => row.id === id);
}

// Writes a short note under a form ("Tilføjet ..." or an error in red).
function setMessage(elementId, text, isError) {
	const element = document.getElementById(elementId);
	if (!element) {
		return;
	}
	element.textContent = text;
	element.classList.toggle("bad", isError);
}

// "1 måned", "3 måneder"
function monthsText(count) {
	return tn(count, "{n} måned", "{n} måneder");
}

// A month's name in the middle of a sentence: "i september 2026" in Danish (months are written with a
// small letter there), "in September 2026" in English.
function monthInSentence(key) {
	const label = monthLabel(key);
	return getLanguage() === "da" ? label.toLowerCase() : label;
}

function minus(ore) {
	return ore === 0 ? formatKr(0) : "− " + formatKr(ore);
}


// --- Drawing ------------------------------------------------------------------

function render() {
	const month = getMonth(viewMonth);

	document.getElementById("month-label").textContent = monthLabel(viewMonth);
	document.getElementById("this-month").hidden = viewMonth === monthKeyOf(new Date());

	let html = "";
	if (accountName !== null && !accountReady) {
		// Never show or edit a month before the account's own numbers have arrived:
		// a month saved from here could replace one the account already has.
		html = loadingHtml();
	} else if (activeTab === "overview") {
		html = overviewHtml(month);
	} else if (activeTab === "expenses") {
		html = expensesHtml(month);
	} else if (activeTab === "future") {
		html = tryMode() ? lockedHtml(t("Fremtid")) : futureHtml(month);
	} else if (activeTab === "settings") {
		html = settingsHtml(month);
	} else if (activeTab === "report" && reportScope !== null && !tryMode()) {
		html = reportHtml();
	} else {
		html = planHtml(month);
	}
	if (tryMode()) {
		html = tryBannerHtml() + html;
	}
	document.getElementById("view").innerHTML = html;
	showSyncStatus();
	syncKidPages();

	// The report is opened from Indstillinger (Eksport) and has no tab of its own, so that tab stays lit.
	const litTab = activeTab === "report" ? "settings" : activeTab;
	for (const button of document.querySelectorAll(".tabs button")) {
		const isActive = button.dataset.tab === litTab;
		button.classList.toggle("active", isActive);
		if (isActive) {
			button.setAttribute("aria-current", "page");
		} else {
			button.removeAttribute("aria-current");
		}
	}
}


// Shown instead of the screens while a signed-in account's numbers are on their way.
function loadingHtml() {
	if (accountFailed) {
		return `
			<section class="card">
				<h2>${t("Kunne ikke hente dine tal")}</h2>
				<p>${t("Tjek, at du har internet, og prøv igen. Dine tal er ikke væk.")}</p>
				<button class="primary" data-action="retry">${t("Prøv igen")}</button>
			</section>`;
	}
	return '<section class="card"><h2>' + t("Henter dine tal …") + '</h2><p class="hint">' + t("Et øjeblik.") + "</p></section>";
}

// The thin line under the month switcher: is everything saved? Only shown when signed in.
function showSyncStatus() {
	const line = document.getElementById("sync-status");
	if (accountName === null || !accountReady) {
		line.hidden = true;
		return;
	}
	if (!navigator.onLine) {
		line.textContent = t("Ingen forbindelse. Dine ændringer gemmes, når du er online igen.");
	} else if (syncState === "saving") {
		line.textContent = t("Gemmer …");
	} else {
		line.textContent = t("✓ Gemt på kontoen");
	}
	line.hidden = false;
}

// ---- Screen 1: Overblik ------------------------------------------------------

function overviewHtml(month) {
	const s = summarize(month, viewMonth);
	let html = "";
	if (s.income === 0 && month.spending.length === 0) {
		html += welcomeHtml();
	}
	html += bankImportHtml();
	html += leftCardHtml(s);
	html += addFormHtml(month);
	html += categoryBarsHtml(s);
	html += potCardsHtml();
	potMessage = null;   // a message is shown once
	return html;
}

function welcomeHtml() {
	return `
		<section class="card">
			<h2>${t("Kom i gang")}</h2>
			<ol>
				<li>${t("Skriv din indkomst og dine faste udgifter under <b>Plan</b>.")}</li>
				<li>${t("Skriv hver udgift ind her.")}</li>
			</ol>
			<button class="primary" data-tab="plan">${t("Start med planen")}</button>
		</section>`;
}

// The big number: what is left to spend this month.
function leftCardHtml(s) {
	let tone = "";
	if (s.left < 0) {
		tone = "bad";
	} else if (s.left > 0) {
		tone = "good";
	}

	let note = "";
	const daysLeft = daysLeftInMonth(viewMonth, new Date());
	if (s.left < 0) {
		note = t("Du er {amount} over budget.", { amount: formatKr(-s.left) });
	} else if (s.left === 0 && s.available > 0) {
		note = t("Hele beløbet er brugt.");
	} else if (daysLeft !== null && s.left > 0) {
		// Whole kroner per day, rounded down, so the advice is never too generous.
		const perDayKr = Math.floor(s.left / daysLeft / 100);
		if (perDayKr > 0) {
			note = tn(daysLeft, "Det svarer til ca. {amount} om dagen i {n} dag.", "Det svarer til ca. {amount} om dagen i {n} dage.", { amount: formatKr(perDayKr * 100) });
		} else {
			note = t("Der er næsten ikke noget tilbage.");
		}
	}

	return `
		<section class="card">
			<div class="label">${t("Tilbage at bruge")}</div>
			<div class="big-number ${tone}">${formatKr(s.left)}</div>
			<p>${esc(note)}</p>
			<div class="facts">
				<span>${t("Til rådighed")} <b>${formatKr(s.available)}</b></span>
				<span>${t("Brugt")} <b>${formatKr(s.spent)}</b></span>
			</div>
		</section>`;
}

function categoryOptionsHtml(month) {
	if (month.categories.length === 0) {
		return '<option value="">' + t("Uden kategori") + "</option>";
	}
	let html = "";
	for (const category of month.categories) {
		const selected = category.id === lastCategoryId ? " selected" : "";
		html += `<option value="${esc(category.id)}"${selected}>${esc(category.name || t("(uden navn)"))}</option>`;
	}
	return html;
}

// The notes you have used before, offered while you type in the Note box (a <datalist>: the
// browser shows the matching ones itself). Picking one also picks its usual category (see
// pickCategoryFromNote). Rebuilt each time the form is drawn, so a note you just added is in it.
let noteSuggestions = [];

function noteOptionsHtml() {
	noteSuggestions = noteHistory(data.months);
	return noteSuggestions.map((entry) => `<option value="${esc(entry.note)}"></option>`).join("");
}

// The form for writing in a purchase. The date box only allows days in the month
// on screen, so a purchase can never end up in the wrong month.
//
// It starts on the day of your last purchase, so you can write in several purchases from the same
// day without changing the date each time. That only holds for the same month, and only the same
// day you wrote it (a page left open overnight starts on the new day). Otherwise: today, or the
// 1st when the month on screen is not this month.
function addFormHtml(month) {
	const today = dateKeyOf(new Date());
	const firstDay = viewMonth + "-01";
	const lastDay = viewMonth + "-" + String(lastDayOfMonth(viewMonth)).padStart(2, "0");
	const keepLast = lastDate.chosenOn === today && lastDate.date.slice(0, 7) === viewMonth;
	const dateValue = keepLast ? lastDate.date : (today.slice(0, 7) === viewMonth ? today : firstDay);

	return `
		<form id="add-form" class="card" autocomplete="off">
			<h2>${t("Tilføj udgift")}</h2>
			<label>${amountLabel()}
				<input name="amount" inputmode="decimal" placeholder="${t("fx 49,95")}" required>
			</label>
			<label>${t("Note (hvis du vil)")}
				<input name="note" list="note-suggestions" maxlength="${MAX_NOTE_LENGTH}" placeholder="${t("fx Rema 1000")}">
				<datalist id="note-suggestions">${noteOptionsHtml()}</datalist>
			</label>
			<label>${t("Kategori")}
				<select name="category">${categoryOptionsHtml(month)}</select>
			</label>
			<label>${t("Dato")}
				<input type="date" name="date" value="${dateValue}" min="${firstDay}" max="${lastDay}" required>
			</label>
			<button type="submit" class="primary">${t("Tilføj")}</button>
			<p id="add-message" class="message" role="status"></p>
			${tryMode() ? bankPictureLockedHtml() : bankPictureButtonHtml()}
		</form>`;
}

function bankPictureButtonHtml() {
	return `
		<label class="button secondary">${t("Læs fra skærmbillede")}
			<input type="file" id="bank-picture" accept="image/*" hidden>
		</label>
		<p class="hint">${t("Et skærmbillede af bankens liste over køb. Det læses her på din telefon og sendes ikke videre. Du tjekker alt, før det gemmes.")}</p>`;
}

// While nobody is logged in the button is a "log in first" instead (a button, not a form field,
// so it does not submit the form above it).
function bankPictureLockedHtml() {
	return `<button type="button" class="secondary" data-action="go-login">${t("Læs fra skærmbillede: log ind først")}</button>`;
}

// The categories card: a fold. Open, each category has a bar and a note. Folded, it shows a
// small view instead - one line per category with a thin bar and what is left - so you can still
// see how you are doing without the space. The fold is remembered (categoriesOpen).
function categoryBarsHtml(s) {
	if (s.categories.length === 0 && s.otherSpent === 0) {
		return '<section class="card"><h2>' + t("Dine kategorier") + '</h2><p class="hint">' + t("Lav kategorier under Indstillinger.") + '</p><button class="secondary" data-tab="settings">' + t("Åbn indstillinger") + "</button></section>";
	}

	let full = "";
	let mini = "";
	for (const category of s.categories) {
		full += categoryBarHtml(category);
		mini += categoryMiniHtml(category);
	}
	if (s.otherSpent > 0) {
		full += `
			<div class="category">
				<div class="category-top"><span>${t("Uden kategori")}</span><span class="amounts">${formatKr(s.otherSpent)}</span></div>
			</div>`;
		mini += `<span class="mini-row"><span class="mini-name">${t("Uden kategori")}</span><span></span><span class="mini-amount">${formatKr(s.otherSpent)}</span></span>`;
	}

	return `
		<section class="card categories-card">
			<details id="categories-details" ${categoriesOpen ? "open" : ""}>
				<summary><h2>${t("Dine kategorier")}</h2><span class="mini">${mini}</span></summary>
				${full}
			</details>
		</section>`;
}

// One category as a single line for the folded card: name, a thin bar, and what is left
// ("over" in red when the limit is passed; just what is spent when there is no limit).
function categoryMiniHtml(category) {
	const level = barLevel(category.spent, category.limit);
	const width = Math.round(barShare(category.spent, category.limit) * 100);

	let amount = "";
	if (level === "nolimit") {
		amount = formatKr(category.spent);
	} else if (level === "over") {
		amount = t("{amount} over", { amount: formatKr(-category.left) });
	} else {
		amount = formatKr(category.left);
	}

	return `
		<span class="mini-row">
			<span class="mini-name">${esc(category.name || t("(uden navn)"))}</span>
			<span class="bar mini-bar" role="img" aria-label="${t("{width} procent brugt", { width: width })}"><span class="fill ${level}" style="width:${width}%"></span></span>
			<span class="mini-amount ${level === "over" ? "over" : ""}">${amount}</span>
		</span>`;
}

function categoryBarHtml(category) {
	const level = barLevel(category.spent, category.limit);
	const width = Math.round(barShare(category.spent, category.limit) * 100);

	let note = "";
	if (level === "nolimit") {
		note = t("Ingen grænse");
	} else if (level === "over") {
		note = t("{amount} over grænsen", { amount: formatKr(-category.left) });
	} else {
		note = t("{amount} tilbage", { amount: formatKr(category.left) });
	}

	const amounts = category.limit > 0
		? t("{spent} af {limit}", { spent: formatKr(category.spent), limit: formatKr(category.limit) })
		: formatKr(category.spent);

	return `
		<div class="category">
			<div class="category-top">
				<span>${esc(category.name || t("(uden navn)"))}</span>
				<span class="amounts">${amounts}</span>
			</div>
			<div class="bar" role="img" aria-label="${t("{width} procent brugt", { width: width })}">
				<div class="fill ${level}" style="width:${width}%"></div>
			</div>
			<div class="note ${level === "over" ? "over" : ""}">${note}</div>
		</div>`;
}


// ---- Screen 2: Udgifter --------------------------------------------------------

function expensesHtml(month) {
	const s = summarize(month, viewMonth);
	let html = `
		<section class="card">
			<div class="label">${t("Brugt i alt i {month}", { month: esc(monthInSentence(viewMonth)) })}</div>
			<div class="big-number">${formatKr(s.spent)}</div>
		</section>`;

	if (month.spending.length === 0) {
		return html + '<section class="card"><p class="hint">' + t("Ingen udgifter endnu.") + "</p></section>";
	}

	// One heading per category (with what was spent in it), the newest purchase first under it.
	// Each line says its day, because there are no day headings any more.
	html += '<section class="card">';
	for (const group of spendingByCategory(month)) {
		html += `
			<div class="group-head"><h3>${esc(group.name)}</h3><span class="group-total">${formatKr(group.total)}</span></div>
			<ul class="list">`;
		for (const item of group.items) {
			const day = shortDayText(item.date);
			const title = item.note !== "" ? esc(item.note) : day;
			const small = item.note !== "" ? `<small>${day}</small>` : "";
			html += `
				<li>
					<div class="what">${title}${small}</div>
					<span class="money">${formatKr(item.amount)}</span>
					<button class="icon" data-action="delete-spending" data-id="${esc(item.id)}" aria-label="${t("Slet udgiften")}">✕</button>
				</li>`;
		}
		html += "</ul>";
	}
	return html + "</section>";
}

// "2026-09-02" -> "2. sep."
function shortDayText(dateKey) {
	const parts = dateKey.split("-").map(Number);
	return new Intl.DateTimeFormat(uiLocale(), { day: "numeric", month: "short" }).format(new Date(parts[0], parts[1] - 1, parts[2]));
}


// ---- Screen 3: Fremtid -----------------------------------------------------------
//
// "How much money will I have in a year?" It takes the plan of the month on screen and keeps it
// going for FORECAST_MONTHS months (the maths is forecast() in budget.js).

function futureHtml(month) {
	const now = moneyNow(monthsForMoney());
	const hasKids = potBalances(monthsForMoney()).length > 0;
	return `
		<section class="card">
			<h2>${t("Penge nu")}</h2>
			<p class="hint">${hasKids ? t("Opsparing er hele bunken, også børnenes penge.") : t("Hvad står der på dine konti lige nu?")}</p>
			<div class="single-row">
				<label for="account-balance">${t("Lønkonto")}</label>
				<input id="account-balance" data-balance="account" value="${balanceInputText(now.account, now.accountNow)}" placeholder="0" inputmode="decimal" autocomplete="off">
			</div>
			<p class="balance-note" id="account-note">${esc(accountNoteText(now))}</p>
			<div class="single-row">
				<label for="savings-balance">${t("Opsparing")}</label>
				<input id="savings-balance" data-balance="savings" value="${balanceInputText(now.savings, now.savingsNow)}" placeholder="0" inputmode="decimal" autocomplete="off">
			</div>
			<p class="balance-note" id="savings-note">${esc(savingsNoteText(now))}</p>
			<div id="money-total">${moneyTotalHtml(month, now)}</div>
			<details class="explain">
				<summary>${t("Hvad betyder det?")}</summary>
				<p class="hint">${t("Skriv tallene fra banken. Det nyeste, du skriver, gælder altid.")}${hasKids ? " " + t("Opsparing går ned, når et barn bruger penge, og op, når et barn får penge.") : ""} ${t("Lønkonto ændrer sig ikke af sig selv.")}</p>
			</details>
		</section>
		<div id="future-results">${futureResultsHtml(month)}</div>`;
}

// What goes in a number box: what was typed (0 shows as "0"), or an empty box if nothing was typed.
function balanceInputText(typed, ore) {
	if (!typed) {
		return "";
	}
	return ore === 0 ? "0" : amountToInput(ore);
}

// "1. okt." (with the year when it is not this year)
function momentText(moment) {
	const date = new Date(moment);
	const sameYear = date.getFullYear() === new Date().getFullYear();
	const options = sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" };
	return new Intl.DateTimeFormat(uiLocale(), options).format(date);
}

function accountNoteText(now) {
	return now.account ? t("Opdateret {date}", { date: momentText(now.account.at) }) : "";
}

// "Opdateret 1. okt. · siden da: børnene −300 kr." - the last part only when a kid changed it.
function savingsNoteText(now) {
	if (!now.savings) {
		return "";
	}
	let text = t("Opdateret {date}", { date: momentText(now.savings.at) });
	if (now.fromKids !== 0) {
		text += " · " + t("siden da: børnene {change}", { change: (now.fromKids < 0 ? "−" : "+") + formatKr(Math.abs(now.fromKids)) });
	}
	return text;
}

// The total under the two boxes, and what it is counted from. Before the two numbers are typed, a
// number saved by an older version (the single "Penge i alt") is still used, and this says so.
function moneyTotalHtml(month, now) {
	if (now.any) {
		return `
			<div class="facts"><span>${t("I alt:")} <b>${formatKr(now.total)}</b></span></div>
			<p class="hint">${t("Regnes fra starten af {month}.", { month: esc(monthInSentence(viewMonth)) })}</p>`;
	}
	if (month.startBalance > 0) {
		return `<p class="hint">${t("Dit gamle tal:")} <b>${formatKr(month.startBalance)}</b> ${t("Skriv dine to konti her for at erstatte det.")}</p>`;
	}
	return "";
}

// The money Fremtid starts from: the two typed numbers, or else the older single number.
function startTotalFor(month) {
	const now = moneyNow(monthsForMoney());
	return now.any ? now.total : month.startBalance;
}

// The results are redrawn on their own after a number is changed (refreshFutureResults and
// refreshMoneyNow), so the boxes you are typing in are left alone.
function futureResultsHtml(month) {
	const s = summarize(month, viewMonth);
	if (s.income === 0) {
		return '<section class="card"><p>' + t("Skriv din indkomst under <b>Plan</b> først.") + "</p></section>";
	}

	const f = forecast(month, viewMonth, FORECAST_MONTHS, data.months, startTotalFor(month));
	const tone = f.endTotal < 0 ? "bad" : "good";

	// When you have set up later months differently (a new job, say), "the same every month"
	// would be wrong, so the lines say that the amount changes and the table shows each month.
	const perMonthText = f.varies
		? t("Lægges til: <b>{amount}</b> nu, ændrer sig senere", { amount: formatKr(f.perMonth) })
		: t("Lægges til hver måned <b>{amount}</b>", { amount: formatKr(f.perMonth) });
	const carefulText = t("Kun opsparingen: <b>{amount}</b>", { amount: formatKr(f.carefulEndTotal) });

	let rows = "";
	for (const row of f.rows) {
		rows += `
			<tr>
				<td>${esc(shortMonthLabel(row.key))}${row.ownPlan ? "" : " *"}</td>
				<td class="${row.added < 0 ? "bad" : ""}">${formatKr(row.added)}</td>
				<td class="${row.total < 0 ? "bad" : ""}">${formatKr(row.total)}</td>
			</tr>`;
	}

	return `
		<section class="card">
			<div class="label">${t("Om {n} måneder har du", { n: FORECAST_MONTHS })}</div>
			<div class="big-number ${tone}">${formatKr(f.endTotal)}</div>
			<p class="hint">${t("Ved udgangen af {month}.", { month: esc(monthInSentence(f.lastKey)) })}</p>
			<div class="facts">
				<span>${perMonthText}</span>
			</div>
			<div class="facts">
				<span>${carefulText}</span>
			</div>
			${othersLineHtml(f.endTotal)}
			<details class="explain">
				<summary>${t("Hvad betyder det?")}</summary>
				<p class="hint">${t('Det store tal: du bruger præcis dine grænser og beholder resten. "Kun opsparingen": du bruger alt andet end det, du har sat til side. Et regnestykke, ikke en forudsigelse.')}</p>
			</details>
		</section>
		<section class="card">
			<details>
				<summary class="fold-title">${t("Måned for måned")}</summary>
				<div class="table-scroll">
					<table>
						<thead><tr><th>${t("Måned")}</th><th>${t("Lægges til")}</th><th>${t("Penge i alt")}</th></tr></thead>
						<tbody>
							<tr><td>${t("Start")}</td><td></td><td>${formatKr(f.start)}</td></tr>${rows}
						</tbody>
					</table>
				</div>
				<p class="hint" style="margin-top:8px">${t("* = måneden er ikke sat op og bruger planen fra måneden før.")}</p>
			</details>
		</section>`;
}

// "Of the pile, Nathan's is 4.200 and yours is 178.000": only when a kid has money in it.
// Their share is what they have today; it is taken out of the total to show what is yours.
function othersLineHtml(endTotal) {
	const people = potBalances(monthsForMoney());
	if (people.length === 0) {
		return "";
	}
	const others = othersTotal(monthsForMoney());
	const who = people.length === 1 ? people[0].person : t("børnene");
	return `<div class="facts"><span>${t("Heraf {who} (i dag): <b>{others}</b> · Dine egne: <b>{yours}</b>", { who: esc(who), others: formatKr(others), yours: formatKr(endTotal - others) })}</span></div>`;
}

function refreshFutureResults() {
	const box = document.getElementById("future-results");
	if (box) {
		box.innerHTML = futureResultsHtml(getMonth(viewMonth));
	}
}


// ---- Screen 4: Plan ------------------------------------------------------------
//
// The month's money: what comes in, the fixed bills, and what you save. Everything that is about
// how the page works (account, categories, kids, export, backup) is on the next screen, Indstillinger.

// The account box at the top of Indstillinger. Hidden until accounts are set up (firebase-config.js).
function accountHtml() {
	if (!accountsAvailable()) {
		return "";
	}

	if (accountName !== null) {
		return `
			<section class="card">
				<h2>${t("Konto")}</h2>
				<p>${t("Logget ind som <b>{name}</b>. Dine tal er gemt online.", { name: esc(accountName) })}</p>
				<button class="secondary" data-action="sign-out">${t("Log ud")}</button>
			</section>`;
	}

	return `
		<section class="card">
			<h2>${t("Gem dine tal på en konto")}</h2>
			<p class="hint">${t("Så følger dine tal dig overalt, og de går ikke tabt.")}</p>
			<form id="account-form" autocomplete="on">
				<label>${t("Brugernavn")}
					<input name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="20" required>
				</label>
				<label>${t("Adgangskode")}
					<input name="password" type="password" autocomplete="current-password" required>
				</label>
				<button type="submit" class="primary">${t("Log ind")}</button>
				<button type="button" class="secondary" data-action="create-account">${t("Opret ny konto")}</button>
				<p id="account-message" class="message" role="status"></p>
			</form>
			<p class="hint">${t("Brugernavn uden æ, ø, å. Adgangskode: mindst 10 tegn, fx tre ord og et tal.")}</p>
		</section>`;
}

function planHtml(month) {
	return `<section class="card" id="plan-summary">${planSummaryHtml(month)}</section>`
		+ planSectionHtml(INCOME_SECTION, month)
		+ planSectionHtml(FIXED_SECTION, month)
		+ savingsHtml(month);
}


// ---- Screen 5: Indstillinger (the gear) ------------------------------------------
//
// Everything about how the page works: your account, the categories, the kids, the report for
// Excel / PDF, and the backup file.

function settingsHtml(month) {
	return accountHtml()
		+ planSectionHtml(CATEGORY_SECTION, month)
		+ addPersonHtml()
		+ appearanceHtml()
		+ languageHtml()
		+ currencyHtml()
		+ exportHtml()
		+ backupHtml();
}

// The "Udseende" box on Indstillinger: pick the colours.
function appearanceHtml() {
	let choices = "";
	for (const theme of THEMES) {
		const isOn = theme.id === currentTheme;
		choices += `
			<button type="button" class="theme-choice${isOn ? " on" : ""}" data-action="set-theme" data-theme-id="${theme.id}" aria-pressed="${isOn}">
				<span class="theme-swatch" style="background:${theme.back};border-color:${theme.color}"><i style="background:${theme.color}"></i></span>
				<span class="theme-name">${esc(t(theme.name))}<small>${esc(t(theme.note))}</small></span>
			</button>`;
	}
	return `
		<section class="card">
			<h2>${t("Udseende")}</h2>
			<p class="hint">${t("Vælg farverne. Valget gælder kun denne telefon eller computer.")}</p>
			<div class="theme-choices">${choices}</div>
		</section>`;
}

// The "Sprog" box on Indstillinger: Danish or English. The heading has both names, so it can be
// found from either language.
function languageHtml() {
	const options = LANGUAGES.map((language) => `<option value="${language.id}"${language.id === getLanguage() ? " selected" : ""}>${esc(language.name)}</option>`).join("");
	const heading = getLanguage() === "da" ? "Sprog · Language" : "Language · Sprog";
	return `
		<section class="card">
			<h2>${heading}</h2>
			<p class="hint">${t("Vælg sproget. Valget gælder kun denne telefon eller computer.")}</p>
			<select id="language-choice" aria-label="${t("Sprog")}">${options}</select>
		</section>`;
}

// The "Valuta" box on Indstillinger: the currency the amounts are shown in (nothing is converted).
function currencyHtml() {
	const options = CURRENCIES.map((code) => `<option value="${code}"${code === getCurrency() ? " selected" : ""}>${esc(code + " – " + currencyName(code))}</option>`).join("");
	const heading = getLanguage() === "da" ? "Valuta · Currency" : "Currency · Valuta";
	return `
		<section class="card">
			<h2>${heading}</h2>
			<p class="hint">${t("Vælg valutaen. Kun måden, beløbene vises på, ændres: tallene regnes ikke om. Valget gælder kun denne telefon eller computer.")}</p>
			<select id="currency-choice" aria-label="${t("Valuta")}">${options}</select>
		</section>`;
}

function changeCurrency(code) {
	setCurrency(code);
	saveCurrency(getCurrency());
	render();
}

// A new language: put the texts of index.html in, and draw the screen again.
function changeLanguage(id) {
	setLanguage(id);
	saveLanguage(getLanguage());
	applyStaticTexts();
	render();
}

// The "Eksport" box on Indstillinger: pick a month or a year and open its report.
function exportHtml() {
	if (tryMode()) {
		return lockedHtml(t("Eksport"));
	}
	let options = `<option value="month:${viewMonth}">${t("Denne måned: {month}", { month: esc(monthLabel(viewMonth)) })}</option>`;
	for (const year of yearsWithData(data.months)) {
		options += `<option value="year:${year}">${t("Hele året {year}", { year: year })}</option>`;
	}
	return `
		<section class="card">
			<h2>${t("Eksport")}</h2>
			<p class="hint">${t("Hent en måned eller et helt år til Excel eller PDF.")}</p>
			<label>${t("Hvad vil du se?")}
				<select id="export-scope">${options}</select>
			</label>
			<button class="secondary" data-action="open-report">${t("Åbn rapport")}</button>
		</section>`;
}

function summaryLineHtml(label, text, extraClass) {
	return `<div class="sum-line ${extraClass || ""}"><span>${label}</span><span>${text}</span></div>`;
}

// The box at the top of Plan. It is redrawn on its own after each edit
// (refreshPlanSummary), so the boxes you are typing in are left alone. The limits of the
// categories are edited on Indstillinger, so there is a way over from here.
function planSummaryHtml(month) {
	const s = summarize(month, viewMonth);

	let html = "<h2>" + t("Sådan ser måneden ud") + "</h2><div class=\"sum-lines\">";
	html += summaryLineHtml(t("Indkomst"), formatKr(s.income));
	html += summaryLineHtml(t("Faste udgifter"), minus(s.fixed));
	html += summaryLineHtml(t("Opsparing"), minus(s.savings));
	html += summaryLineHtml(t("Til rådighed"), formatKr(s.available), s.available < 0 ? "total bad" : "total");
	html += summaryLineHtml(t("Fordelt på hverdagen"), minus(s.limits));

	if (s.unassigned >= 0) {
		html += summaryLineHtml(t("Ikke fordelt endnu"), formatKr(s.unassigned), "good");
	} else {
		html += summaryLineHtml(t("Fordelt for meget"), formatKr(-s.unassigned), "bad");
	}
	html += "</div>";

	if (s.unassigned < 0) {
		html += '<p class="hint" style="margin-top:8px">' + t("Du har fordelt mere, end du har.") + "</p>";
	}
	html += '<p class="hint" style="margin-top:8px">' + t("Alt gemmes med det samme. Ændringer gælder kun denne måned.") + "</p>";
	html += '<button type="button" class="link" data-tab="settings">' + t("Ret kategorier og grænser →") + "</button>";
	return html;
}

// After an edit, the numbers on the screen that depend on it change: the summary on Plan, and the
// "how much is handed out" line over the categories on Indstillinger. Only the one on screen exists.
function refreshPlanSummary() {
	const month = getMonth(viewMonth);
	const box = document.getElementById("plan-summary");
	if (box) {
		box.innerHTML = planSummaryHtml(month);
	}
	const line = document.getElementById("category-summary");
	if (line) {
		line.innerHTML = categorySummaryHtml(month);
	}
}

// Over the categories: what you have to spend, and how much of it the limits hand out.
function categorySummaryHtml(month) {
	const s = summarize(month, viewMonth);
	const rest = s.unassigned >= 0
		? `${t("Ikke fordelt endnu:")} <b>${formatKr(s.unassigned)}</b>`
		: `${t("Fordelt for meget:")} <b class="bad-text">${formatKr(-s.unassigned)}</b>`;
	return `${t("Til rådighed:")} <b>${formatKr(s.available)}</b> · ${rest}`;
}

function planSectionHtml(section, month) {
	let html = `<section class="card"><h2>${t(section.title)}</h2><p class="hint">${t(section.hint)}</p>`;
	if (section.key === "categories") {
		html += `<p class="category-summary" id="category-summary">${categorySummaryHtml(month)}</p>`;
	}
	for (const row of month[section.key]) {
		html += rowHtml(section, row);
	}
	html += `<button class="secondary" data-action="add-row" data-section="${section.key}">${t(section.addLabel)}</button>`;
	if (section.key === "categories") {
		html += shareCategoriesHtml(month);
		shareNote = "";   // said once
	}
	return html + "</section>";
}

function rowHtml(section, row) {
	return `
		<div class="row" data-section="${section.key}" data-id="${esc(row.id)}">
			<input data-field="name" value="${esc(row.name)}" placeholder="${t("Navn")}" maxlength="${MAX_NAME_LENGTH}" aria-label="${t("Navn")}" autocomplete="off">
			<input data-field="amount" value="${amountToInput(row[section.amountField])}" placeholder="0" inputmode="decimal" aria-label="${amountLabel()}" autocomplete="off">
			<button class="icon" data-action="delete-row" aria-label="${t("Slet rækken")}">✕</button>
			${section.hasDates ? datesHtml(row, section) : ""}
		</div>`;
}

// The small box under an income or fixed-bill row. It is a <details>: folded to one line of small
// text (which also says what the row is now) until you need it, and open from the start for a
// row that has dates or a frequency, unless you have opened or folded it yourself: then it stays
// the way you left it, in every month (datesOpen). (The maths is in budget.js: amountIn, isDueIn.)
// A fixed bill can also say how often it comes: every month, every 2nd/3rd/6th month, or once a
// year. Then the date means "first payment" (only the month counts).
const EVERY_LABELS = { 1: T("Hver måned"), 2: T("Hver 2. måned"), 3: T("Hver 3. måned"), 6: T("Hver 6. måned"), 12: T("Hvert år") };

function datesHtml(row, section) {
	let frequencyBox = "";
	if (section.hasFrequency) {
		const options = EVERY_CHOICES.map((every) => `<option value="${every}"${(row.every || 1) === every ? " selected" : ""}>${t(EVERY_LABELS[every])}</option>`).join("");
		frequencyBox = `<label>${t("Hvor ofte?")} <select data-field="every">${options}</select></label>`;
	}
	const hasSomething = Boolean(row.from || row.to || row.every > 1);
	const isOpen = datesOpen[row.id] !== undefined ? datesOpen[row.id] : hasSomething;
	return `
		<details class="dates" ${isOpen ? "open" : ""}>
			<summary>${esc(datesSummaryText(row, section))}</summary>
			${frequencyBox}
			<div class="dates-line">
				<label><span class="from-label">${row.every > 1 ? t("Første betaling") : t("Fra")}</span> <input type="date" data-field="from" value="${esc(row.from || "")}"></label>
				<label>${t("Til")} <input type="date" data-field="to" value="${esc(row.to || "")}"></label>
			</div>
			<p class="hint date-note">${esc(dateNoteText(row))}</p>
			<button type="button" class="link" data-action="clear-dates">${t("Ryd")}</button>
		</details>`;
}

function datesSummaryText(row, section) {
	if (row.every > 1) {
		const first = row.from ? ", " + t("første gang {date}", { date: dateText(row.from) }) : "";
		return t(EVERY_LABELS[row.every]) + first;
	}
	const when = windowText(row);
	if (when !== "") {
		return t("Gælder {when}", { when: when });
	}
	return t(EVERY_LABELS[1]);
}

// What the row means for the month on screen, so nobody has to work it out.
function dateNoteText(row) {
	const month = monthInSentence(viewMonth);

	if (isPeriodic(row)) {
		if (isDueIn(row, viewMonth)) {
			return t("Betales i {month}: {amount}", { month: month, amount: formatKr(row.amount) });
		}
		const next = nextDueKey(row, viewMonth);
		return next ? t("Betales ikke i {month}. Næste gang: {next}", { month: month, next: monthInSentence(next) }) : t("Betales ikke flere gange.");
	}

	if (!row.from && !row.to) {
		return "";   // nothing special to explain
	}
	if (row.from && row.to && row.from > row.to) {
		return t("Fra-datoen ligger efter til-datoen, så rækken tæller aldrig.");
	}
	const days = lastDayOfMonth(viewMonth);
	const active = activeDaysIn(row, viewMonth);
	if (active === 0) {
		return t("Gælder ikke i {month}.", { month: month });
	}
	if (active === days) {
		return t("Gælder hele {month}: {amount}", { month: month, amount: formatKr(row.amount) });
	}
	return t("I {month} tæller {active} af {days} dage: {amount}", { month: month, active: active, days: days, amount: formatKr(amountIn(row, viewMonth)) });
}

// Redraws everything in a row's box from the saved row, after something in the row changed: the
// two texts, the label of the date, and the boxes themselves (a choice can set or clear a date).
function refreshDatesOf(rowElement, row, section) {
	if (!row) {
		return;
	}
	const summary = rowElement.querySelector(".dates summary");
	if (!summary) {
		return;
	}
	summary.textContent = datesSummaryText(row, section);
	rowElement.querySelector(".date-note").textContent = dateNoteText(row);
	rowElement.querySelector(".from-label").textContent = row.every > 1 ? t("Første betaling") : t("Fra");
	rowElement.querySelector('[data-field="from"]').value = row.from || "";
	rowElement.querySelector('[data-field="to"]').value = row.to || "";
	const every = rowElement.querySelector('[data-field="every"]');
	if (every) {
		every.value = String(row.every || 1);
	}
}

function savingsHtml(month) {
	return `
		<section class="card">
			<h2>${t("Opsparing")}</h2>
			<p class="hint">${t("Hvor meget lægger du til side hver måned?")}</p>
			<div class="single-row">
				<label for="savings-input">${t("Opsparing pr. måned")}</label>
				<input id="savings-input" value="${amountToInput(month.savings)}" placeholder="0" inputmode="decimal" autocomplete="off">
			</div>
		</section>`;
}

function backupHtml() {
	if (tryMode()) {
		return lockedHtml(t("Sikkerhedskopi"));
	}
	// Safari can clear a web page's saved numbers after a week. An account makes that harmless.
	const iPhoneTip = accountName === null
		? " " + t("På iPhone: Del → Føj til hjemmeskærm, så Safari ikke rydder dine tal.")
		: "";
	return `
		<section class="card">
			<h2>${t("Sikkerhedskopi")}</h2>
			<p class="hint">${t("Gem en kopi som ekstra sikkerhed.")}${iPhoneTip}</p>
			<button class="secondary" data-action="export">${t("Gem kopi som fil")}</button>
			<label class="button secondary">${t("Hent kopi fra fil")}
				<input type="file" id="import-file" accept="application/json,.json" hidden>
			</label>
			<p id="backup-message" class="message" role="status"></p>
		</section>`;
}


// ---- The report (opened from Indstillinger -> Eksport) -------------------------------------
//
// One screen that is also what gets printed: the buttons carry the class "no-print", which the
// print styles hide. The numbers come from monthReport() / yearReport() in budget.js, the same
// ones the spreadsheet is made from.

// A table from a list of headings and a list of rows; every cell is already HTML.
// A cell can be { html, cls } to give it a class.
function tableHtml(headings, rows, tableClass) {
	let html = '<div class="table-scroll"><table' + (tableClass ? ' class="' + tableClass + '"' : "") + ">";
	if (headings.length > 0) {
		html += "<thead><tr>" + headings.map((heading) => `<th>${heading}</th>`).join("") + "</tr></thead>";
	}
	html += "<tbody>";
	for (const row of rows) {
		const isTotal = row.total === true;
		html += isTotal ? '<tr class="total">' : "<tr>";
		for (const cell of row.cells) {
			const text = typeof cell === "object" ? cell.html : cell;
			const cls = typeof cell === "object" && cell.cls ? ` class="${cell.cls}"` : "";
			html += `<td${cls}>${text}</td>`;
		}
		html += "</tr>";
	}
	return html + "</tbody></table></div>";
}

// An amount that is red when it is negative.
function amountCell(ore) {
	return { html: formatKr(ore), cls: ore < 0 ? "bad" : "" };
}

function purchasesHtml(spending) {
	if (spending.length === 0) {
		return '<p class="hint">' + t("Ingen udgifter.") + "</p>";
	}
	return tableHtml([t("Dato"), t("Kategori"), t("Note"), t("Beløb")], spending.map((item) => ({
		cells: [dateText(item.date).slice(0, 6), { html: esc(item.category), cls: "wrap" }, { html: esc(item.note), cls: "wrap" }, formatKr(item.amount)],
	})), "purchases");
}

// With "short" the report keeps the numbers that add up (the overview and the categories) and
// leaves out every single income, fixed expense and purchase.
function monthReportHtml(report, short) {
	const s = report.summary;
	const nameRows = (list) => list.map((row) => ({ cells: [esc(row.name || t("(uden navn)")), formatKr(row.amount)] }));

	let html = `<h2>${t("Budget: {label}", { label: esc(report.label) })}</h2>`;
	html += "<h3>" + t("Oversigt") + "</h3>" + tableHtml([], [
		{ cells: [t("Indkomst"), formatKr(s.income)] },
		{ cells: [t("Faste udgifter"), formatKr(s.fixed)] },
		{ cells: [t("Opsparing"), formatKr(s.savings)] },
		{ cells: [t("Til rådighed"), formatKr(s.available)], total: true },
		{ cells: [t("Brugt"), formatKr(s.spent)] },
		{ cells: [t("Tilbage"), amountCell(s.left)], total: true },
	]);
	if (!short) {
		html += "<h3>" + t("Indkomst") + "</h3>" + tableHtml([], nameRows(report.income));
		html += "<h3>" + t("Faste udgifter") + "</h3>" + tableHtml([], nameRows(report.fixed));
	}

	const categoryRows = report.categories.map((c) => ({
		cells: [esc(c.name || t("(uden navn)")), formatKr(c.limit), formatKr(c.spent), amountCell(c.left)],
	}));
	if (report.otherSpent > 0) {
		categoryRows.push({ cells: [t("Uden kategori"), "", formatKr(report.otherSpent), ""] });
	}
	html += "<h3>" + t("Kategorier") + "</h3>" + tableHtml([t("Kategori"), t("Grænse"), t("Brugt"), t("Tilbage")], categoryRows);
	if (!short) {
		html += "<h3>" + t("Udgifter") + "</h3>" + purchasesHtml(report.spending);
	}
	return html;
}

function yearReportHtml(report, short) {
	if (report.rows.length === 0) {
		return `<h2>${t("Budget: {label}", { label: esc(report.year) })}</h2><p class="hint">${t("Der er ingen gemte måneder i {year}.", { year: esc(report.year) })}</p>`;
	}
	const sums = report.totals;

	const monthRows = report.rows.map((row) => ({
		cells: [esc(shortMonthLabel(row.key)), formatKr(row.income), formatKr(row.fixed), formatKr(row.savings), formatKr(row.available), formatKr(row.spent), amountCell(row.left)],
	}));
	monthRows.push({
		cells: [t("I alt"), formatKr(sums.income), formatKr(sums.fixed), formatKr(sums.savings), formatKr(sums.available), formatKr(sums.spent), amountCell(sums.left)],
		total: true,
	});

	const categoryRows = report.categories.map((c) => ({ cells: [esc(c.name), formatKr(c.total)] }));

	let html = `<h2>${t("Budget: {label}", { label: esc(report.year) })}</h2>`;
	html += "<h3>" + t("Måned for måned") + "</h3>" + tableHtml([t("Måned"), t("Indkomst"), t("Faste"), t("Opsparing"), t("Til rådighed"), t("Brugt"), t("Tilbage")], monthRows);
	html += '<p class="hint no-print">' + t("Stryg tabellen til siden for at se alle kolonner.") + "</p>";
	html += "<h3>" + t("Brugt pr. kategori") + "</h3>" + tableHtml([t("Kategori"), t("I alt")], categoryRows);
	if (!short) {
		html += "<h3>" + t("Udgifter") + "</h3>" + purchasesHtml(report.spending);
	}
	return html;
}

function reportHtml() {
	let body = "";
	if (reportScope.type === "month") {
		body = monthReportHtml(monthReport(getMonth(reportScope.key), reportScope.key), reportShort);
	} else {
		body = yearReportHtml(yearReport(data.months, reportScope.key), reportShort);
	}
	// The button says what a tap will do, so it is the other way round from what is shown now.
	const shortButton = reportShort ? t("Vis alle poster") : t("Vis kun de vigtigste tal");
	return `
		<section class="card no-print">
			<div class="buttons">
				<button class="secondary" data-action="toggle-report-short">${shortButton}</button>
				<button class="primary" data-action="download-csv">${t("Hent til Excel (.csv)")}</button>
				<button class="secondary" data-action="print-report">${t("Udskriv eller gem som PDF")}</button>
				<button class="secondary" data-action="close-report">${t("‹ Tilbage til Indstillinger")}</button>
			</div>
		</section>
		<section class="card report">${body}</section>`;
}

function openReport() {
	if (tryMode()) {
		return;
	}
	const choice = document.getElementById("export-scope").value.split(":");
	reportScope = { type: choice[0], key: choice[1] };
	activeTab = "report";
	render();
	window.scrollTo(0, 0);
}

// The spreadsheet, as a file. A byte-order mark (\uFEFF) first tells Excel the text is UTF-8,
// so æ, ø and å come out right.
function downloadReportCsv() {
	let text = "";
	let name = "";
	if (reportScope.type === "month") {
		text = monthCsv(monthReport(getMonth(reportScope.key), reportScope.key));
		name = "budget-" + reportScope.key + ".csv";
	} else {
		text = yearCsv(yearReport(data.months, reportScope.key));
		name = "budget-" + reportScope.key + ".csv";
	}
	downloadText(name, "\uFEFF" + text, "text/csv;charset=utf-8");
}

// Hands the browser a file to save. Used by the spreadsheet and the backup.
function downloadText(filename, text, mimeType) {
	const link = document.createElement("a");
	link.href = URL.createObjectURL(new Blob([text], { type: mimeType }));
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}


// --- Reacting to the user -----------------------------------------------------
//
// One listener for the whole page ("event delegation"): instead of hooking up
// every button each time we redraw, we catch every tap here and look at which
// button was hit. The buttons carry data-action / data-tab to say what they do.

document.addEventListener("click", (event) => {
	const tabButton = event.target.closest("[data-tab]");
	if (tabButton) {
		activeTab = tabButton.dataset.tab;
		render();
		window.scrollTo(0, 0);
		return;
	}

	const button = event.target.closest("[data-action]");
	if (!button) {
		return;
	}

	switch (button.dataset.action) {
		case "previous-month":
			closeBankImport();   // a picture belongs to the month it was chosen in
			viewMonth = shiftMonth(viewMonth, -1);
			render();
			window.scrollTo(0, 0);
			break;
		case "next-month":
			closeBankImport();
			viewMonth = shiftMonth(viewMonth, 1);
			render();
			window.scrollTo(0, 0);
			break;
		case "this-month":
			closeBankImport();
			viewMonth = monthKeyOf(new Date());
			render();
			window.scrollTo(0, 0);
			break;
		case "add-row":
			addRow(SECTIONS[button.dataset.section]);
			break;
		case "delete-row":
			deleteRow(button);
			break;
		case "share-categories": {
			const done = shareCategories(getMonth(viewMonth).categories.map((category) => category.name));
			shareNote = done === 0 ? t("Alle måneder har allerede kategorierne.") : t("Gjort: kategorierne er nu også i {months}.", { months: monthsText(done) });
			render();
			break;
		}
		case "clear-dates":
			clearDates(button);
			break;
		case "pot-used":
			saveOthersEntry(button, -1);
			break;
		case "pot-got":
			saveOthersEntry(button, 1);
			break;
		case "delete-pot":
			deleteOthersEntry(button.dataset.id, button.dataset.month);
			break;
		case "delete-person":
			deletePerson(button.dataset.person);
			break;
		case "make-kid-link":
			makeKidLink(button.dataset.person);
			break;
		case "copy-kid-link":
			copyKidLink(button.dataset.token);
			break;
		case "remove-kid-link":
			removeKidLink(button.dataset.token);
			break;
		case "delete-kid-entry":
			deleteKidsEntry(button.dataset.token, button.dataset.id);
			break;
		case "delete-spending":
			deleteSpending(button.dataset.id);
			break;
		case "set-theme":
			applyTheme(button.dataset.themeId);
			saveTheme(currentTheme);
			render();
			break;
		case "close-bank-import":
			closeBankImport();
			render();
			break;
		case "export":
			exportBackup();
			break;
		case "open-report":
			openReport();
			break;
		case "close-report":
			activeTab = "settings";
			render();
			window.scrollTo(0, 0);
			break;
		case "toggle-report-short":
			reportShort = !reportShort;
			render();
			break;
		case "go-login":
			activeTab = "settings";   // the login box is the first card there
			render();
			window.scrollTo(0, 0);
			break;
		case "download-csv":
			downloadReportCsv();
			break;
		case "print-report":
			window.print();
			break;
		case "create-account":
			createAccountFromForm(document.getElementById("account-form"));
			break;
		case "sign-out":
			signOutOfAccount().catch((error) => setWarning(accountProblemText(error)));
			break;
		case "retry":
			location.reload();
			break;
	}
});

// A form normally reloads the page when submitted. preventDefault stops that.
document.addEventListener("submit", (event) => {
	if (event.target.id === "add-form") {
		event.preventDefault();
		addSpending(event.target);
	} else if (event.target.id === "account-form") {
		event.preventDefault();
		signInFromForm(event.target);
	} else if (event.target.id === "person-form") {
		event.preventDefault();
		addPerson(event.target);
	} else if (event.target.id === "bank-form") {
		event.preventDefault();
		addBankRows();
	}
});

// The "Gemmer … / Gemt" line also depends on whether the device is online.
window.addEventListener("online", showSyncStatus);
window.addEventListener("offline", showSyncStatus);

// A <details> tells us when it is opened or folded with a "toggle" event, which does not bubble:
// listening in the capture phase catches it anyway. We remember the categories card's state, so
// it stays as you left it when the screen is drawn again (every time you add an expense).
document.addEventListener("toggle", (event) => {
	if (event.target.id === "categories-details") {
		categoriesOpen = event.target.open;
		saveCategoriesOpen(categoriesOpen);
	}
}, true);

// A tap on the one-line summary of a row's dates box opens or folds it. We note what YOU chose (the
// click comes just before the box flips, so the new state is the opposite of the current one).
// A "toggle" event would also fire when the page itself draws a box open, which is not a choice.
document.addEventListener("click", (event) => {
	const summary = event.target.closest(".dates > summary");
	const rowElement = summary && summary.closest(".row");
	if (rowElement) {
		rememberDatesOpen(rowElement.dataset.id, !summary.parentElement.open);
	}
});

// Typing in the Note box: if it is a note you have used before, fill in its usual category.
document.addEventListener("input", (event) => {
	if (event.target.dataset && event.target.dataset.scan) {
		editBankRow(event.target);
		return;
	}
	if (event.target.name === "note" && event.target.form && event.target.form.id === "add-form") {
		pickCategoryFromNote(event.target);
	}
});

// "change" fires when you leave a box (or press Enter) after editing it.
document.addEventListener("change", (event) => {
	const input = event.target;
	if (input.id === "language-choice") {
		changeLanguage(input.value);
		return;
	}
	if (input.id === "currency-choice") {
		changeCurrency(input.value);
		return;
	}
	if (input.id === "bank-picture") {
		const file = input.files[0];
		input.value = "";   // so choosing the same picture again still counts as a change
		startBankImport(file);
		return;
	}
	if (input.dataset && input.dataset.scan) {
		editBankRow(input);
		return;
	}
	if (input.name === "category" && input.form && input.form.id === "add-form") {
		input.dataset.touched = "1";   // you chose a category yourself: a note won't change it
		return;
	}
	if (input.closest(".row")) {
		editRow(input);
	} else if (input.id === "savings-input") {
		editSavings(input);
	} else if (input.dataset.balance) {
		editMoneyNow(input);
	} else if (input.id === "import-file") {
		importBackup(input);
	}
});


// ---- Børn: your kids' savings in your pile --------------------------------------
//
// You keep all your savings in one pile, and some of it is your kids'. Add each kid under Indstillinger,
// and they get a card on Overblik: "Nathan brugte 300 kr" and it says what he has left. Any
// number of kids, any names. (In the code a kid is a "person" with entries; budget.js calls the
// whole thing "pots": potBalances.) Each entry is saved in the month it happened in, like a
// purchase.

let potMessage = null;   // { person, text }: what to say in that person's card, once

// The months with what the kids wrote on their own pages counted in (see withKidEntries in
// budget.js). Every balance (the cards, "Heraf", Opsparing on Fremtid) is worked out from this;
// data.months itself only holds what YOU wrote.
function monthsForMoney() {
	const all = [];
	for (const token of Object.keys(kidEntries)) {
		const page = kidPages[token];
		if (!page) {
			continue;
		}
		for (const entry of kidEntries[token]) {
			all.push({ ...entry, token: token, person: page.person });
		}
	}
	return withKidEntries(data.months, all);
}


// ---- Børn: the kids' own pages (a private link for each kid) ------------------------
//
// Under Indstillinger -> Børn each kid can get a link. On the kid's phone it shows what the kid has
// and a box to write what they used - nothing else (kid.js). We listen to the kid's pages here, so
// what the kid writes shows up on their card, and we keep telling each page how much of the kid's
// money WE have written down (parentSide), because the kid's page cannot see our budget.

function startKidAccess(username) {
	kidPagesLoaded = false;
	stopKidPages = watchKidPages(username, gotKidPages, (error) => {
		// Not fatal: the budget itself works without the kids' pages (the new rules may not be published yet).
		console.error(error);
	});
}

// Stops listening, and forgets the pages (signing out, or another account).
function stopKidAccess() {
	if (stopKidPages) {
		stopKidPages();
		stopKidPages = null;
	}
	for (const stop of Object.values(kidEntryWatchers)) {
		stop();
	}
	kidEntryWatchers = {};
	kidPages = {};
	kidEntries = {};
	kidPublished = {};
	kidPagesLoaded = false;
}

// The list of kid pages arrived or changed: listen to the entries of each new page, stop for one
// that is gone.
function gotKidPages(pages) {
	const before = kidPageShape(kidPages);
	kidPages = pages;
	kidPagesLoaded = true;
	for (const token of Object.keys(pages)) {
		if (!kidEntryWatchers[token]) {
			kidEntryWatchers[token] = watchKidEntries(accountName, token, (entries) => gotKidEntries(token, entries), (error) => console.error(error));
		}
	}
	for (const token of Object.keys(kidEntryWatchers)) {
		if (!pages[token]) {
			kidEntryWatchers[token]();
			delete kidEntryWatchers[token];
			delete kidEntries[token];
			delete kidPublished[token];
		}
	}
	if (kidPageShape(pages) === before || isTyping()) {
		// Only a number on a page changed (our own parentSide coming back): nothing on screen shows it.
		syncKidPages();
	} else {
		render();
	}
}

// Which pages there are, and whose: the part of the kid pages that the screen shows.
function kidPageShape(pages) {
	return Object.keys(pages).sort().map((token) => token + ":" + pages[token].person).join("|");
}

function gotKidEntries(token, entries) {
	kidEntries[token] = entries;
	if (!isTyping()) {
		render();
	}
}

// Keeps each kid page's parentSide right: what you have written down for the kid, without what
// the kid wrote. Only sends when it is different from what the page says (and not again while we
// wait to hear it back), so it never loops. Called after every drawing of the screen.
function syncKidPages() {
	if (accountName === null || !accountReady || !kidPagesLoaded || firebase === null) {
		return;
	}
	for (const token of Object.keys(kidPages)) {
		const page = kidPages[token];
		const wanted = parentSideOf(data.months, page.person);
		if (page.parentSide === wanted || kidPublished[token] === wanted) {
			continue;
		}
		kidPublished[token] = wanted;
		saveKidPage(accountName, token, page.person, wanted).catch((error) => {
			console.error(error);
			delete kidPublished[token];   // so a later drawing tries again
			setWarning(t("Kunne ikke opdatere barnets side: {problem}", { problem: accountProblemText(error) }));
		});
	}
}

function kidTokenOf(person) {
	const wanted = person.trim().toLowerCase();
	return Object.keys(kidPages).find((token) => kidPages[token].person.trim().toLowerCase() === wanted) || null;
}

// The link to give the kid. (On this computer's test copy it carries ?emulator, so the kid's page
// uses the test copy too.)
function kidLinkUrl(token) {
	const link = kidLink(location.origin + location.pathname, accountName, token) + "&lang=" + getLanguage() + "&cur=" + getCurrency();
	return USE_FIREBASE_EMULATOR ? link + "&emulator" : link;
}

// What goes in the Børn box under the kids: a button to make a kid's link, or the link itself.
function kidAccessHtml(people) {
	if (people.length === 0) {
		return "";
	}
	if (accountName === null) {
		return accountsAvailable() ? '<p class="hint">' + t("Vil dine børn selv skrive, hvad de bruger? Log ind på en konto øverst først.") + "</p>" : "";
	}
	let html = "";
	for (const person of people) {
		const name = esc(person.person);
		const token = kidTokenOf(person.person);
		if (token === null) {
			html += `<div class="kid-access"><button type="button" class="secondary" data-action="make-kid-link" data-person="${name}">${t("Giv {name} sit eget link", { name: name })}</button></div>`;
			continue;
		}
		html += `
			<div class="kid-access">
				<label>${t("{name}s link", { name: name })}
					<input readonly value="${esc(kidLinkUrl(token))}" data-kid-token="${esc(token)}" aria-label="${t("{name}s link", { name: name })}">
				</label>
				<div class="pot-buttons">
					<button type="button" class="primary" data-action="copy-kid-link" data-token="${esc(token)}">${t("Kopiér link")}</button>
					<button type="button" class="secondary" data-action="remove-kid-link" data-token="${esc(token)}">${t("Fjern linket")}</button>
				</div>
			</div>`;
	}
	return html + `
		<p id="kid-link-message" class="message" role="status">${esc(kidLinkNote)}</p>
		<details class="explain">
			<summary>${t("Hvad kan barnet med linket?")}</summary>
			<p class="hint">${t('Barnet åbner linket og kan se, hvad det har, og skrive, hvad det bruger. Intet andet. Send linket kun til barnet: den, der har linket, kan skrive. Du kan altid slette en post eller fjerne linket. Åbner du selv linket på din egen telefon, så tryk bagefter "Ikke dig? Åbn budgettet".')}</p>
		</details>`;
}

async function makeKidLink(person) {
	const bytes = new Uint8Array(KID_TOKEN_LENGTH);
	crypto.getRandomValues(bytes);
	const token = makeKidToken(bytes);
	const side = parentSideOf(data.months, person);
	kidPublished[token] = side;
	try {
		kidLinkNote = t("Linket er lavet. Tryk Kopiér, og send det til {name}.", { name: person });
		await saveKidPage(accountName, token, person, side);
		setMessage("kid-link-message", kidLinkNote, false);
	} catch (error) {
		console.error(error);
		kidLinkNote = "";
		delete kidPublished[token];
		setWarning(t("Kunne ikke lave linket: {problem}", { problem: accountProblemText(error) }));
	}
}

function copyKidLink(token) {
	const url = kidLinkUrl(token);
	const box = document.querySelector('input[data-kid-token="' + token + '"]');
	const showByHand = () => {
		if (box) {
			box.focus();
			box.select();
		}
		setMessage("kid-link-message", t("Hold fingeren på linket og vælg Kopiér."), false);
	};
	if (navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(url).then(
			() => setMessage("kid-link-message", t("Linket er kopieret. Send det til barnet."), false),
			showByHand,
		);
	} else {
		showByHand();
	}
}

// Takes the link away. What the kid wrote is first moved into your own numbers, so the kid's
// balance stays the same; then the page and its entries are deleted online.
async function removeKidLink(token) {
	const page = kidPages[token];
	if (!page) {
		return;
	}
	if (!confirm(t("Fjern {name}s link? Så virker det ikke mere. Det, {name} har skrevet, beholder du.", { name: page.person }))) {
		return;
	}
	kidLinkNote = "";
	const written = new Set();
	for (const monthKey of Object.keys(data.months)) {
		for (const entry of data.months[monthKey].pots) {
			written.add(entry.id);
		}
	}
	for (const entry of kidEntries[token] || []) {
		if (written.has(entry.id)) {
			continue;
		}
		const monthKey = entry.date.slice(0, 7);
		if (getMonth(monthKey).pots.length >= MOST_POT_ENTRIES_PER_MONTH) {
			continue;
		}
		changeMonth((month) => {
			month.pots.push({ id: entry.id, date: entry.date, person: page.person, amount: entry.amount, note: entry.note, at: entry.at });
		}, monthKey);
	}
	try {
		await deleteKidPage(accountName, token);
	} catch (error) {
		console.error(error);
		setWarning(t("Kunne ikke fjerne linket: {problem}", { problem: accountProblemText(error) }));
	}
}

// One entry the kid wrote (a mistake) is taken away.
async function deleteKidsEntry(token, entryId) {
	if (!confirm(t("Slet den post?"))) {
		return;
	}
	try {
		await deleteKidEntry(accountName, token, entryId);
	} catch (error) {
		console.error(error);
		setWarning(t("Kunne ikke slette: {problem}", { problem: accountProblemText(error) }));
	}
}

// One card for each person, on Overblik. Nothing at all until someone has been added (Indstillinger).
function potCardsHtml() {
	return potBalances(monthsForMoney()).map(potCardHtml).join("");
}

function potCardHtml(person) {
	const name = esc(person.person);
	const message = potMessage && potMessage.person === person.person ? potMessage.text : "";

	let history = "";
	for (const entry of person.entries.slice(0, 10)) {
		const text = entry.note !== "" ? entry.note : (entry.amount < 0 ? t("Brugte") : t("Fik"));
		// An entry the kid wrote on their own page says so, and is deleted online, not from a month.
		const own = entry.kidToken ? " · " + t("selv") : "";
		const remove = entry.kidToken
			? `data-action="delete-kid-entry" data-id="${esc(entry.id)}" data-token="${esc(entry.kidToken)}"`
			: `data-action="delete-pot" data-id="${esc(entry.id)}" data-month="${esc(entry.monthKey)}"`;
		history += `
			<li>
				<div class="what">${esc(text)}<small>${esc(dateText(entry.date).slice(0, 6) + own)}</small></div>
				<span class="money ${entry.amount < 0 ? "bad-text" : ""}">${formatKr(entry.amount)}</span>
				<button class="icon" ${remove} aria-label="${t("Slet")}">✕</button>
			</li>`;
	}

	return `
		<section class="card pot">
			<div class="label">${t("{name} har", { name: name })}</div>
			<div class="big-number ${person.balance < 0 ? "bad" : ""}">${formatKr(person.balance)}</div>
			<p class="message" role="status">${esc(message)}</p>
			<div class="pot-form" data-person="${name}">
				<label>${amountLabel()}
					<input name="amount" inputmode="decimal" placeholder="${t("fx 300")}" autocomplete="off">
				</label>
				<label>${t("Hvad? (hvis du vil)")}
					<input name="note" maxlength="${MAX_NOTE_LENGTH}" autocomplete="off">
				</label>
				<div class="pot-buttons">
					<button type="button" class="primary" data-action="pot-used">${t("{name} brugte", { name: name })}</button>
					<button type="button" class="secondary" data-action="pot-got">${t("{name} fik", { name: name })}</button>
				</div>
				<p class="message pot-error" role="status"></p>
			</div>
			<details class="explain">
				<summary>${t("Historik")}</summary>
				<ul class="list">${history}</ul>
				<button type="button" class="link" data-action="delete-person" data-person="${name}">${t("Fjern {name}", { name: name })}</button>
			</details>
		</section>`;
}

// "Nathan brugte 300": sign is -1 (used) or +1 (got). Saves, then says what is left.
function saveOthersEntry(button, sign) {
	const form = button.closest(".pot-form");
	const person = form.dataset.person;
	const problem = form.querySelector(".pot-error");

	const ore = parseAmount(form.querySelector('[name="amount"]').value);
	if (ore === null || ore <= 0) {
		problem.textContent = t("Skriv et beløb, fx 300.");
		problem.classList.add("bad");
		return;
	}
	if (getMonth(viewMonth).pots.length >= MOST_POT_ENTRIES_PER_MONTH) {
		problem.textContent = t("For mange poster i denne måned.");
		problem.classList.add("bad");
		return;
	}

	// Dated today when the month on screen is this month, otherwise the 1st of it.
	const today = dateKeyOf(new Date());
	const date = today.slice(0, 7) === viewMonth ? today : viewMonth + "-01";
	const note = form.querySelector('[name="note"]').value.trim().slice(0, MAX_NOTE_LENGTH);
	changeMonth((month) => {
		// `at` is the moment, so the savings number on Fremtid knows this came after it was typed.
		month.pots.push({ id: newId(), date: date, person: person, amount: sign * ore, note: note, at: Date.now() });
	});

	const now = potBalances(monthsForMoney()).find((other) => other.person.toLowerCase() === person.toLowerCase());
	const left = formatKr(now.balance);
	// If you have typed your savings (Fremtid), it moves with the kids: say what it is now.
	// (formatKr already ends in "kr." so no full stop is added after it.)
	const money = moneyNow(monthsForMoney());
	const savingsText = money.savings ? " " + t("Opsparingen er nu {amount}", { amount: formatKr(money.savingsNow) }) : "";
	potMessage = {
		person: now.person,
		text: (sign < 0
			? t("{name} brugte {amount} Nu har {name} {left} tilbage.", { name: person, amount: formatKr(ore), left: left })
			: t("{name} fik {amount} Nu har {name} {left}", { name: person, amount: formatKr(ore), left: left })) + savingsText,
	};
	render();
}

function deleteOthersEntry(id, monthKey) {
	if (!confirm(t("Slet den post?"))) {
		return;
	}
	changeMonth((month) => {
		month.pots = month.pots.filter((entry) => entry.id !== id);
	}, monthKey);
	render();
}

// Takes a kid away with every entry they have, in every month. Asks first: it can't be undone.
function deletePerson(person) {
	if (!confirm(t("Fjern {name} og alle posterne? Det kan ikke fortrydes.", { name: person }))) {
		return;
	}
	const wanted = person.toLowerCase();
	for (const monthKey of Object.keys(data.months)) {
		if (data.months[monthKey].pots.some((entry) => entry.person.trim().toLowerCase() === wanted)) {
			changeMonth((month) => {
				month.pots = month.pots.filter((entry) => entry.person.trim().toLowerCase() !== wanted);
			}, monthKey);
		}
	}
	// The kid's link goes too, with what they wrote on it.
	const token = kidTokenOf(person);
	if (token !== null) {
		deleteKidPage(accountName, token).catch((error) => {
			console.error(error);
			setWarning(t("Kunne ikke fjerne linket: {problem}", { problem: accountProblemText(error) }));
		});
	}
	render();
}

// The "Børn" box on Indstillinger: a kid's name, and what they have now. Once a kid is added, their card
// shows up on Overblik.
function addPersonHtml() {
	if (tryMode()) {
		return lockedHtml(t("Børn"));
	}
	const people = potBalances(monthsForMoney());
	const form = `
		<form id="person-form" autocomplete="off">
			<label>${t("Barnets navn")}
				<input name="person" maxlength="${MAX_NAME_LENGTH}" placeholder="${t("fx Nathan")}" required>
			</label>
			<label>${t("Hvor mange penge har barnet nu?")}
				<input name="amount" inputmode="decimal" placeholder="0">
			</label>
			<button type="submit" class="secondary">${t("Tilføj barn")}</button>
			<p id="person-message" class="message" role="status"></p>
		</form>`;
	return `
		<section class="card">
			<h2>${t("Børn")}</h2>
			<p class="hint">${t("Børnenes penge i din bunke.")}</p>
			${kidAccessHtml(people)}
			${people.length > 0 ? `<details class="explain"><summary>${t("+ Tilføj et barn mere")}</summary>${form}</details>` : form}
		</section>`;
}

function addPerson(form) {
	if (tryMode()) {
		return;
	}
	const person = form.elements.person.value.trim().slice(0, MAX_NAME_LENGTH);
	const ore = parseAmount(form.elements.amount.value);
	if (person === "") {
		setMessage("person-message", t("Skriv barnets navn."), true);
		return;
	}
	if (ore === null) {
		setMessage("person-message", t("Skriv et beløb, fx 5000."), true);
		return;
	}
	if (potBalances(monthsForMoney()).some((other) => other.person.toLowerCase() === person.toLowerCase())) {
		setMessage("person-message", t("{name} findes allerede.", { name: person }), true);
		return;
	}

	const today = dateKeyOf(new Date());
	const date = today.slice(0, 7) === viewMonth ? today : viewMonth + "-01";
	changeMonth((month) => {
		// "start": this money was already in the pile, so it never moves the savings number.
		month.pots.push({ id: newId(), date: date, person: person, amount: ore, note: t("Start"), start: true });
	});
	render();
	setMessage("person-message", t("{name} er tilføjet. Se under Overblik.", { name: person }), false);
}


// ---- Add purchases from a picture of the bank (Overblik -> "Læs fra skærmbillede") ----------
//
// You choose a screenshot of the bank's list of purchases. scan.js reads the text in it, on the
// phone (the picture is never sent anywhere), planBankImport() in budget.js turns the text into
// purchases, and they are shown here for you to check before anything is saved: untick one, fix a
// text or an amount, pick a category. What could not be read is listed, so you can write it in
// yourself. Only purchases of the month the picture was chosen in are added.
//
// bankImport is null, or { status: "reading" | "ready" | "failed", monthKey, pictureUrl, stage,
// share, rows, elsewhere, unclear, problem }. A row is { date, note, amountText, categoryId, tick,
// why, touched }: what the boxes show, kept here so a redraw of the screen does not lose your edits.

async function startBankImport(file) {
	if (!file || tryMode()) {
		return;
	}
	closeBankImport();
	const job = { status: "reading", monthKey: viewMonth, pictureUrl: URL.createObjectURL(file), stage: "loading", share: 0, rows: [], elsewhere: [], unclear: [], problem: "" };
	bankImport = job;
	render();
	window.scrollTo(0, 0);

	try {
		const text = await readPicture(file, (stage, share) => showReadingProgress(job, stage, share));
		if (bankImport !== job) {
			return;   // closed (or another month chosen) while it was reading
		}
		const plan = planBankImport(text, job.monthKey, new Date(), getMonth(job.monthKey), noteHistory(data.months));
		job.rows = plan.rows.map((row) => ({
			date: row.date,
			note: row.note,
			amountText: amountToInput(row.amount),
			categoryId: row.categoryId,
			tick: row.tick,
			why: row.why,
			touched: false,
		}));
		job.elsewhere = plan.elsewhere;
		job.unclear = plan.unclear;
		job.status = "ready";
	} catch (error) {
		if (bankImport !== job) {
			return;
		}
		console.error(error);
		job.status = "failed";
		// No reader at all means it could not be downloaded; otherwise the picture was the problem.
		job.problem = typeof Tesseract === "undefined"
			? t("Læseprogrammet kunne ikke hentes. Tjek, at du har internet, og prøv igen.")
			: t("Billedet kunne ikke læses. Prøv med et andet skærmbillede.");
	}
	render();
}

function bankReadingText(stage, share) {
	if (stage === "loading") {
		return t("Gør klar … Første gang hentes læseprogrammet (nogle få MB), så kan det tage lidt.");
	}
	return t("Læser billedet … {percent} %", { percent: Math.round(share * 100) });
}

// The progress is updated in place, not by redrawing the screen many times a second.
function showReadingProgress(job, stage, share) {
	if (bankImport !== job) {
		return;
	}
	job.stage = stage;
	job.share = share;
	const bar = document.getElementById("bank-progress");
	const text = document.getElementById("bank-progress-text");
	if (bar) {
		bar.value = Math.round(share * 100);
	}
	if (text) {
		text.textContent = bankReadingText(stage, share);
	}
}

function closeBankImport() {
	if (bankImport !== null) {
		stopReadingPicture();
		URL.revokeObjectURL(bankImport.pictureUrl);
		bankImport = null;
	}
}

function bankCategoryOptionsHtml(month, chosenId) {
	let html = `<option value=""${chosenId === "" ? " selected" : ""}>${t("Uden kategori")}</option>`;
	for (const category of month.categories) {
		html += `<option value="${esc(category.id)}"${category.id === chosenId ? " selected" : ""}>${esc(category.name || t("(uden navn)"))}</option>`;
	}
	return html;
}

function bankRowHtml(row, index, month) {
	const notes = { already: T("findes allerede"), "money-in": T("ligner penge ind"), check: T("tjek beløbet") };
	const why = row.why !== "" ? `<div class="scan-why">${t(notes[row.why])}</div>` : "";
	return `
		<div class="scan-row ${row.tick ? "" : "off"}" data-index="${index}">
			<input type="checkbox" class="scan-tick" data-scan="tick" ${row.tick ? "checked" : ""} aria-label="${t("Tilføj denne udgift")}">
			<input data-scan="note" value="${esc(row.note)}" maxlength="${MAX_NOTE_LENGTH}" placeholder="${t("Tekst")}" aria-label="${t("Tekst")}" autocomplete="off">
			<input data-scan="amount" value="${esc(row.amountText)}" inputmode="decimal" aria-label="${amountLabel()}" autocomplete="off">
			${why}
			<div class="scan-under">
				<span class="scan-date">${esc(shortDayText(row.date))}</span>
				<select data-scan="category" aria-label="${t("Kategori")}">${bankCategoryOptionsHtml(month, row.categoryId)}</select>
			</div>
		</div>`;
}

function bankAddLabel(rows) {
	const count = rows.filter((row) => row.tick).length;
	if (count === 0) {
		return t("Ingen valgt");
	}
	return tn(count, "Tilføj {n} udgift", "Tilføj {n} udgifter");
}

// The card at the top of Overblik while a picture is being read or checked.
function bankImportHtml() {
	if (bankImport === null) {
		return "";
	}
	const job = bankImport;
	if (job.status === "reading") {
		return `
			<section class="card" id="bank-import">
				<h2>${t("Læser billedet")}</h2>
				<p id="bank-progress-text" class="hint">${esc(bankReadingText(job.stage, job.share))}</p>
				<progress id="bank-progress" max="100" value="${Math.round(job.share * 100)}"></progress>
				<button type="button" class="secondary" data-action="close-bank-import">${t("Annullér")}</button>
			</section>`;
	}
	if (job.status === "failed") {
		return `
			<section class="card" id="bank-import">
				<h2>${t("Det lykkedes ikke")}</h2>
				<p>${esc(job.problem)}</p>
				<button type="button" class="secondary" data-action="close-bank-import">${t("Luk")}</button>
			</section>`;
	}

	const month = getMonth(job.monthKey);
	const found = job.rows.length;
	let html = `
		<section class="card" id="bank-import">
			<h2>${found === 0 ? t("Ingen udgifter fundet") : tn(found, "Fundet {n} linje til {month}", "Fundet {n} linjer til {month}", { month: esc(monthInSentence(job.monthKey)) })}</h2>
			<p class="hint">${t("Billedet kan være læst forkert. Tjek mod billedet, ret tekst og beløb, vælg kategori, og fjern fluebenet ved dem, du ikke vil have med.")}</p>
			<details class="explain">
				<summary>${t("Se billedet")}</summary>
				<img class="scan-picture" src="${esc(job.pictureUrl)}" alt="${t("Dit skærmbillede")}">
			</details>`;

	if (found > 0) {
		html += '<form id="bank-form" autocomplete="off">';
		job.rows.forEach((row, index) => {
			html += bankRowHtml(row, index, month);
		});
		html += `
				<button type="submit" class="primary" id="bank-add-button" ${job.rows.some((row) => row.tick) ? "" : "disabled"}>${bankAddLabel(job.rows)}</button>
				<p id="bank-message" class="message" role="status"></p>
			</form>`;
	}

	if (job.unclear.length > 0) {
		html += `
			<div class="scan-unclear">
				<h3>${t("Kunne ikke læses ({n})", { n: job.unclear.length })}</h3>
				<p class="hint">${t("De er ikke med. Skriv dem selv ind under Tilføj udgift.")}</p>
				<ul class="scan-lines">${job.unclear.map((line) => "<li>" + esc(line) + "</li>").join("")}</ul>
			</div>`;
	}
	if (job.elsewhere.length > 0) {
		const months = [...new Set(job.elsewhere.map((line) => line.date.slice(0, 7)))].sort().slice(0, 3);
		html += `<p class="hint">${tn(job.elsewhere.length, "{n} linje er fra andre måneder ({months}) og er ikke med. Gå til den måned, og vælg billedet igen.", "{n} linjer er fra andre måneder ({months}) og er ikke med. Gå til den måned, og vælg billedet igen.", { months: esc(months.map((key) => monthInSentence(key)).join(", ")) })}</p>`;
	}
	return html + `<button type="button" class="secondary" data-action="close-bank-import">${t("Luk")}</button></section>`;
}

// A box in a row was changed. The values live in bankImport.rows, so nothing is lost on a redraw.
function editBankRow(input) {
	const rowElement = input.closest(".scan-row");
	const row = bankImport && bankImport.status === "ready" && rowElement ? bankImport.rows[Number(rowElement.dataset.index)] : undefined;
	if (!row) {
		return;
	}
	const field = input.dataset.scan;
	if (field === "tick") {
		row.tick = input.checked;
		rowElement.classList.toggle("off", !row.tick);
		const button = document.getElementById("bank-add-button");
		if (button) {
			button.textContent = bankAddLabel(bankImport.rows);
			button.disabled = !bankImport.rows.some((other) => other.tick);
		}
	} else if (field === "note") {
		row.note = input.value;
	} else if (field === "amount") {
		row.amountText = input.value;
		input.classList.remove("bad");
	} else if (field === "category") {
		row.categoryId = input.value;
		row.touched = true;
		// The same shop on other lines that have no category yet gets this one too.
		const same = row.note.trim().toLowerCase();
		bankImport.rows.forEach((other, index) => {
			if (other !== row && !other.touched && other.categoryId === "" && same !== "" && other.note.trim().toLowerCase() === same) {
				other.categoryId = row.categoryId;
				const box = document.querySelector('.scan-row[data-index="' + index + '"] [data-scan="category"]');
				if (box) {
					box.value = row.categoryId;
				}
			}
		});
	}
}

// "Tilføj N udgifter": the ticked rows are written in, and the card closes.
function addBankRows() {
	const job = bankImport;
	if (job === null || job.status !== "ready") {
		return;
	}
	const chosen = [];
	let unreadable = false;
	job.rows.forEach((row, index) => {
		if (!row.tick) {
			return;
		}
		const amount = parseAmount(row.amountText);
		if (amount === null || amount <= 0) {
			unreadable = true;
			const box = document.querySelector('.scan-row[data-index="' + index + '"] [data-scan="amount"]');
			if (box) {
				box.classList.add("bad");
			}
			return;
		}
		chosen.push({ date: row.date, categoryId: row.categoryId, amount: amount, note: row.note.trim().slice(0, MAX_NOTE_LENGTH) });
	});
	if (unreadable) {
		setMessage("bank-message", t("Ret de røde beløb, eller fjern fluebenet ved dem."), true);
		return;
	}
	if (chosen.length === 0) {
		setMessage("bank-message", t("Der er ikke valgt nogen."), true);
		return;
	}
	if (getMonth(job.monthKey).spending.length + chosen.length > MOST_SPENDING_PER_MONTH) {
		setMessage("bank-message", t("Der kan højst være {max} udgifter i en måned. Fjern nogle af fluebenene.", { max: MOST_SPENDING_PER_MONTH }), true);
		return;
	}

	changeMonth((month) => {
		for (const item of chosen) {
			month.spending.push({ id: newId(), date: item.date, categoryId: item.categoryId, amount: item.amount, note: item.note });
		}
	}, job.monthKey);
	closeBankImport();
	render();
	setMessage("add-message", tn(chosen.length, "Tilføjet {n} udgift fra billedet.", "Tilføjet {n} udgifter fra billedet."), false);
}


// ---- Adding and deleting spending ----------------------------------------------

// A note you have used before brings its usual category with it: type "Rema 1000" (or pick it from
// the suggestions) and "Mad og dagligvarer" is chosen for you. Only when the note matches one you
// used before, and only if you have not picked a category yourself in this form.
function pickCategoryFromNote(noteBox) {
	const select = noteBox.form.elements.category;
	if (select.dataset.touched) {
		return;
	}
	const id = categoryIdForNote(noteSuggestions, noteBox.value, getMonth(viewMonth));
	if (id !== "") {
		select.value = id;
	}
}

function addSpending(form) {
	const amount = parseAmount(form.elements.amount.value);
	if (amount === null || amount <= 0) {
		setMessage("add-message", t("Skriv et beløb større end 0, fx 49,95."), true);
		form.elements.amount.focus();
		return;
	}

	const date = form.elements.date.value;
	if (date.slice(0, 7) !== viewMonth) {
		setMessage("add-message", t("Datoen skal ligge i {month}.", { month: monthInSentence(viewMonth) }), true);
		return;
	}

	if (getMonth(viewMonth).spending.length >= MOST_SPENDING_PER_MONTH) {
		setMessage("add-message", t("Der er for mange udgifter i denne måned ({max}). Slet nogle gamle.", { max: MOST_SPENDING_PER_MONTH }), true);
		return;
	}

	const categoryId = form.elements.category.value;
	const note = form.elements.note.value.trim().slice(0, MAX_NOTE_LENGTH);

	changeMonth((month) => {
		month.spending.push({ id: newId(), date: date, categoryId: categoryId, amount: amount, note: note });
	});
	lastCategoryId = categoryId;
	lastDate = { date: date, chosenOn: dateKeyOf(new Date()) };

	// Draw again so every number updates, then tell the user it worked.
	const where = categoryName(getMonth(viewMonth), categoryId);
	render();
	setMessage("add-message", t("Tilføjet: {amount} til {category}.", { amount: formatKr(amount), category: where }), false);
}

function deleteSpending(id) {
	const item = findRow(getMonth(viewMonth).spending, id);
	if (!item) {
		return;
	}
	const what = item.note !== "" ? item.note : categoryName(getMonth(viewMonth), item.categoryId);
	if (!confirm(t("Slet {amount} ({what})?", { amount: formatKr(item.amount), what: what }))) {
		return;
	}
	changeMonth((month) => {
		month.spending = month.spending.filter((other) => other.id !== id);
	});
	render();
}


// ---- Editing the plan ----------------------------------------------------------

// Called when a name or amount box in a row (Plan or Indstillinger) is changed. We do NOT redraw the
// rows here: redrawing would throw away the box you are tabbing into next.
function editRow(input) {
	const rowElement = input.closest(".row");
	const section = SECTIONS[rowElement.dataset.section];
	const id = rowElement.dataset.id;
	const field = input.dataset.field;

	if (field === "name") {
		const name = input.value.trim().slice(0, MAX_NAME_LENGTH);
		// A category that was just made (it had no name yet) goes into the other months too.
		// Renaming an old one only changes this month, as before.
		const before = findRow(getMonth(viewMonth)[section.key], id);
		const isNewCategory = section.key === "categories" && before !== undefined && before.name.trim() === "" && name !== "";
		changeMonth((month) => {
			const row = findRow(month[section.key], id);
			if (row) {
				row.name = name;
			}
		});
		if (isNewCategory) {
			shareCategories([name]);
		}
	} else if (field === "every") {
		// "Hver måned" (1) is the normal case and stores nothing. Anything else needs a first
		// payment date to count from: if there is none, this month's first day is filled in, so the
		// choice works at once and there is nothing more to do.
		const every = Number(input.value);
		changeMonth((month) => {
			const row = findRow(month[section.key], id);
			if (row && every > 1) {
				row.every = every;
				if (!row.from) {
					row.from = viewMonth + "-01";
				}
			} else if (row) {
				delete row.every;
			}
		});
	} else if (field === "from" || field === "to") {
		// A date box gives "2026-10-12", or "" when it is cleared. A row without a date simply
		// has no such field. A bill that comes every few months can't lose its first payment date:
		// clearing it makes the bill monthly again.
		const day = input.value;
		changeMonth((month) => {
			const row = findRow(month[section.key], id);
			if (row && day !== "") {
				row[field] = day;
			} else if (row) {
				delete row[field];
				if (field === "from") {
					delete row.every;
				}
			}
		});
	} else {
		const ore = parseAmount(input.value);
		if (ore === null) {
			// Can't read it: mark the box red and keep the old saved number.
			input.classList.add("bad");
			return;
		}
		input.classList.remove("bad");
		changeMonth((month) => {
			const row = findRow(month[section.key], id);
			if (row) {
				row[section.amountField] = ore;
			}
		});
		input.value = amountToInput(ore);   // tidy what was typed: "1.250" becomes "1250"
	}

	if (section.hasDates) {
		refreshDatesOf(rowElement, findRow(getMonth(viewMonth)[section.key], id), section);
	}
	refreshPlanSummary();
}

// "Ryd": takes the dates (and how often) off a row, so it counts every month again.
function clearDates(button) {
	const rowElement = button.closest(".row");
	const section = SECTIONS[rowElement.dataset.section];
	const id = rowElement.dataset.id;
	changeMonth((month) => {
		const row = findRow(month[section.key], id);
		if (row) {
			delete row.from;
			delete row.to;
			delete row.every;
		}
	});
	refreshDatesOf(rowElement, findRow(getMonth(viewMonth)[section.key], id), section);
	refreshPlanSummary();
}

function editSavings(input) {
	const ore = parseAmount(input.value);
	if (ore === null) {
		input.classList.add("bad");
		return;
	}
	input.classList.remove("bad");
	changeMonth((month) => {
		month.savings = ore;
	});
	input.value = amountToInput(ore);
	refreshPlanSummary();
}

// The Lønkonto and Opsparing boxes on Fremtid. What you type is the real number from the bank:
// it replaces the old one and is stamped with this moment, so whatever the kids did before now is
// already in it (see moneyNow in budget.js). An empty box counts as 0 kr.
function editMoneyNow(input) {
	const ore = parseSignedAmount(input.value);
	if (ore === null) {
		input.classList.add("bad");
		return;
	}
	input.classList.remove("bad");
	changeMonth((month) => {
		month.balances = month.balances || {};
		month.balances[input.dataset.balance] = { amount: ore, at: Date.now() };
	}, monthToKeepBalancesIn());
	input.value = ore === 0 ? "0" : amountToInput(ore);
	refreshMoneyNow();
}

// The typed numbers are "now", not part of any one month, and the newest one wins wherever it is
// saved. So they go into a month that is already saved (this one, else the latest): saving a month
// that did not exist would give it its own copy of the plan, and then it would stop following the
// plan of the month before it.
function monthToKeepBalancesIn() {
	const thisMonth = monthKeyOf(new Date());
	if (data.months[thisMonth]) {
		return thisMonth;
	}
	const saved = Object.keys(data.months).sort();
	return saved.length > 0 ? saved[saved.length - 1] : thisMonth;
}

// After a number is typed: the small notes, the total and the results change; the boxes stay.
function refreshMoneyNow() {
	const now = moneyNow(monthsForMoney());
	const account = document.getElementById("account-note");
	const savings = document.getElementById("savings-note");
	const total = document.getElementById("money-total");
	if (account) {
		account.textContent = accountNoteText(now);
	}
	if (savings) {
		savings.textContent = savingsNoteText(now);
	}
	if (total) {
		total.innerHTML = moneyTotalHtml(getMonth(viewMonth), now);
	}
	refreshFutureResults();
}

function addRow(section) {
	if (getMonth(viewMonth)[section.key].length >= section.mostRows) {
		window.alert(t("Der kan højst være {max} rækker her.", { max: section.mostRows }));
		return;
	}
	const row = { id: newId(), name: "" };
	row[section.amountField] = 0;
	changeMonth((month) => {
		month[section.key].push(row);
	});
	render();

	// Put the cursor in the new row's name box so you can start typing.
	const nameBox = document.querySelector('.row[data-id="' + row.id + '"] [data-field="name"]');
	if (nameBox) {
		nameBox.focus();
	}
}

// Puts these categories into every saved month that lacks them (with no limit there: the limit is
// each month's own business). Returns how many months got something.
function shareCategories(names) {
	const missing = missingCategoryNames(data.months, names);
	const monthKeys = Object.keys(missing);
	for (const monthKey of monthKeys) {
		changeMonth((month) => {
			for (const name of missing[monthKey]) {
				month.categories.push({ id: newId(), name: name, limit: 0 });
			}
		}, monthKey);
	}
	return monthKeys.length;
}

// The button under the categories: for categories made before new ones followed you into the other
// months. Only shown while some month lacks one of this month's categories.
function shareCategoriesHtml(month) {
	const names = month.categories.map((category) => category.name);
	const count = Object.keys(missingCategoryNames(data.months, names)).length;
	let html = "";
	if (shareNote !== "") {
		html += `<p class="message" role="status">${esc(shareNote)}</p>`;
	}
	if (count > 0) {
		html += `
			<p class="hint">${tn(count, "En anden måned mangler nogle af kategorierne her.", "{n} andre måneder mangler nogle af kategorierne her.")}</p>
			<button type="button" class="secondary" data-action="share-categories">${t("Brug disse kategorier i alle måneder")}</button>`;
	}
	return html;
}

function deleteRow(button) {
	const rowElement = button.closest(".row");
	const section = SECTIONS[rowElement.dataset.section];
	const id = rowElement.dataset.id;
	const row = findRow(getMonth(viewMonth)[section.key], id);
	if (!row) {
		return;
	}

	// An empty row can go without asking; one with content gets a safety question.
	const hasContent = row.name !== "" || row[section.amountField] !== 0;
	if (hasContent) {
		let question = t('Slet "{name}"?', { name: row.name || t("uden navn") });
		if (section.key === "categories") {
			question += " " + t('Udgifter, der allerede er skrevet ind her, bliver stående som "Uden kategori".');
		}
		if (!confirm(question)) {
			return;
		}
	}

	changeMonth((month) => {
		month[section.key] = month[section.key].filter((other) => other.id !== id);
	});
	render();
}


// ---- Backup ----------------------------------------------------------------------

function exportBackup() {
	if (tryMode()) {
		return;
	}
	downloadText("budget-kopi-" + dateKeyOf(new Date()) + ".json", JSON.stringify(data, null, 2), "application/json");
	setMessage("backup-message", t("Kopien er gemt som en fil."), false);
}

async function importBackup(input) {
	const file = input.files[0];
	input.value = "";   // so choosing the same file again still counts as a change
	if (!file || tryMode()) {
		return;
	}

	try {
		const cleaned = cleanData(JSON.parse(await file.text()));
		const monthCount = Object.keys(cleaned.months).length;
		if (monthCount === 0) {
			setMessage("backup-message", t("Filen ligner ikke en kopi fra denne side."), true);
			return;
		}
		if (accountName !== null) {
			// On an account, months are sent one by one; months not in the file stay as they are.
			if (!confirm(t("Lægge kopiens {months} ind på kontoen? Måneder med samme navn bliver erstattet.", { months: monthsText(monthCount) }))) {
				return;
			}
			for (const key of Object.keys(cleaned.months)) {
				data.months[key] = cleaned.months[key];
				saveMonth(key, cleaned.months[key]);
			}
		} else {
			if (!confirm(t("Erstat alt, du har nu, med kopien ({months})?", { months: monthsText(monthCount) }))) {
				return;
			}
			data = cleaned;
			saveData();
		}
		render();
		setMessage("backup-message", t("Kopien er hentet."), false);
	} catch (error) {
		setMessage("backup-message", t("Kunne ikke læse filen."), true);
	}
}


// --- Accounts ------------------------------------------------------------------------
//
// Two modes. Signed out: the numbers are this device's own copy (localStorage), as before.
// Signed in: the numbers live in the account online. We listen to them, so a change made on
// another phone shows up here by itself, and every change made here is sent to the account.

// Reads the two boxes of the account form. Returns null (after saying why) if they're unusable.
function readAccountForm(form) {
	if (firebase === null) {
		setMessage("account-message", t("Kontoen er ved at starte. Prøv igen om et øjeblik."), true);
		return null;
	}
	const username = cleanUsername(form.elements.username.value);
	const password = form.elements.password.value;
	if (!isValidUsername(username)) {
		setMessage("account-message", t("Brugernavnet skal være 3–20 tegn: a–z, tal, - og _ (ingen æ, ø, å)."), true);
		return null;
	}
	if (password === "") {
		setMessage("account-message", t("Skriv en adgangskode."), true);
		return null;
	}
	return { username: username, password: password };
}

async function signInFromForm(form) {
	const login = readAccountForm(form);
	if (!login) {
		return;
	}
	setMessage("account-message", t("Logger ind …"), false);
	justSignedIn = true;
	try {
		await signIn(login.username, login.password);
	} catch (error) {
		justSignedIn = false;
		setMessage("account-message", accountProblemText(error), true);
	}
}

async function createAccountFromForm(form) {
	const login = readAccountForm(form);
	if (!login) {
		return;
	}

	// A new password must be strong: the checker (zxcvbn) is downloaded the first time.
	setMessage("account-message", t("Tjekker adgangskoden …"), false);
	try {
		await loadPasswordChecker();
	} catch (error) {
		setMessage("account-message", t("Kunne ikke hente adgangskode-tjekket. Tjek internettet."), true);
		return;
	}
	const check = checkNewPassword(login.password, login.username);
	if (!check.ok) {
		setMessage("account-message", check.message, true);
		return;
	}

	setMessage("account-message", t("Opretter kontoen …"), false);
	justSignedIn = true;
	try {
		await createAccount(login.username, login.password);
	} catch (error) {
		justSignedIn = false;
		setMessage("account-message", accountProblemText(error), true);
	}
}

// Firebase calls this when someone signs in or out, and once at start with whoever was
// already signed in on this device (or null).
function onAccountChange(username) {
	if (username === watchedAccount && username === accountName) {
		return;   // nothing new
	}
	if (stopWatching) {
		stopWatching();
		stopWatching = null;
	}
	stopKidAccess();
	watchedAccount = username;
	accountName = username;
	accountReady = false;
	accountFailed = false;
	pendingSaves = 0;
	arrived = null;
	saveSignedInHint(username);
	setWarning("");

	if (username === null) {
		data = signedOutData();   // signed out: an empty page to try (nothing of the account is left on screen)
		if (activeTab === "report") {
			activeTab = "settings";   // the report needs an account
		}
	} else {
		data = { months: {} };   // until the account's months arrive (onAccountMonths)
		stopWatching = watchAccountMonths(username, onAccountMonths, onAccountProblem);
		startKidAccess(username);
	}
	render();
}

// Is the user in the middle of typing in a box? Redrawing then would wipe what they typed.
function isTyping() {
	const element = document.activeElement;
	return !!element && element.matches("#view input, #view select");
}

// The account's months arrived, or one of them changed (here or on another device).
function onAccountMonths(months, confirmed, hasPendingWrites) {
	const fresh = cleanData({ months: months });
	const firstTime = !accountReady;

	// Offline with nothing kept on this device yet, "no months" only means "no news".
	// Taking it as "an empty account" could let the next save replace real numbers.
	if (firstTime && Object.keys(fresh.months).length === 0 && !confirmed) {
		return;
	}

	arrived = { fresh: fresh, hasPendingWrites: hasPendingWrites };

	if (firstTime) {
		// Nothing of ours to be ahead of yet: take it.
		accountReady = true;
		data = fresh;
		syncState = hasPendingWrites ? "saving" : "saved";
		render();
		offerToMoveDeviceData();
		return;
	}
	takeArrivedNews();
}

// Decides whether the newest news from the account replaces what is on screen.
// While changes made here are still on their way, this page is AHEAD of the news, which may have
// been worked out before those changes: taking it would undo them (and the next change would
// then save the undone version). So news counts only at a quiet moment - and this is called
// again each time a change is confirmed, so news that came meanwhile isn't forgotten.
function takeArrivedNews() {
	if (!accountReady || arrived === null) {
		return;
	}
	const ahead = pendingSaves > 0 || arrived.hasPendingWrites;
	syncState = ahead ? "saving" : "saved";

	if (!ahead && !sameData(arrived.fresh, data)) {
		data = arrived.fresh;
		if (!isTyping()) {
			render();
			return;
		}
	}
	showSyncStatus();
}

function onAccountProblem(error) {
	console.error(error);
	accountFailed = true;
	setWarning(accountProblemText(error));
	render();
}

// Right after signing in by hand: numbers already kept on this device can join the account.
// - A month the account doesn't have is added as it is.
// - A month the account has keeps the account's plan, and gets the purchases that exist only on
//   this device (mergeDeviceMonth in budget.js), so nothing written here is lost.
// The device copy is put aside (not deleted), so nothing can be lost.
const MOVED_DEVICE_COPY_KEY = "budget.v1.movedToAccount";

function offerToMoveDeviceData() {
	if (!justSignedIn) {
		return;
	}
	justSignedIn = false;

	const device = loadData();
	const deviceKeys = Object.keys(device.months);
	if (deviceKeys.length === 0) {
		return;
	}
	const question = t("Du har tal gemt på denne enhed fra før ({months}). Skal de lægges ind på kontoen? En måned, kontoen allerede har, beholder kontoens plan og får lagt de udgifter til, som kun står på denne enhed.", { months: monthsText(deviceKeys.length) });
	if (!confirm(question)) {
		return;
	}

	for (const key of deviceKeys) {
		if (!data.months[key]) {
			data.months[key] = device.months[key];
			saveMonth(key, device.months[key]);
			continue;
		}
		const merge = mergeDeviceMonth(data.months[key], device.months[key]);
		if (merge.added > 0) {
			data.months[key] = merge.month;
			saveMonth(key, merge.month);
		}
	}
	try {
		localStorage.setItem(MOVED_DEVICE_COPY_KEY, localStorage.getItem(STORAGE_KEY));
		localStorage.removeItem(STORAGE_KEY);
	} catch (error) {
		console.error(error);
	}
	render();
}


// --- Start ---------------------------------------------------------------------------

setLanguage(languageForStart());
setCurrency(currencyForStart());
applyStaticTexts();
applyTheme(currentTheme);   // (index.html has already put the colours on; this also sets the phone's top bar)

// Opened with a kid's link (or on a device that remembers one): then it is only the kid's own page,
// with nothing of the budget on it (kid.js). Otherwise the normal page.
const kidLinkKey = accountsAvailable() ? findKidKey() : null;
if (kidLinkKey !== null) {
	startKidMode(kidLinkKey);
} else {
	checkStorage();
	render();

	if (accountsAvailable()) {
		startAccounts(onAccountChange).catch((error) => {
			console.error(error);
			accountFailed = true;
			setWarning(t("Kunne ikke starte kontoen. Tjek internettet."));
			render();
		});
	}
}
