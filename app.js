// app.js - the screens.
//
// It draws the page, reacts to taps and saves everything on this device.
// The maths and text formatting live in budget.js (loaded before this file).
//
// How drawing works: each screen is a function that builds a piece of HTML as
// text and puts it into <main id="view">. After every change we simply draw the
// whole screen again from the saved numbers - simple, and never out of date.

const STORAGE_KEY = "budget.v1";
// Remembers which account was signed in, so that at the next start the page waits for that
// account's numbers instead of showing (and letting you edit) this device's own copy.
const SIGNED_IN_HINT_KEY = "budget.signedInAs";

// The three lists on the Plan screen are drawn by the same code. Only the texts
// and the name of the amount field differ ("limit" for categories).
const INCOME_SECTION = {
	key: "income",
	title: "Indkomst",
	hint: "Det du får ind hver måned, efter skat: løn, SU, børnepenge ...",
	amountField: "amount",
	addLabel: "+ Tilføj indkomst",
	mostRows: MOST_INCOME_ROWS,
};
const FIXED_SECTION = {
	key: "fixed",
	title: "Faste udgifter",
	hint: "Det der bliver trukket hver måned, uanset hvad: husleje, regninger, abonnementer ...",
	amountField: "amount",
	addLabel: "+ Tilføj fast udgift",
	mostRows: MOST_FIXED_ROWS,
};
const CATEGORY_SECTION = {
	key: "categories",
	title: "Penge til hverdagen",
	hint: "Hvor meget vil du højst bruge på hver slags udgift i denne måned?",
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

let data = accountName === null ? loadData() : { months: {} };   // { months: { "2026-09": {...} } }
let viewMonth = monthKeyOf(new Date());       // the month on screen
let activeTab = "overview";                   // "overview", "expenses", "future", "plan" or "report"
let reportScope = null;                       // what the report shows: { type: "month" | "year", key }
let lastCategoryId = "";                      // so the next purchase starts on the same category


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
function changeMonth(change) {
	const month = getMonth(viewMonth);
	change(month);
	data.months[viewMonth] = month;
	saveMonth(viewMonth, month);
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
	} else if (activeTab === "report" && reportScope !== null) {
		html = reportHtml();
	} else {
		html = planHtml(month);
	}
	document.getElementById("view").innerHTML = html;
	showSyncStatus();

	// The report is opened from Plan and has no tab of its own, so Plan stays lit.
	const litTab = activeTab === "report" ? "plan" : activeTab;
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
	const s = summarize(month);
	let html = "";
	if (s.income === 0 && month.spending.length === 0) {
		html += welcomeHtml();
	}
	html += leftCardHtml(s);
	html += addFormHtml(month);
	html += categoryBarsHtml(s);
	return html;
}

function welcomeHtml() {
	const accountTip = accountsAvailable() && accountName === null
		? '<p class="hint" style="margin-top:10px">Vil du have dine tal på alle dine enheder? Lav en konto øverst under Plan.</p>'
		: "";
	return `
		<section class="card">
			<h2>Velkommen</h2>
			<p>Sådan kommer du i gang:</p>
			<ol>
				<li>Gå til <b>Plan</b> og skriv din indkomst og dine faste udgifter.</li>
				<li>Bestem, hvor meget du vil bruge på mad, fritid osv.</li>
				<li>Skriv hver udgift ind her under <b>Overblik</b>, når du har brugt penge.</li>
			</ol>
			${accountTip}
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
			<p class="hint" style="margin-top:8px">Til rådighed = indkomst minus faste udgifter og opsparing.</p>
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

// The form for writing in a purchase. The date box only allows days in the month
// on screen, so a purchase can never end up in the wrong month.
function addFormHtml(month) {
	const today = dateKeyOf(new Date());
	const firstDay = viewMonth + "-01";
	const lastDay = viewMonth + "-" + String(lastDayOfMonth(viewMonth)).padStart(2, "0");
	const dateValue = today.slice(0, 7) === viewMonth ? today : firstDay;

	return `
		<form id="add-form" class="card" autocomplete="off">
			<h2>Tilføj udgift</h2>
			<label>Beløb i kroner
				<input name="amount" inputmode="decimal" placeholder="fx 49,95" required>
			</label>
			<label>Kategori
				<select name="category">${categoryOptionsHtml(month)}</select>
			</label>
			<label>Note (hvis du vil)
				<input name="note" maxlength="${MAX_NOTE_LENGTH}" placeholder="fx Netto">
			</label>
			<label>Dato
				<input type="date" name="date" value="${dateValue}" min="${firstDay}" max="${lastDay}" required>
			</label>
			<button type="submit" class="primary">Tilføj</button>
			<p id="add-message" class="message" role="status"></p>
		</form>`;
}

function categoryBarsHtml(s) {
	let html = '<section class="card"><h2>Dine kategorier</h2>';

	if (s.categories.length === 0 && s.otherSpent === 0) {
		html += '<p class="hint">Ingen kategorier endnu. Lav dem under Plan.</p>';
	}

	for (const category of s.categories) {
		html += categoryBarHtml(category);
	}

	if (s.otherSpent > 0) {
		html += `
			<div class="category">
				<div class="category-top"><span>Uden kategori</span><span class="amounts">${formatKr(s.otherSpent)}</span></div>
			</div>`;
	}
	return html + "</section>";
}

function categoryBarHtml(category) {
	const level = barLevel(category.spent, category.limit);
	const width = Math.round(barShare(category.spent, category.limit) * 100);

	let note = "";
	if (level === "nolimit") {
		note = category.spent > 0 ? "Ingen grænse sat. Sæt en under Plan." : "Ingen grænse sat.";
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
	const s = summarize(month);
	let html = `
		<section class="card">
			<div class="label">Brugt i alt i ${esc(monthLabel(viewMonth).toLowerCase())}</div>
			<div class="big-number">${formatKr(s.spent)}</div>
		</section>`;

	if (month.spending.length === 0) {
		return html + '<section class="card"><p class="hint">Ingen udgifter endnu. Skriv den første ind under Overblik.</p></section>';
	}

	html += '<section class="card">';
	let currentDay = "";
	for (const item of spendingNewestFirst(month.spending)) {
		// A new heading whenever the date changes.
		if (item.date !== currentDay) {
			if (currentDay !== "") {
				html += "</ul>";
			}
			html += `<h3>${esc(dayLabel(item.date))}</h3><ul class="list">`;
			currentDay = item.date;
		}
		const category = categoryName(month, item.categoryId);
		const title = item.note !== "" ? item.note : category;
		const small = item.note !== "" ? `<small>${esc(category)}</small>` : "";
		html += `
			<li>
				<div class="what">${esc(title)}${small}</div>
				<span class="money">${formatKr(item.amount)}</span>
				<button class="icon" data-action="delete-spending" data-id="${esc(item.id)}" aria-label="Slet udgiften">✕</button>
			</li>`;
	}
	return html + "</ul></section>";
}


// ---- Screen 3: Fremtid -----------------------------------------------------------
//
// "How much money will I have in a year?" It takes the plan of the month on screen and keeps it
// going for FORECAST_MONTHS months (the maths is forecast() in budget.js).

function futureHtml(month) {
	return `
		<section class="card">
			<h2>Penge ved starten af ${esc(monthLabel(viewMonth).toLowerCase())}</h2>
			<p class="hint">Hvor mange penge har du i alt, når måneden begynder? Lad feltet stå tomt, hvis du bare vil se, hvor meget du lægger til side.</p>
			<div class="single-row">
				<label for="balance-input">Penge i alt</label>
				<input id="balance-input" value="${amountToInput(month.startBalance)}" placeholder="0" inputmode="decimal" autocomplete="off">
			</div>
		</section>
		<div id="future-results">${futureResultsHtml(month)}</div>`;
}

// The results are redrawn on their own after the balance is changed (refreshFutureResults),
// so the box you just typed in is left alone.
function futureResultsHtml(month) {
	const s = summarize(month);
	if (s.income === 0) {
		return '<section class="card"><p>Skriv din indkomst og dine udgifter under <b>Plan</b> først, så kan jeg regne fremad.</p></section>';
	}

	const f = forecast(month, viewMonth, FORECAST_MONTHS);
	const tone = f.endTotal < 0 ? "bad" : "good";

	let rows = "";
	for (const row of f.rows) {
		rows += `
			<tr>
				<td>${esc(shortMonthLabel(row.key))}</td>
				<td class="${row.added < 0 ? "bad" : ""}">${formatKr(row.added)}</td>
				<td class="${row.total < 0 ? "bad" : ""}">${formatKr(row.total)}</td>
			</tr>`;
	}

	return `
		<section class="card">
			<div class="label">Om ${FORECAST_MONTHS} måneder har du</div>
			<div class="big-number ${tone}">${formatKr(f.endTotal)}</div>
			<p>ved udgangen af ${esc(monthLabel(f.lastKey).toLowerCase())}, hvis du bruger præcis dine grænser.</p>
			<div class="facts">
				<span>Lægges til hver måned <b>${formatKr(f.perMonth)}</b></span>
			</div>
			<div class="facts">
				<span>Kun opsparingen (${formatKr(f.carefulPerMonth)} om måneden): <b>${formatKr(f.carefulEndTotal)}</b></span>
			</div>
			<p class="hint" style="margin-top:8px">Det øverste tal regner med, at du bruger præcis det, du har sat af til hver kategori, og beholder resten. Det nederste regner med, at du bruger alt andet end opsparingen.</p>
		</section>
		<section class="card">
			<h2>Måned for måned</h2>
			<div class="table-scroll">
				<table>
					<thead><tr><th>Måned</th><th>Lægges til</th><th>Penge i alt</th></tr></thead>
					<tbody>
						<tr><td>Start</td><td></td><td>${formatKr(f.start)}</td></tr>${rows}
					</tbody>
				</table>
			</div>
			<p class="hint" style="margin-top:8px">Det her er et regnestykke, ikke en forudsigelse: det bruger planen for ${esc(monthLabel(viewMonth).toLowerCase())} ens hver måned. Ændrer du planen under Plan, ændrer tallene sig her.</p>
		</section>`;
}

function refreshFutureResults() {
	const box = document.getElementById("future-results");
	if (box) {
		box.innerHTML = futureResultsHtml(getMonth(viewMonth));
	}
}


// ---- Screen 4: Plan ------------------------------------------------------------

// The account box at the top of Plan. Hidden until accounts are set up (firebase-config.js).
function accountHtml() {
	if (!accountsAvailable()) {
		return "";
	}

	if (accountName !== null) {
		return `
			<section class="card">
				<h2>Konto</h2>
				<p>Logget ind som <b>${esc(accountName)}</b>. Dine tal er gemt online og er de samme på alle dine enheder.</p>
				<button class="secondary" data-action="sign-out">Log ud</button>
			</section>`;
	}

	return `
		<section class="card">
			<h2>Gem dine tal på en konto</h2>
			<p class="hint">Så er de de samme på din telefon og din computer, og de er ikke væk, hvis du mister telefonen.</p>
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
			<p class="hint">Brugernavn: a–z, tal, - og _ (3–20 tegn, ingen æ, ø, å). Adgangskode: mindst 10 tegn, fx tre ord og et tal.</p>
		</section>`;
}

function planHtml(month) {
	return accountHtml()
		+ `<section class="card" id="plan-summary">${planSummaryHtml(month)}</section>`
		+ planSectionHtml(INCOME_SECTION, month)
		+ planSectionHtml(FIXED_SECTION, month)
		+ savingsHtml(month)
		+ planSectionHtml(CATEGORY_SECTION, month)
		+ exportHtml()
		+ backupHtml();
}

// The "Eksport" box on Plan: pick a month or a year and open its report.
function exportHtml() {
	let options = `<option value="month:${viewMonth}">Denne måned: ${esc(monthLabel(viewMonth))}</option>`;
	for (const year of yearsWithData(data.months)) {
		options += `<option value="year:${year}">Hele året ${year}</option>`;
	}
	return `
		<section class="card">
			<h2>Eksport</h2>
			<p class="hint">Se en rapport over en måned eller et helt år. Den kan hentes til Excel, eller udskrives og gemmes som PDF.</p>
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
// (refreshPlanSummary), so the boxes you are typing in are left alone.
function planSummaryHtml(month) {
	const s = summarize(month);

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
		html += '<p class="hint" style="margin-top:8px">Du har givet hverdagen mere, end du har til rådighed.</p>';
	}
	html += '<p class="hint" style="margin-top:8px">Skriv beløb som 1250 eller 49,95. Alt bliver gemt med det samme. Ændringer gælder kun denne måned; en ny måned starter med en kopi af den forrige.</p>';
	return html;
}

function refreshPlanSummary() {
	const box = document.getElementById("plan-summary");
	if (box) {
		box.innerHTML = planSummaryHtml(getMonth(viewMonth));
	}
}

function planSectionHtml(section, month) {
	let html = `<section class="card"><h2>${section.title}</h2><p class="hint">${section.hint}</p>`;
	for (const row of month[section.key]) {
		html += rowHtml(section, row);
	}
	html += `<button class="secondary" data-action="add-row" data-section="${section.key}">${section.addLabel}</button>`;
	return html + "</section>";
}

function rowHtml(section, row) {
	return `
		<div class="row" data-section="${section.key}" data-id="${esc(row.id)}">
			<input data-field="name" value="${esc(row.name)}" placeholder="Navn" maxlength="${MAX_NAME_LENGTH}" aria-label="Navn" autocomplete="off">
			<input data-field="amount" value="${amountToInput(row[section.amountField])}" placeholder="0" inputmode="decimal" aria-label="Beløb i kroner" autocomplete="off">
			<button class="icon" data-action="delete-row" aria-label="Slet rækken">✕</button>
		</div>`;
}

function savingsHtml(month) {
	return `
		<section class="card">
			<h2>Opsparing</h2>
			<p class="hint">Hvor meget vil du lægge til side hver måned, før du bruger af resten?</p>
			<div class="single-row">
				<label for="savings-input">Opsparing pr. måned</label>
				<input id="savings-input" value="${amountToInput(month.savings)}" placeholder="0" inputmode="decimal" autocomplete="off">
			</div>
		</section>`;
}

function backupHtml() {
	return `
		<section class="card">
			<h2>Sikkerhedskopi</h2>
			<p class="hint">Dine tal bliver kun gemt i denne browser, på denne enhed. Gem en kopi, hvis du skifter telefon eller rydder browserdata. På iPhone: tryk Del og vælg "Føj til hjemmeskærm", så Safari ikke rydder dine tal, hvis du ikke åbner siden i en uge.</p>
			<button class="secondary" data-action="export">Gem kopi som fil</button>
			<label class="button secondary">Hent kopi fra fil
				<input type="file" id="import-file" accept="application/json,.json" hidden>
			</label>
			<p id="backup-message" class="message" role="status"></p>
		</section>`;
}


// ---- The report (opened from Plan -> Eksport) -------------------------------------
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
				<button class="secondary" data-action="close-report">‹ Tilbage til Plan</button>
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

// The spreadsheet, as a file. A byte-order mark (﻿) first tells Excel the text is UTF-8,
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
	downloadText(name, "﻿" + text, "text/csv;charset=utf-8");
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
			activeTab = "plan";
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
	}
});

// The "Gemmer … / Gemt" line also depends on whether the device is online.
window.addEventListener("online", showSyncStatus);
window.addEventListener("offline", showSyncStatus);

// "change" fires when you leave a box (or press Enter) after editing it.
document.addEventListener("change", (event) => {
	const input = event.target;
	if (input.closest(".row")) {
		editRow(input);
	} else if (input.id === "savings-input") {
		editSavings(input);
	} else if (input.id === "balance-input") {
		editBalance(input);
	} else if (input.id === "import-file") {
		importBackup(input);
	}
});


// ---- Adding and deleting spending ----------------------------------------------

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

// Called when a name or amount box in a Plan row is changed. We do NOT redraw the
// rows here: redrawing would throw away the box you are tabbing into next.
function editRow(input) {
	const rowElement = input.closest(".row");
	const section = SECTIONS[rowElement.dataset.section];
	const id = rowElement.dataset.id;

	if (input.dataset.field === "name") {
		const name = input.value.trim().slice(0, MAX_NAME_LENGTH);
		changeMonth((month) => {
			const row = findRow(month[section.key], id);
			if (row) {
				row.name = name;
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

// The "money I have now" box on Fremtid.
function editBalance(input) {
	const ore = parseAmount(input.value);
	if (ore === null) {
		input.classList.add("bad");
		return;
	}
	input.classList.remove("bad");
	changeMonth((month) => {
		month.startBalance = ore;
	});
	input.value = amountToInput(ore);
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
// Months the account already has are left alone. The device copy is put aside (not deleted),
// so nothing can be lost.
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
		+ "Skal de lægges ind på kontoen? Måneder, som kontoen allerede har, bliver ikke ændret.";
	if (!confirm(question)) {
		return;
	}

	for (const key of deviceKeys) {
		if (!data.months[key]) {
			data.months[key] = device.months[key];
			saveMonth(key, device.months[key]);
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
