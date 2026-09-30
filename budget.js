// budget.js - the "brain" of the budget app.
//
// Nothing in here touches the screen. It only does maths, reads typed amounts
// and builds text, so it can be tested on its own (see test.js).
//
// MONEY RULE: every amount is stored as a whole number of øre (1 kr = 100 øre).
// Computers add decimals slightly wrong (0.1 + 0.2 gives 0.30000000000000004),
// but whole numbers are always exact. Amounts only become "kr" when shown.

// The first time the app opens, these rows are there so you are not staring at
// an empty page. Every amount starts at 0 - you fill in your own.
const STARTER_INCOME = ["Løn"];
const STARTER_FIXED = ["Husleje", "El og varme", "Telefon og internet", "Forsikring", "Abonnementer"];
const STARTER_CATEGORIES = [
	"Mad og dagligvarer",
	"Transport",
	"Fritid og fornøjelser",
	"Tøj og personlig pleje",
	"Sundhed",
	"Andet",
];

// 10 million kr, in øre. A bigger number is almost certainly a typing slip.
const MAX_AMOUNT = 1000000000;
const MAX_NAME_LENGTH = 60;
const MAX_NOTE_LENGTH = 100;

// Bars turn amber when this share of a category's limit is used.
const CLOSE_TO_LIMIT = 0.8;

// How many rows one month may hold. firestore.rules says exactly the same numbers,
// so a month that is too big is stopped here with a friendly message instead of
// being refused by the online storage.
const MOST_INCOME_ROWS = 50;
const MOST_FIXED_ROWS = 100;
const MOST_CATEGORIES = 50;
const MOST_SPENDING_PER_MONTH = 2000;


// --- Amounts ----------------------------------------------------------------

// Turns what the user typed ("49,95", "1.250", "12500 kr") into øre.
// Returns 0 for an empty box and null when the text can't be understood.
function parseAmount(text) {
	let t = String(text).trim().replace(/\s/g, "").replace(/kr\.?$/i, "");
	if (t === "") {
		return 0;
	}

	if (t.includes(",")) {
		// Danish style: dots are thousand separators, the comma is the decimal point.
		t = t.replace(/\./g, "").replace(",", ".");
	} else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
		// "12.500" - a dot followed by exactly three digits is a thousand separator.
		t = t.replace(/\./g, "");
	}

	if (!/^\d+(\.\d{1,2})?$/.test(t)) {
		return null;
	}
	const ore = Math.round(parseFloat(t) * 100);
	if (ore > MAX_AMOUNT) {
		return null;
	}
	return ore;
}

// Two number formats: no decimals for whole kroner, two decimals otherwise.
const WHOLE_KR = new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 });
const FULL_KR = new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK" });

// 1250000 -> "12.500 kr."   4995 -> "49,95 kr."
function formatKr(ore) {
	if (ore % 100 === 0) {
		return WHOLE_KR.format(ore / 100);
	}
	return FULL_KR.format(ore / 100);
}

// What goes back into an input box when editing: 4995 -> "49,95", 0 -> "".
function amountToInput(ore) {
	if (ore === 0) {
		return "";
	}
	if (ore % 100 === 0) {
		return String(ore / 100);
	}
	return (ore / 100).toFixed(2).replace(".", ",");
}

function sumOf(list, field) {
	let total = 0;
	for (const item of list) {
		total += item[field];
	}
	return total;
}


// --- Months and dates -------------------------------------------------------

// Months are named "2026-09". That text also sorts in date order, which the
// month-copying code below relies on.
function monthKeyOf(date) {
	const month = String(date.getMonth() + 1).padStart(2, "0");
	return date.getFullYear() + "-" + month;
}

function dateKeyOf(date) {
	return monthKeyOf(date) + "-" + String(date.getDate()).padStart(2, "0");
}

function splitMonthKey(key) {
	const parts = key.split("-").map(Number);
	return { year: parts[0], month: parts[1] };
}

// shiftMonth("2026-12", 1) -> "2027-01". Date rolls over the year for us.
function shiftMonth(key, steps) {
	const { year, month } = splitMonthKey(key);
	return monthKeyOf(new Date(year, month - 1 + steps, 1));
}

function monthLabel(key) {
	const { year, month } = splitMonthKey(key);
	const text = new Intl.DateTimeFormat("da-DK", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
	return text.charAt(0).toUpperCase() + text.slice(1);
}

// "2026-09-30" -> "onsdag 30. september"
function dayLabel(dateKey) {
	const parts = dateKey.split("-").map(Number);
	const date = new Date(parts[0], parts[1] - 1, parts[2]);
	return new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long" }).format(date);
}

function lastDayOfMonth(key) {
	const { year, month } = splitMonthKey(key);
	// Day 0 of the NEXT month is the last day of this one.
	return new Date(year, month, 0).getDate();
}

// How many days are left, today included. Only meaningful for the current month,
// so any other month gives null.
function daysLeftInMonth(key, today) {
	if (monthKeyOf(today) !== key) {
		return null;
	}
	return lastDayOfMonth(key) - today.getDate() + 1;
}


// --- Building a month -------------------------------------------------------

// A random text that is very unlikely to appear twice. Used to tell rows apart.
function newId() {
	return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// These ids are fixed on purpose: the starter month is rebuilt every time it is
// shown (until something is changed and it gets saved), and the ids must match
// between drawing a row and reacting to a tap on it.
function starterRows(names, amountField) {
	return names.map((name, index) => {
		const row = { id: "starter-" + amountField + "-" + index, name: name };
		row[amountField] = 0;
		return row;
	});
}

function starterMonth() {
	return {
		income: starterRows(STARTER_INCOME, "amount"),
		fixed: starterRows(STARTER_FIXED, "amount"),
		savings: 0,
		categories: starterRows(STARTER_CATEGORIES, "limit"),
		spending: [],
	};
}

// A new month starts with last month's plan but no spending.
function copyPlanOf(month) {
	const copy = JSON.parse(JSON.stringify(month));
	copy.spending = [];
	return copy;
}

// Which saved month should a new month copy its plan from? The latest one
// before it, or if there is none, the earliest one after it.
function nearestMonthWithData(months, key) {
	let before = null;
	let after = null;
	for (const other of Object.keys(months).sort()) {
		if (other < key) {
			before = other;
		} else if (other > key && after === null) {
			after = other;
		}
	}
	return before || after;
}

// Newest date first. Within one day, the one added last comes first.
function spendingNewestFirst(list) {
	return [...list].reverse().sort((a, b) => {
		if (a.date < b.date) {
			return 1;
		}
		if (a.date > b.date) {
			return -1;
		}
		return 0;
	});
}


// --- The numbers shown on screen --------------------------------------------

function summarize(month) {
	const income = sumOf(month.income, "amount");
	const fixed = sumOf(month.fixed, "amount");
	const savings = month.savings;
	const limits = sumOf(month.categories, "limit");
	const spent = sumOf(month.spending, "amount");

	// What is left after the bills and the savings - this is the money for daily life.
	const available = income - fixed - savings;

	const categories = month.categories.map((category) => {
		let spentHere = 0;
		for (const item of month.spending) {
			if (item.categoryId === category.id) {
				spentHere += item.amount;
			}
		}
		return { id: category.id, name: category.name, limit: category.limit, spent: spentHere, left: category.limit - spentHere };
	});

	// Spending with no category, or whose category was deleted later.
	const knownIds = new Set(month.categories.map((category) => category.id));
	let otherSpent = 0;
	for (const item of month.spending) {
		if (!knownIds.has(item.categoryId)) {
			otherSpent += item.amount;
		}
	}

	return {
		income: income,
		fixed: fixed,
		savings: savings,
		available: available,
		limits: limits,
		unassigned: available - limits,
		spent: spent,
		left: available - spent,
		categories: categories,
		otherSpent: otherSpent,
	};
}

// How full a category bar is, from 0 to 1 (never more - the bar can't overflow).
function barShare(spent, limit) {
	if (limit <= 0) {
		return spent > 0 ? 1 : 0;
	}
	return Math.min(spent / limit, 1);
}

// "nolimit", "ok", "close" or "over" - the screen picks a colour from this.
function barLevel(spent, limit) {
	if (limit <= 0) {
		return "nolimit";
	}
	if (spent > limit) {
		return "over";
	}
	if (spent >= limit * CLOSE_TO_LIMIT) {
		return "close";
	}
	return "ok";
}


// --- Cleaning saved data ----------------------------------------------------
//
// Saved data and backup files are read back with these, so that a damaged or
// hand-edited file can never crash the app or smuggle in something odd.

function cleanAmount(value) {
	const n = Math.round(Number(value));
	if (!Number.isFinite(n) || n < 0) {
		return 0;
	}
	return Math.min(n, MAX_AMOUNT);
}

function cleanText(value, maxLength) {
	if (value === undefined || value === null) {
		return "";
	}
	return String(value).slice(0, maxLength);
}

function cleanId(value) {
	const text = cleanText(value, 40);
	return text === "" ? newId() : text;
}

function cleanRows(list, amountField, mostRows) {
	if (!Array.isArray(list)) {
		return [];
	}
	return list.filter((row) => row && typeof row === "object").slice(0, mostRows).map((row) => {
		const clean = { id: cleanId(row.id), name: cleanText(row.name, MAX_NAME_LENGTH) };
		clean[amountField] = cleanAmount(row[amountField]);
		return clean;
	});
}

function cleanSpending(list) {
	if (!Array.isArray(list)) {
		return [];
	}
	return list
		.filter((row) => row && typeof row === "object" && /^\d{4}-\d{2}-\d{2}$/.test(row.date))
		.slice(0, MOST_SPENDING_PER_MONTH)
		.map((row) => ({
			id: cleanId(row.id),
			date: row.date,
			categoryId: cleanText(row.categoryId, 40),
			amount: cleanAmount(row.amount),
			note: cleanText(row.note, MAX_NOTE_LENGTH),
		}));
}

function cleanMonth(raw) {
	const source = raw && typeof raw === "object" ? raw : {};
	return {
		income: cleanRows(source.income, "amount", MOST_INCOME_ROWS),
		fixed: cleanRows(source.fixed, "amount", MOST_FIXED_ROWS),
		savings: cleanAmount(source.savings),
		categories: cleanRows(source.categories, "limit", MOST_CATEGORIES),
		spending: cleanSpending(source.spending),
	};
}

// Returns { months: {...} } with only valid month names and cleaned contents.
function cleanData(raw) {
	const months = {};
	if (raw && typeof raw === "object" && raw.months && typeof raw.months === "object") {
		for (const key of Object.keys(raw.months)) {
			if (/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) {
				months[key] = cleanMonth(raw.months[key]);
			}
		}
	}
	return { months: months };
}

// Are two sets of saved data the same? Both are cleaned first, so the order of a
// row's fields and extra fields (like the online storage's timestamp) don't count.
function sameData(a, b) {
	return JSON.stringify(cleanData(a)) === JSON.stringify(cleanData(b));
}


// The browser ignores this part. It lets test.js (run by Node) borrow the
// functions above.
if (typeof module !== "undefined") {
	module.exports = {
		parseAmount, formatKr, amountToInput, sumOf,
		monthKeyOf, dateKeyOf, shiftMonth, monthLabel, dayLabel, lastDayOfMonth, daysLeftInMonth,
		newId, starterMonth, copyPlanOf, nearestMonthWithData, spendingNewestFirst,
		summarize, barShare, barLevel,
		cleanAmount, cleanMonth, cleanData, sameData,
		MOST_INCOME_ROWS, MOST_FIXED_ROWS, MOST_CATEGORIES, MOST_SPENDING_PER_MONTH,
	};
}
