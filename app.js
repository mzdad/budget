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
// Remembers which account was signed in, so that at the next start the page waits for that
// account's numbers instead of showing (and letting you edit) this device's own copy.
const SIGNED_IN_HINT_KEY = "budget.signedInAs";

// The three lists of rows (income and fixed bills on Plan, categories on Indstillinger) are drawn
// by the same code. Only the texts and the name of the amount field differ ("limit" for categories).
const INCOME_SECTION = {
	key: "income",
	title: "Indkomst",
	hint: "Det du får, efter skat.",
	amountField: "amount",
	addLabel: "+ Tilføj indkomst",
	mostRows: MOST_INCOME_ROWS,
	hasDates: true,
	hasFrequency: true,   // income can come every few months too (børnepenge every 3rd month)
};
const FIXED_SECTION = {
	key: "fixed",
	title: "Faste udgifter",
	hint: "Regninger og abonnementer.",
	amountField: "amount",
	addLabel: "+ Tilføj fast udgift",
	mostRows: MOST_FIXED_ROWS,
	hasDates: true,
	hasFrequency: true,   // a bill can come every few months, or once a year
};
const CATEGORY_SECTION = {
	key: "categories",
	title: "Kategorier",
	hint: "Det du bruger penge på, og hvor meget du højst vil bruge på hver. En ny kategori kommer i alle måneder; grænsen gælder kun denne måned.",
	amountField: "limit",
	addLabel: "+ Tilføj kategori",
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

let data = accountName === null ? loadData() : { months: {} };   // { months: { "2026-09": {...} } }
let viewMonth = monthKeyOf(new Date());       // the month on screen
let activeTab = "overview";                   // "overview", "expenses", "future", "plan", "settings" or "report"
let reportScope = null;                       // what the report shows: { type: "month" | "year", key }
let lastCategoryId = "";                      // so the next purchase starts on the same category
let lastDate = { date: "", chosenOn: "" };    // so the next purchase starts on the same day (see addFormHtml)
let categoriesOpen = loadCategoriesOpen();    // is the categories card on Overblik open?
let datesOpen = loadDatesOpen();              // rows whose dates box you opened or folded yourself
let shareNote = "";                           // what "Brug disse kategorier i alle måneder" said, shown once


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

const NO_STORAGE_WARNING = "Din browser vil ikke gemme tal her (måske et privat vindue?). Det du skriver, forsvinder, når du lukker siden.";

// Shows a message in the orange bar under the month switcher; "" hides it.
function setWarning(text) {
	const bar = document.getElementById("save-warning");
	bar.textContent = text;
	bar.hidden = text === "";
}

function saveData() {
	let worked = true;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
	} catch (error) {
		worked = false;
	}
	setWarning(worked ? "" : NO_STORAGE_WARNING);
}

// Some browsers (private windows) refuse to save. Find out at start, so the
// warning shows before the user types anything.
function checkStorage() {
	let worked = true;
	try {
		localStorage.setItem("budget.check", "1");
		localStorage.removeItem("budget.check");
	} catch (error) {
		worked = false;
	}
	setWarning(worked ? "" : NO_STORAGE_WARNING);
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
			setWarning("Kunne ikke gemme på kontoen: " + accountProblemText(error));
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
			return category.name || "(uden navn)";
		}
	}
	return "Uden kategori";
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
	return count === 1 ? "1 måned" : count + " måneder";
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
		html = futureHtml(month);
	} else if (activeTab === "settings") {
		html = settingsHtml(month);
	} else if (activeTab === "report" && reportScope !== null) {
		html = reportHtml();
	} else {
		html = planHtml(month);
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
				<h2>Kunne ikke hente dine tal</h2>
				<p>Tjek, at du har internet, og prøv igen. Dine tal er ikke væk.</p>
				<button class="primary" data-action="retry">Prøv igen</button>
			</section>`;
	}
	return '<section class="card"><h2>Henter dine tal …</h2><p class="hint">Et øjeblik.</p></section>';
}

// The thin line under the month switcher: is everything saved? Only shown when signed in.
function showSyncStatus() {
	const line = document.getElementById("sync-status");
	if (accountName === null || !accountReady) {
		line.hidden = true;
		return;
	}
	if (!navigator.onLine) {
		line.textContent = "Ingen forbindelse. Dine ændringer gemmes, når du er online igen.";
	} else if (syncState === "saving") {
		line.textContent = "Gemmer …";
	} else {
		line.textContent = "✓ Gemt på kontoen";
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
			<h2>Kom i gang</h2>
			<ol>
				<li>Skriv din indkomst og dine faste udgifter under <b>Plan</b>.</li>
				<li>Skriv hver udgift ind her.</li>
			</ol>
			<button class="primary" data-tab="plan">Start med planen</button>
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
		note = "Du er " + formatKr(-s.left) + " over budget.";
	} else if (s.left === 0 && s.available > 0) {
		note = "Hele beløbet er brugt.";
	} else if (daysLeft !== null && s.left > 0) {
		// Whole kroner per day, rounded down, so the advice is never too generous.
		const perDayKr = Math.floor(s.left / daysLeft / 100);
		if (perDayKr > 0) {
			note = "Det svarer til ca. " + formatKr(perDayKr * 100) + " om dagen i " + daysLeft + (daysLeft === 1 ? " dag." : " dage.");
		} else {
			note = "Der er næsten ikke noget tilbage.";
		}
	}

	return `
		<section class="card">
			<div class="label">Tilbage at bruge</div>
			<div class="big-number ${tone}">${formatKr(s.left)}</div>
			<p>${esc(note)}</p>
			<div class="facts">
				<span>Til rådighed <b>${formatKr(s.available)}</b></span>
				<span>Brugt <b>${formatKr(s.spent)}</b></span>
			</div>
		</section>`;
}

function categoryOptionsHtml(month) {
	if (month.categories.length === 0) {
		return '<option value="">Uden kategori</option>';
	}
	let html = "";
	for (const category of month.categories) {
		const selected = category.id === lastCategoryId ? " selected" : "";
		html += `<option value="${esc(category.id)}"${selected}>${esc(category.name || "(uden navn)")}</option>`;
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
			<h2>Tilføj udgift</h2>
			<label>Beløb i kroner
				<input name="amount" inputmode="decimal" placeholder="fx 49,95" required>
			</label>
			<label>Note (hvis du vil)
				<input name="note" list="note-suggestions" maxlength="${MAX_NOTE_LENGTH}" placeholder="fx Rema 1000">
				<datalist id="note-suggestions">${noteOptionsHtml()}</datalist>
			</label>
			<label>Kategori
				<select name="category">${categoryOptionsHtml(month)}</select>
			</label>
			<label>Dato
				<input type="date" name="date" value="${dateValue}" min="${firstDay}" max="${lastDay}" required>
			</label>
			<button type="submit" class="primary">Tilføj</button>
			<p id="add-message" class="message" role="status"></p>
		</form>`;
}

// The categories card: a fold. Open, each category has a bar and a note. Folded, it shows a
// small view instead - one line per category with a thin bar and what is left - so you can still
// see how you are doing without the space. The fold is remembered (categoriesOpen).
function categoryBarsHtml(s) {
	if (s.categories.length === 0 && s.otherSpent === 0) {
		return '<section class="card"><h2>Dine kategorier</h2><p class="hint">Lav kategorier under Indstillinger.</p><button class="secondary" data-tab="settings">Åbn indstillinger</button></section>';
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
				<div class="category-top"><span>Uden kategori</span><span class="amounts">${formatKr(s.otherSpent)}</span></div>
			</div>`;
		mini += `<span class="mini-row"><span class="mini-name">Uden kategori</span><span></span><span class="mini-amount">${formatKr(s.otherSpent)}</span></span>`;
	}

	return `
		<section class="card categories-card">
			<details id="categories-details" ${categoriesOpen ? "open" : ""}>
				<summary><h2>Dine kategorier</h2><span class="mini">${mini}</span></summary>
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
		amount = formatKr(-category.left) + " over";
	} else {
		amount = formatKr(category.left);
	}

	return `
		<span class="mini-row">
			<span class="mini-name">${esc(category.name || "(uden navn)")}</span>
			<span class="bar mini-bar" role="img" aria-label="${width} procent brugt"><span class="fill ${level}" style="width:${width}%"></span></span>
			<span class="mini-amount ${level === "over" ? "over" : ""}">${amount}</span>
		</span>`;
}

function categoryBarHtml(category) {
	const level = barLevel(category.spent, category.limit);
	const width = Math.round(barShare(category.spent, category.limit) * 100);

	let note = "";
	if (level === "nolimit") {
		note = "Ingen grænse";
	} else if (level === "over") {
		note = formatKr(-category.left) + " over grænsen";
	} else {
		note = formatKr(category.left) + " tilbage";
	}

	const amounts = category.limit > 0
		? formatKr(category.spent) + " af " + formatKr(category.limit)
		: formatKr(category.spent);

	return `
		<div class="category">
			<div class="category-top">
				<span>${esc(category.name || "(uden navn)")}</span>
				<span class="amounts">${amounts}</span>
			</div>
			<div class="bar" role="img" aria-label="${width} procent brugt">
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
			<div class="label">Brugt i alt i ${esc(monthLabel(viewMonth).toLowerCase())}</div>
			<div class="big-number">${formatKr(s.spent)}</div>
		</section>`;

	if (month.spending.length === 0) {
		return html + '<section class="card"><p class="hint">Ingen udgifter endnu.</p></section>';
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
					<button class="icon" data-action="delete-spending" data-id="${esc(item.id)}" aria-label="Slet udgiften">✕</button>
				</li>`;
		}
		html += "</ul>";
	}
	return html + "</section>";
}

// "2026-09-02" -> "2. sep."
function shortDayText(dateKey) {
	const parts = dateKey.split("-").map(Number);
	return new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short" }).format(new Date(parts[0], parts[1] - 1, parts[2]));
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
			<h2>Penge nu</h2>
			<p class="hint">${hasKids ? "Opsparing er hele bunken, også børnenes penge." : "Hvad står der på dine konti lige nu?"}</p>
			<div class="single-row">
				<label for="account-balance">Lønkonto</label>
				<input id="account-balance" data-balance="account" value="${balanceInputText(now.account, now.accountNow)}" placeholder="0" inputmode="decimal" autocomplete="off">
			</div>
			<p class="balance-note" id="account-note">${esc(accountNoteText(now))}</p>
			<div class="single-row">
				<label for="savings-balance">Opsparing</label>
				<input id="savings-balance" data-balance="savings" value="${balanceInputText(now.savings, now.savingsNow)}" placeholder="0" inputmode="decimal" autocomplete="off">
			</div>
			<p class="balance-note" id="savings-note">${esc(savingsNoteText(now))}</p>
			<div id="money-total">${moneyTotalHtml(month, now)}</div>
			<details class="explain">
				<summary>Hvad betyder det?</summary>
				<p class="hint">Skriv tallene fra banken. Det nyeste, du skriver, gælder altid.${hasKids ? " Opsparing går ned, når et barn bruger penge, og op, når et barn får penge." : ""} Lønkonto ændrer sig ikke af sig selv.</p>
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
	return new Intl.DateTimeFormat("da-DK", options).format(date);
}

function accountNoteText(now) {
	return now.account ? "Opdateret " + momentText(now.account.at) : "";
}

// "Opdateret 1. okt. · siden da: børnene −300 kr." - the last part only when a kid changed it.
function savingsNoteText(now) {
	if (!now.savings) {
		return "";
	}
	let text = "Opdateret " + momentText(now.savings.at);
	if (now.fromKids !== 0) {
		text += " · siden da: børnene " + (now.fromKids < 0 ? "−" : "+") + formatKr(Math.abs(now.fromKids));
	}
	return text;
}

// The total under the two boxes, and what it is counted from. Before the two numbers are typed, a
// number saved by an older version (the single "Penge i alt") is still used, and this says so.
function moneyTotalHtml(month, now) {
	if (now.any) {
		return `
			<div class="facts"><span>I alt: <b>${formatKr(now.total)}</b></span></div>
			<p class="hint">Regnes fra starten af ${esc(monthLabel(viewMonth).toLowerCase())}.</p>`;
	}
	if (month.startBalance > 0) {
		return `<p class="hint">Dit gamle tal: <b>${formatKr(month.startBalance)}</b> Skriv dine to konti her for at erstatte det.</p>`;
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
		return '<section class="card"><p>Skriv din indkomst under <b>Plan</b> først.</p></section>';
	}

	const f = forecast(month, viewMonth, FORECAST_MONTHS, data.months, startTotalFor(month));
	const tone = f.endTotal < 0 ? "bad" : "good";

	// When you have set up later months differently (a new job, say), "the same every month"
	// would be wrong, so the lines say that the amount changes and the table shows each month.
	const perMonthText = f.varies
		? `Lægges til: <b>${formatKr(f.perMonth)}</b> nu, ændrer sig senere`
		: `Lægges til hver måned <b>${formatKr(f.perMonth)}</b>`;
	const carefulText = `Kun opsparingen: <b>${formatKr(f.carefulEndTotal)}</b>`;

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
			<div class="label">Om ${FORECAST_MONTHS} måneder har du</div>
			<div class="big-number ${tone}">${formatKr(f.endTotal)}</div>
			<p class="hint">Ved udgangen af ${esc(monthLabel(f.lastKey).toLowerCase())}.</p>
			<div class="facts">
				<span>${perMonthText}</span>
			</div>
			<div class="facts">
				<span>${carefulText}</span>
			</div>
			${othersLineHtml(f.endTotal)}
			<details class="explain">
				<summary>Hvad betyder det?</summary>
				<p class="hint">Det store tal: du bruger præcis dine grænser og beholder resten. "Kun opsparingen": du bruger alt andet end det, du har sat til side. Et regnestykke, ikke en forudsigelse.</p>
			</details>
		</section>
		<section class="card">
			<details>
				<summary class="fold-title">Måned for måned</summary>
				<div class="table-scroll">
					<table>
						<thead><tr><th>Måned</th><th>Lægges til</th><th>Penge i alt</th></tr></thead>
						<tbody>
							<tr><td>Start</td><td></td><td>${formatKr(f.start)}</td></tr>${rows}
						</tbody>
					</table>
				</div>
				<p class="hint" style="margin-top:8px">* = måneden er ikke sat op og bruger planen fra måneden før.</p>
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
	const who = people.length === 1 ? people[0].person : "børnene";
	return `<div class="facts"><span>Heraf ${esc(who)} (i dag): <b>${formatKr(others)}</b> · Dine egne: <b>${formatKr(endTotal - others)}</b></span></div>`;
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
				<h2>Konto</h2>
				<p>Logget ind som <b>${esc(accountName)}</b>. Dine tal er gemt online.</p>
				<button class="secondary" data-action="sign-out">Log ud</button>
			</section>`;
	}

	return `
		<section class="card">
			<h2>Gem dine tal på en konto</h2>
			<p class="hint">Så følger dine tal dig overalt, og de går ikke tabt.</p>
			<form id="account-form" autocomplete="on">
				<label>Brugernavn
					<input name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="20" required>
				</label>
				<label>Adgangskode
					<input name="password" type="password" autocomplete="current-password" required>
				</label>
				<button type="submit" class="primary">Log ind</button>
				<button type="button" class="secondary" data-action="create-account">Opret ny konto</button>
				<p id="account-message" class="message" role="status"></p>
			</form>
			<p class="hint">Brugernavn uden æ, ø, å. Adgangskode: mindst 10 tegn, fx tre ord og et tal.</p>
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
		+ exportHtml()
		+ backupHtml();
}

// The "Eksport" box on Indstillinger: pick a month or a year and open its report.
function exportHtml() {
	let options = `<option value="month:${viewMonth}">Denne måned: ${esc(monthLabel(viewMonth))}</option>`;
	for (const year of yearsWithData(data.months)) {
		options += `<option value="year:${year}">Hele året ${year}</option>`;
	}
	return `
		<section class="card">
			<h2>Eksport</h2>
			<p class="hint">Hent en måned eller et helt år til Excel eller PDF.</p>
			<label>Hvad vil du se?
				<select id="export-scope">${options}</select>
			</label>
			<button class="secondary" data-action="open-report">Åbn rapport</button>
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

	let html = "<h2>Sådan ser måneden ud</h2><div class=\"sum-lines\">";
	html += summaryLineHtml("Indkomst", formatKr(s.income));
	html += summaryLineHtml("Faste udgifter", minus(s.fixed));
	html += summaryLineHtml("Opsparing", minus(s.savings));
	html += summaryLineHtml("Til rådighed", formatKr(s.available), s.available < 0 ? "total bad" : "total");
	html += summaryLineHtml("Fordelt på hverdagen", minus(s.limits));

	if (s.unassigned >= 0) {
		html += summaryLineHtml("Ikke fordelt endnu", formatKr(s.unassigned), "good");
	} else {
		html += summaryLineHtml("Fordelt for meget", formatKr(-s.unassigned), "bad");
	}
	html += "</div>";

	if (s.unassigned < 0) {
		html += '<p class="hint" style="margin-top:8px">Du har fordelt mere, end du har.</p>';
	}
	html += '<p class="hint" style="margin-top:8px">Alt gemmes med det samme. Ændringer gælder kun denne måned.</p>';
	html += '<button type="button" class="link" data-tab="settings">Ret kategorier og grænser →</button>';
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
		? `Ikke fordelt endnu: <b>${formatKr(s.unassigned)}</b>`
		: `Fordelt for meget: <b class="bad-text">${formatKr(-s.unassigned)}</b>`;
	return `Til rådighed: <b>${formatKr(s.available)}</b> · ${rest}`;
}

function planSectionHtml(section, month) {
	let html = `<section class="card"><h2>${section.title}</h2><p class="hint">${section.hint}</p>`;
	if (section.key === "categories") {
		html += `<p class="category-summary" id="category-summary">${categorySummaryHtml(month)}</p>`;
	}
	for (const row of month[section.key]) {
		html += rowHtml(section, row);
	}
	html += `<button class="secondary" data-action="add-row" data-section="${section.key}">${section.addLabel}</button>`;
	if (section.key === "categories") {
		html += shareCategoriesHtml(month);
		shareNote = "";   // said once
	}
	return html + "</section>";
}

function rowHtml(section, row) {
	return `
		<div class="row" data-section="${section.key}" data-id="${esc(row.id)}">
			<input data-field="name" value="${esc(row.name)}" placeholder="Navn" maxlength="${MAX_NAME_LENGTH}" aria-label="Navn" autocomplete="off">
			<input data-field="amount" value="${amountToInput(row[section.amountField])}" placeholder="0" inputmode="decimal" aria-label="Beløb i kroner" autocomplete="off">
			<button class="icon" data-action="delete-row" aria-label="Slet rækken">✕</button>
			${section.hasDates ? datesHtml(row, section) : ""}
		</div>`;
}

// The small box under an income or fixed-bill row. It is a <details>: folded to one line of small
// text (which also says what the row is now) until you need it, and open from the start for a
// row that has dates or a frequency, unless you have opened or folded it yourself: then it stays
// the way you left it, in every month (datesOpen). (The maths is in budget.js: amountIn, isDueIn.)
// A fixed bill can also say how often it comes: every month, every 2nd/3rd/6th month, or once a
// year. Then the date means "first payment" (only the month counts).
const EVERY_LABELS = { 1: "Hver måned", 2: "Hver 2. måned", 3: "Hver 3. måned", 6: "Hver 6. måned", 12: "Hvert år" };

function datesHtml(row, section) {
	let frequencyBox = "";
	if (section.hasFrequency) {
		const options = EVERY_CHOICES.map((every) => `<option value="${every}"${(row.every || 1) === every ? " selected" : ""}>${EVERY_LABELS[every]}</option>`).join("");
		frequencyBox = `<label>Hvor ofte? <select data-field="every">${options}</select></label>`;
	}
	const hasSomething = Boolean(row.from || row.to || row.every > 1);
	const isOpen = datesOpen[row.id] !== undefined ? datesOpen[row.id] : hasSomething;
	return `
		<details class="dates" ${isOpen ? "open" : ""}>
			<summary>${esc(datesSummaryText(row, section))}</summary>
			${frequencyBox}
			<div class="dates-line">
				<label><span class="from-label">${row.every > 1 ? "Første betaling" : "Fra"}</span> <input type="date" data-field="from" value="${esc(row.from || "")}"></label>
				<label>Til <input type="date" data-field="to" value="${esc(row.to || "")}"></label>
			</div>
			<p class="hint date-note">${esc(dateNoteText(row))}</p>
			<button type="button" class="link" data-action="clear-dates">Ryd</button>
		</details>`;
}

function datesSummaryText(row, section) {
	if (row.every > 1) {
		const first = row.from ? ", første gang " + dateText(row.from) : "";
		return EVERY_LABELS[row.every] + first;
	}
	const when = windowText(row);
	if (when !== "") {
		return "Gælder " + when;
	}
	return EVERY_LABELS[1];
}

// What the row means for the month on screen, so nobody has to work it out.
function dateNoteText(row) {
	const month = monthLabel(viewMonth).toLowerCase();

	if (isPeriodic(row)) {
		if (isDueIn(row, viewMonth)) {
			return "Betales i " + month + ": " + formatKr(row.amount);
		}
		const next = nextDueKey(row, viewMonth);
		return next ? "Betales ikke i " + month + ". Næste gang: " + monthLabel(next).toLowerCase() : "Betales ikke flere gange.";
	}

	if (!row.from && !row.to) {
		return "";   // nothing special to explain
	}
	if (row.from && row.to && row.from > row.to) {
		return "Fra-datoen ligger efter til-datoen, så rækken tæller aldrig.";
	}
	const days = lastDayOfMonth(viewMonth);
	const active = activeDaysIn(row, viewMonth);
	if (active === 0) {
		return "Gælder ikke i " + month + ".";
	}
	if (active === days) {
		return "Gælder hele " + month + ": " + formatKr(row.amount);
	}
	return "I " + month + " tæller " + active + " af " + days + " dage: " + formatKr(amountIn(row, viewMonth));
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
	rowElement.querySelector(".from-label").textContent = row.every > 1 ? "Første betaling" : "Fra";
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
			<h2>Opsparing</h2>
			<p class="hint">Hvor meget lægger du til side hver måned?</p>
			<div class="single-row">
				<label for="savings-input">Opsparing pr. måned</label>
				<input id="savings-input" value="${amountToInput(month.savings)}" placeholder="0" inputmode="decimal" autocomplete="off">
			</div>
		</section>`;
}

function backupHtml() {
	// Safari can clear a web page's saved numbers after a week. An account makes that harmless.
	const iPhoneTip = accountName === null
		? " På iPhone: Del → Føj til hjemmeskærm, så Safari ikke rydder dine tal."
		: "";
	return `
		<section class="card">
			<h2>Sikkerhedskopi</h2>
			<p class="hint">Gem en kopi som ekstra sikkerhed.${iPhoneTip}</p>
			<button class="secondary" data-action="export">Gem kopi som fil</button>
			<label class="button secondary">Hent kopi fra fil
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
		return '<p class="hint">Ingen udgifter.</p>';
	}
	return tableHtml(["Dato", "Kategori", "Note", "Beløb"], spending.map((item) => ({
		cells: [dateText(item.date).slice(0, 6), { html: esc(item.category), cls: "wrap" }, { html: esc(item.note), cls: "wrap" }, formatKr(item.amount)],
	})), "purchases");
}

function monthReportHtml(report) {
	const s = report.summary;
	const nameRows = (list) => list.map((row) => ({ cells: [esc(row.name || "(uden navn)"), formatKr(row.amount)] }));

	let html = `<h2>Budget: ${esc(report.label)}</h2>`;
	html += "<h3>Oversigt</h3>" + tableHtml([], [
		{ cells: ["Indkomst", formatKr(s.income)] },
		{ cells: ["Faste udgifter", formatKr(s.fixed)] },
		{ cells: ["Opsparing", formatKr(s.savings)] },
		{ cells: ["Til rådighed", formatKr(s.available)], total: true },
		{ cells: ["Brugt", formatKr(s.spent)] },
		{ cells: ["Tilbage", amountCell(s.left)], total: true },
	]);
	html += "<h3>Indkomst</h3>" + tableHtml([], nameRows(report.income));
	html += "<h3>Faste udgifter</h3>" + tableHtml([], nameRows(report.fixed));

	const categoryRows = report.categories.map((c) => ({
		cells: [esc(c.name || "(uden navn)"), formatKr(c.limit), formatKr(c.spent), amountCell(c.left)],
	}));
	if (report.otherSpent > 0) {
		categoryRows.push({ cells: ["Uden kategori", "", formatKr(report.otherSpent), ""] });
	}
	html += "<h3>Kategorier</h3>" + tableHtml(["Kategori", "Grænse", "Brugt", "Tilbage"], categoryRows);
	html += "<h3>Udgifter</h3>" + purchasesHtml(report.spending);
	return html;
}

function yearReportHtml(report) {
	if (report.rows.length === 0) {
		return `<h2>Budget: ${esc(report.year)}</h2><p class="hint">Der er ingen gemte måneder i ${esc(report.year)}.</p>`;
	}
	const t = report.totals;

	const monthRows = report.rows.map((row) => ({
		cells: [esc(shortMonthLabel(row.key)), formatKr(row.income), formatKr(row.fixed), formatKr(row.savings), formatKr(row.available), formatKr(row.spent), amountCell(row.left)],
	}));
	monthRows.push({
		cells: ["I alt", formatKr(t.income), formatKr(t.fixed), formatKr(t.savings), formatKr(t.available), formatKr(t.spent), amountCell(t.left)],
		total: true,
	});

	const categoryRows = report.categories.map((c) => ({ cells: [esc(c.name), formatKr(c.total)] }));

	let html = `<h2>Budget: ${esc(report.year)}</h2>`;
	html += "<h3>Måned for måned</h3>" + tableHtml(["Måned", "Indkomst", "Faste", "Opsparing", "Til rådighed", "Brugt", "Tilbage"], monthRows);
	html += '<p class="hint no-print">Stryg tabellen til siden for at se alle kolonner.</p>';
	html += "<h3>Brugt pr. kategori</h3>" + tableHtml(["Kategori", "I alt"], categoryRows);
	html += "<h3>Udgifter</h3>" + purchasesHtml(report.spending);
	return html;
}

function reportHtml() {
	let body = "";
	if (reportScope.type === "month") {
		body = monthReportHtml(monthReport(getMonth(reportScope.key), reportScope.key));
	} else {
		body = yearReportHtml(yearReport(data.months, reportScope.key));
	}
	return `
		<section class="card no-print">
			<div class="buttons">
				<button class="primary" data-action="download-csv">Hent til Excel (.csv)</button>
				<button class="secondary" data-action="print-report">Udskriv eller gem som PDF</button>
				<button class="secondary" data-action="close-report">‹ Tilbage til Indstillinger</button>
			</div>
		</section>
		<section class="card report">${body}</section>`;
}

function openReport() {
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
			viewMonth = shiftMonth(viewMonth, -1);
			render();
			window.scrollTo(0, 0);
			break;
		case "next-month":
			viewMonth = shiftMonth(viewMonth, 1);
			render();
			window.scrollTo(0, 0);
			break;
		case "this-month":
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
			shareNote = done === 0 ? "Alle måneder har allerede kategorierne." : "Gjort: kategorierne er nu også i " + monthsText(done) + ".";
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
	if (event.target.name === "note" && event.target.form && event.target.form.id === "add-form") {
		pickCategoryFromNote(event.target);
	}
});

// "change" fires when you leave a box (or press Enter) after editing it.
document.addEventListener("change", (event) => {
	const input = event.target;
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
			setWarning("Kunne ikke opdatere barnets side: " + accountProblemText(error));
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
	const link = kidLink(location.origin + location.pathname, accountName, token);
	return USE_FIREBASE_EMULATOR ? link + "&emulator" : link;
}

// What goes in the Børn box under the kids: a button to make a kid's link, or the link itself.
function kidAccessHtml(people) {
	if (people.length === 0) {
		return "";
	}
	if (accountName === null) {
		return accountsAvailable() ? '<p class="hint">Vil dine børn selv skrive, hvad de bruger? Log ind på en konto øverst først.</p>' : "";
	}
	let html = "";
	for (const person of people) {
		const name = esc(person.person);
		const token = kidTokenOf(person.person);
		if (token === null) {
			html += `<div class="kid-access"><button type="button" class="secondary" data-action="make-kid-link" data-person="${name}">Giv ${name} sit eget link</button></div>`;
			continue;
		}
		html += `
			<div class="kid-access">
				<label>${name}s link
					<input readonly value="${esc(kidLinkUrl(token))}" data-kid-token="${esc(token)}" aria-label="${name}s link">
				</label>
				<div class="pot-buttons">
					<button type="button" class="primary" data-action="copy-kid-link" data-token="${esc(token)}">Kopiér link</button>
					<button type="button" class="secondary" data-action="remove-kid-link" data-token="${esc(token)}">Fjern linket</button>
				</div>
			</div>`;
	}
	return html + `
		<p id="kid-link-message" class="message" role="status">${esc(kidLinkNote)}</p>
		<details class="explain">
			<summary>Hvad kan barnet med linket?</summary>
			<p class="hint">Barnet åbner linket og kan se, hvad det har, og skrive, hvad det bruger. Intet andet. Send linket kun til barnet: den, der har linket, kan skrive. Du kan altid slette en post eller fjerne linket. Åbner du selv linket på din egen telefon, så tryk bagefter "Ikke dig? Åbn budgettet".</p>
		</details>`;
}

async function makeKidLink(person) {
	const bytes = new Uint8Array(KID_TOKEN_LENGTH);
	crypto.getRandomValues(bytes);
	const token = makeKidToken(bytes);
	const side = parentSideOf(data.months, person);
	kidPublished[token] = side;
	try {
		kidLinkNote = "Linket er lavet. Tryk Kopiér, og send det til " + person + ".";
		await saveKidPage(accountName, token, person, side);
		setMessage("kid-link-message", kidLinkNote, false);
	} catch (error) {
		console.error(error);
		kidLinkNote = "";
		delete kidPublished[token];
		setWarning("Kunne ikke lave linket: " + accountProblemText(error));
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
		setMessage("kid-link-message", "Hold fingeren på linket og vælg Kopiér.", false);
	};
	if (navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(url).then(
			() => setMessage("kid-link-message", "Linket er kopieret. Send det til barnet.", false),
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
	if (!confirm("Fjern " + page.person + "s link? Så virker det ikke mere. Det, " + page.person + " har skrevet, beholder du.")) {
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
		setWarning("Kunne ikke fjerne linket: " + accountProblemText(error));
	}
}

// One entry the kid wrote (a mistake) is taken away.
async function deleteKidsEntry(token, entryId) {
	if (!confirm("Slet den post?")) {
		return;
	}
	try {
		await deleteKidEntry(accountName, token, entryId);
	} catch (error) {
		console.error(error);
		setWarning("Kunne ikke slette: " + accountProblemText(error));
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
		const text = entry.note !== "" ? entry.note : (entry.amount < 0 ? "Brugte" : "Fik");
		// An entry the kid wrote on their own page says so, and is deleted online, not from a month.
		const own = entry.kidToken ? " · selv" : "";
		const remove = entry.kidToken
			? `data-action="delete-kid-entry" data-id="${esc(entry.id)}" data-token="${esc(entry.kidToken)}"`
			: `data-action="delete-pot" data-id="${esc(entry.id)}" data-month="${esc(entry.monthKey)}"`;
		history += `
			<li>
				<div class="what">${esc(text)}<small>${esc(dateText(entry.date).slice(0, 6) + own)}</small></div>
				<span class="money ${entry.amount < 0 ? "bad-text" : ""}">${formatKr(entry.amount)}</span>
				<button class="icon" ${remove} aria-label="Slet">✕</button>
			</li>`;
	}

	return `
		<section class="card pot">
			<div class="label">${name} har</div>
			<div class="big-number ${person.balance < 0 ? "bad" : ""}">${formatKr(person.balance)}</div>
			<p class="message" role="status">${esc(message)}</p>
			<div class="pot-form" data-person="${name}">
				<label>Beløb i kroner
					<input name="amount" inputmode="decimal" placeholder="fx 300" autocomplete="off">
				</label>
				<label>Hvad? (hvis du vil)
					<input name="note" maxlength="${MAX_NOTE_LENGTH}" autocomplete="off">
				</label>
				<div class="pot-buttons">
					<button type="button" class="primary" data-action="pot-used">${name} brugte</button>
					<button type="button" class="secondary" data-action="pot-got">${name} fik</button>
				</div>
				<p class="message pot-error" role="status"></p>
			</div>
			<details class="explain">
				<summary>Historik</summary>
				<ul class="list">${history}</ul>
				<button type="button" class="link" data-action="delete-person" data-person="${name}">Fjern ${name}</button>
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
		problem.textContent = "Skriv et beløb, fx 300.";
		problem.classList.add("bad");
		return;
	}
	if (getMonth(viewMonth).pots.length >= MOST_POT_ENTRIES_PER_MONTH) {
		problem.textContent = "For mange poster i denne måned.";
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
	const savingsText = money.savings ? " Opsparingen er nu " + formatKr(money.savingsNow) : "";
	potMessage = {
		person: now.person,
		text: (sign < 0
			? person + " brugte " + formatKr(ore) + " Nu har " + person + " " + left + " tilbage."
			: person + " fik " + formatKr(ore) + " Nu har " + person + " " + left) + savingsText,
	};
	render();
}

function deleteOthersEntry(id, monthKey) {
	if (!confirm("Slet den post?")) {
		return;
	}
	changeMonth((month) => {
		month.pots = month.pots.filter((entry) => entry.id !== id);
	}, monthKey);
	render();
}

// Takes a kid away with every entry they have, in every month. Asks first: it can't be undone.
function deletePerson(person) {
	if (!confirm("Fjern " + person + " og alle posterne? Det kan ikke fortrydes.")) {
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
			setWarning("Kunne ikke fjerne linket: " + accountProblemText(error));
		});
	}
	render();
}

// The "Børn" box on Indstillinger: a kid's name, and what they have now. Once a kid is added, their card
// shows up on Overblik.
function addPersonHtml() {
	const people = potBalances(monthsForMoney());
	const form = `
		<form id="person-form" autocomplete="off">
			<label>Barnets navn
				<input name="person" maxlength="${MAX_NAME_LENGTH}" placeholder="fx Nathan" required>
			</label>
			<label>Hvor mange penge har barnet nu?
				<input name="amount" inputmode="decimal" placeholder="0">
			</label>
			<button type="submit" class="secondary">Tilføj barn</button>
			<p id="person-message" class="message" role="status"></p>
		</form>`;
	return `
		<section class="card">
			<h2>Børn</h2>
			<p class="hint">Børnenes penge i din bunke.</p>
			${kidAccessHtml(people)}
			${people.length > 0 ? `<details class="explain"><summary>+ Tilføj et barn mere</summary>${form}</details>` : form}
		</section>`;
}

function addPerson(form) {
	const person = form.elements.person.value.trim().slice(0, MAX_NAME_LENGTH);
	const ore = parseAmount(form.elements.amount.value);
	if (person === "") {
		setMessage("person-message", "Skriv barnets navn.", true);
		return;
	}
	if (ore === null) {
		setMessage("person-message", "Skriv et beløb, fx 5000.", true);
		return;
	}
	if (potBalances(monthsForMoney()).some((other) => other.person.toLowerCase() === person.toLowerCase())) {
		setMessage("person-message", person + " findes allerede.", true);
		return;
	}

	const today = dateKeyOf(new Date());
	const date = today.slice(0, 7) === viewMonth ? today : viewMonth + "-01";
	changeMonth((month) => {
		// "start": this money was already in the pile, so it never moves the savings number.
		month.pots.push({ id: newId(), date: date, person: person, amount: ore, note: "Start", start: true });
	});
	render();
	setMessage("person-message", person + " er tilføjet. Se under Overblik.", false);
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
		setMessage("add-message", "Skriv et beløb større end 0, fx 49,95.", true);
		form.elements.amount.focus();
		return;
	}

	const date = form.elements.date.value;
	if (date.slice(0, 7) !== viewMonth) {
		setMessage("add-message", "Datoen skal ligge i " + monthLabel(viewMonth).toLowerCase() + ".", true);
		return;
	}

	if (getMonth(viewMonth).spending.length >= MOST_SPENDING_PER_MONTH) {
		setMessage("add-message", "Der er for mange udgifter i denne måned (" + MOST_SPENDING_PER_MONTH + "). Slet nogle gamle.", true);
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
	setMessage("add-message", "Tilføjet: " + formatKr(amount) + " til " + where + ".", false);
}

function deleteSpending(id) {
	const item = findRow(getMonth(viewMonth).spending, id);
	if (!item) {
		return;
	}
	const what = item.note !== "" ? item.note : categoryName(getMonth(viewMonth), item.categoryId);
	if (!confirm("Slet " + formatKr(item.amount) + " (" + what + ")?")) {
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
		window.alert("Der kan højst være " + section.mostRows + " rækker her.");
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
			<p class="hint">${count === 1 ? "En anden måned mangler" : count + " andre måneder mangler"} nogle af kategorierne her.</p>
			<button type="button" class="secondary" data-action="share-categories">Brug disse kategorier i alle måneder</button>`;
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
		let question = 'Slet "' + (row.name || "uden navn") + '"?';
		if (section.key === "categories") {
			question += ' Udgifter, der allerede er skrevet ind her, bliver stående som "Uden kategori".';
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
	downloadText("budget-kopi-" + dateKeyOf(new Date()) + ".json", JSON.stringify(data, null, 2), "application/json");
	setMessage("backup-message", "Kopien er gemt som en fil.", false);
}

async function importBackup(input) {
	const file = input.files[0];
	input.value = "";   // so choosing the same file again still counts as a change
	if (!file) {
		return;
	}

	try {
		const cleaned = cleanData(JSON.parse(await file.text()));
		const monthCount = Object.keys(cleaned.months).length;
		if (monthCount === 0) {
			setMessage("backup-message", "Filen ligner ikke en kopi fra denne side.", true);
			return;
		}
		if (accountName !== null) {
			// On an account, months are sent one by one; months not in the file stay as they are.
			if (!confirm("Lægge kopiens " + monthsText(monthCount) + " ind på kontoen? Måneder med samme navn bliver erstattet.")) {
				return;
			}
			for (const key of Object.keys(cleaned.months)) {
				data.months[key] = cleaned.months[key];
				saveMonth(key, cleaned.months[key]);
			}
		} else {
			if (!confirm("Erstat alt, du har nu, med kopien (" + monthsText(monthCount) + ")?")) {
				return;
			}
			data = cleaned;
			saveData();
		}
		render();
		setMessage("backup-message", "Kopien er hentet.", false);
	} catch (error) {
		setMessage("backup-message", "Kunne ikke læse filen.", true);
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
		setMessage("account-message", "Kontoen er ved at starte. Prøv igen om et øjeblik.", true);
		return null;
	}
	const username = cleanUsername(form.elements.username.value);
	const password = form.elements.password.value;
	if (!isValidUsername(username)) {
		setMessage("account-message", "Brugernavnet skal være 3–20 tegn: a–z, tal, - og _ (ingen æ, ø, å).", true);
		return null;
	}
	if (password === "") {
		setMessage("account-message", "Skriv en adgangskode.", true);
		return null;
	}
	return { username: username, password: password };
}

async function signInFromForm(form) {
	const login = readAccountForm(form);
	if (!login) {
		return;
	}
	setMessage("account-message", "Logger ind …", false);
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
	setMessage("account-message", "Tjekker adgangskoden …", false);
	try {
		await loadPasswordChecker();
	} catch (error) {
		setMessage("account-message", "Kunne ikke hente adgangskode-tjekket. Tjek internettet.", true);
		return;
	}
	const check = checkNewPassword(login.password, login.username);
	if (!check.ok) {
		setMessage("account-message", check.message, true);
		return;
	}

	setMessage("account-message", "Opretter kontoen …", false);
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
		data = loadData();   // back to this device's own copy
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
	const question = "Du har tal gemt på denne enhed fra før (" + monthsText(deviceKeys.length) + "). "
		+ "Skal de lægges ind på kontoen? En måned, kontoen allerede har, beholder kontoens plan og får lagt de udgifter til, som kun står på denne enhed.";
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

document.getElementById("app-version").textContent = "Version " + APP_VERSION;

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
			setWarning("Kunne ikke starte kontoen. Tjek internettet.");
			render();
		});
	}
}
