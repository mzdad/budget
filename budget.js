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
// Entries in the kids' money (Børn) that one month may hold.
const MOST_POT_ENTRIES_PER_MONTH = 500;


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

// Like parseAmount, but a leading minus is allowed ("-500"): an account can be overdrawn.
// Returns 0 for an empty box and null when the text can't be understood.
function parseSignedAmount(text) {
	const t = String(text).trim();
	if (t.startsWith("-") || t.startsWith("−")) {
		const rest = t.slice(1).trim();
		const ore = rest === "" ? null : parseAmount(rest);
		return ore === null ? null : (ore === 0 ? 0 : -ore);
	}
	return parseAmount(t);
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

// "2026-09" -> "sep. 2026" (short, for tables)
function shortMonthLabel(key) {
	const { year, month } = splitMonthKey(key);
	return new Intl.DateTimeFormat("da-DK", { month: "short", year: "numeric" }).format(new Date(year, month - 1, 1));
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
		startBalance: 0,
		balances: {},
		pots: [],
	};
}

// A new month starts with last month's plan but no spending. The "money I have now" numbers
// are NOT carried over: they were true on a particular day, and would be stale a month later.
function copyPlanOf(month) {
	const copy = JSON.parse(JSON.stringify(month));
	copy.spending = [];
	copy.startBalance = 0;
	copy.balances = {};
	copy.pots = [];   // like purchases, these belong to the month they happened in
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

// Every month keeps its own list of categories (so an old month never changes by itself), but a
// category you make should exist in the other months too: you want to write in September's
// purchases under it after making it in October. Given some category names, this says which saved
// months lack them: { "2026-09": ["Tøj"], ... } (a month that has them all is left out). Capitals
// don't matter, and a month never gets more than MOST_CATEGORIES categories.
function missingCategoryNames(months, names) {
	const wanted = [];
	for (const name of names) {
		const clean = name.trim();
		if (clean !== "" && !wanted.some((other) => other.toLowerCase() === clean.toLowerCase())) {
			wanted.push(clean);
		}
	}
	const missing = {};
	for (const monthKey of Object.keys(months).sort()) {
		const have = new Set(months[monthKey].categories.map((category) => category.name.trim().toLowerCase()));
		const room = Math.max(0, MOST_CATEGORIES - months[monthKey].categories.length);
		const lacking = wanted.filter((name) => !have.has(name.toLowerCase())).slice(0, room);
		if (lacking.length > 0) {
			missing[monthKey] = lacking;
		}
	}
	return missing;
}

// Signing in on a device that already has numbers of its own, for a month the account has too:
// the account's plan stays as it is, and the purchases that exist only on the device are added.
// Every purchase has its own id, so one that is already in the account is never added twice.
//
// A device purchase points at a category of the DEVICE's plan. If the account has no category
// with that id, it is matched by name instead ("Mad og dagligvarer" -> the account's category of
// the same name), and failing that it becomes "Uden kategori". Returns { month, added }.
function mergeDeviceMonth(accountMonth, deviceMonth) {
	const known = new Set(accountMonth.spending.map((item) => item.id));
	const accountIds = new Set(accountMonth.categories.map((category) => category.id));

	const idByName = {};
	for (const category of accountMonth.categories) {
		const name = category.name.trim().toLowerCase();
		if (name !== "" && !idByName[name]) {
			idByName[name] = category.id;
		}
	}

	const newOnes = [];
	for (const item of deviceMonth.spending) {
		if (known.has(item.id)) {
			continue;
		}
		let categoryId = item.categoryId;
		if (!accountIds.has(categoryId)) {
			const own = deviceMonth.categories.find((category) => category.id === categoryId);
			const name = own ? own.name.trim().toLowerCase() : "";
			categoryId = name !== "" && idByName[name] ? idByName[name] : "";
		}
		newOnes.push({ id: item.id, date: item.date, categoryId: categoryId, amount: item.amount, note: item.note });
	}

	// A month holds at most MOST_SPENDING_PER_MONTH purchases (firestore.rules says the same).
	const room = Math.max(0, MOST_SPENDING_PER_MONTH - accountMonth.spending.length);
	const taken = newOnes.slice(0, room);

	// Entries in other people's money: added by id too, never twice.
	const knownPots = new Set((accountMonth.pots || []).map((entry) => entry.id));
	const newPots = (deviceMonth.pots || []).filter((entry) => !knownPots.has(entry.id));
	const potRoom = Math.max(0, MOST_POT_ENTRIES_PER_MONTH - (accountMonth.pots || []).length);
	const takenPots = newPots.slice(0, potRoom);

	// "Money now" numbers (Lønkonto, Opsparing): for each one the newer number wins.
	const balances = { ...(accountMonth.balances || {}) };
	let takenBalances = 0;
	for (const key of BALANCE_KEYS) {
		const own = deviceMonth.balances && deviceMonth.balances[key];
		if (own && (!balances[key] || own.at > balances[key].at)) {
			balances[key] = own;
			takenBalances += 1;
		}
	}

	const merged = JSON.parse(JSON.stringify(accountMonth));
	merged.spending = accountMonth.spending.concat(taken);
	merged.pots = (accountMonth.pots || []).concat(takenPots);
	merged.balances = balances;
	return { month: merged, added: taken.length + takenPots.length + takenBalances };
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


// The month's purchases split by category, for the Udgifter screen: [{ id, name, total, items }].
// The categories come in the order of the plan and only those with purchases are listed. Purchases
// with no category (or one that was deleted later) come last, as "Uden kategori". Inside each group
// the newest day is first, and on one day the one added last.
function spendingByCategory(month) {
	const groups = [];
	for (const category of month.categories) {
		const items = month.spending.filter((item) => item.categoryId === category.id);
		if (items.length > 0) {
			groups.push({ id: category.id, name: category.name || "(uden navn)", total: sumOf(items, "amount"), items: spendingNewestFirst(items) });
		}
	}
	const knownIds = new Set(month.categories.map((category) => category.id));
	const others = month.spending.filter((item) => !knownIds.has(item.categoryId));
	if (others.length > 0) {
		groups.push({ id: "", name: "Uden kategori", total: sumOf(others, "amount"), items: spendingNewestFirst(others) });
	}
	return groups;
}


// --- Rows that start or stop on a date -------------------------------------

// An income or fixed-bill row can have a first day (from) and a last day (to), both optional and
// both counted: "2026-10-12" as from means the 12th is the first day it counts.
// "Dagpenge to 2026-10-11" and "Løn from 2026-10-12" then hand over to each other on their own,
// in every month, from ONE plan.
//
// In a month where a row counts for only some of the days, its amount counts pro rata by days:
// 20 of October's 31 days = 20/31 of the amount. (Real pay arrives in its own way; if that is
// different, type the real amounts instead.)

// How many days of the month `key` the row counts.
function activeDaysIn(row, key) {
	const firstDay = key + "-01";
	const lastDay = key + "-" + String(lastDayOfMonth(key)).padStart(2, "0");
	const start = row.from && row.from > firstDay ? row.from : firstDay;
	const end = row.to && row.to < lastDay ? row.to : lastDay;
	if (start > end) {
		return 0;   // it starts after this month, ended before it, or from is after to
	}
	// Both days are inside the month here, so the day numbers can simply be subtracted.
	return Number(end.slice(8)) - Number(start.slice(8)) + 1;
}


// --- Bills that do not come every month --------------------------------------

// A fixed bill (or an income, like børnepenge) can come every 2nd, 3rd or 6th month, or once a year (row.every = 2, 3, 6 or 12;
// no `every` means every month). Its `from` date then says when the FIRST payment is, and only the
// month counts, not the day: a bill from 2026-03-15 every 3rd month is due in March, June,
// September and December. In a month it is due, the whole amount counts; in the others, nothing.
// (It is not spread out over the months: that is what the bank account will show.)
// A bill that comes less often than monthly always has a `from` date; the page and cleanRows both
// make sure of that.
const EVERY_CHOICES = [1, 2, 3, 6, 12];

function isPeriodic(row) {
	return row.every > 1 && Boolean(row.from);
}

// How many months from the month fromKey to the month toKey ("2026-03" -> "2026-06" is 3).
function monthsBetween(fromKey, toKey) {
	const a = splitMonthKey(fromKey);
	const b = splitMonthKey(toKey);
	return (b.year - a.year) * 12 + (b.month - a.month);
}

// Is a bill that comes every few months due in the month `key`?
function isDueIn(row, key) {
	const firstKey = row.from.slice(0, 7);
	if (key < firstKey) {
		return false;
	}
	if (row.to && key > row.to.slice(0, 7)) {
		return false;
	}
	return monthsBetween(firstKey, key) % row.every === 0;
}

// The first month from `key` on (key included) in which the bill is due, or null if it never is
// again (its last day has passed).
function nextDueKey(row, key) {
	for (let step = 0; step < 120; step++) {
		const candidate = shiftMonth(key, step);
		if (row.to && candidate > row.to.slice(0, 7)) {
			return null;
		}
		if (isDueIn(row, candidate)) {
			return candidate;
		}
	}
	return null;
}

// "hver 3. måned", "hvert år"
function everyText(every) {
	if (every === 12) {
		return "hvert år";
	}
	return "hver " + every + ". måned";
}


// A row's amount as it counts in the month `key` (the whole amount when the row has no dates or
// no month is given). Whole-number maths: the result is rounded to whole øre.
function amountIn(row, key) {
	if (!key) {
		return row.amount;
	}
	if (isPeriodic(row)) {
		return isDueIn(row, key) ? row.amount : 0;
	}
	if (!row.from && !row.to) {
		return row.amount;
	}
	const days = lastDayOfMonth(key);
	const active = activeDaysIn(row, key);
	if (active === days) {
		return row.amount;
	}
	return Math.round(row.amount * active / days);
}

function sumIn(rows, key) {
	let total = 0;
	for (const row of rows) {
		total += amountIn(row, key);
	}
	return total;
}

// "fra 12.10.2026", "til 11.10.2026", "fra 12.10.2026 til 30.11.2026", "hvert år fra 15.03.2026",
// or "" for a row that counts every month without dates.
function windowText(row) {
	const parts = [];
	if (isPeriodic(row)) {
		parts.push(everyText(row.every));
	}
	if (row.from) {
		parts.push("fra " + dateText(row.from));
	}
	if (row.to) {
		parts.push("til " + dateText(row.to));
	}
	return parts.join(" ");
}

// Income or fixed-bill rows as one month sees them, for the reports: each amount is what counts
// in that month, and the name says when the row applies, so the rows add up to the totals.
function rowsForReport(rows, key) {
	return rows.map((row) => {
		const when = windowText(row);
		return { id: row.id, name: when === "" ? row.name : row.name + " (" + when + ")", amount: amountIn(row, key) };
	});
}


// --- The numbers shown on screen --------------------------------------------

// Dates on income and fixed-bill rows (see the next section) only mean something for a particular
// month, so pass the month's key ("2026-10") as the second argument. Without it, every row counts
// in full, as if it had no dates.
function summarize(month, key) {
	const income = sumIn(month.income, key);
	const fixed = sumIn(month.fixed, key);
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


// --- Looking ahead ----------------------------------------------------------

// How many months the "Fremtid" screen looks ahead.
const FORECAST_MONTHS = 12;

// A simple what-if over the next `howMany` months, starting with `startTotal` (see moneyNow; if it
// is left out, the old single number the month holds, startBalance). It is arithmetic, not a
// prediction.
//
// Which plan does each month use? Its OWN, if you have set that month up (it is in `months`,
// which holds every saved month). If not, the plan of the month before it carries on. So a
// change of income - a new job from October, say - is followed once you have set up that month,
// and everything after it repeats the newest plan.
//
// Two versions, because the plan leaves a gap between "what you may spend" and "what you save":
// - added: you spend exactly your category limits. Everything else stays yours, so your money
//   grows by income - fixed bills - limits (your savings, plus whatever you have not handed out).
// - carefulAdded: only your planned savings grow and the rest is spent. Never more than
//   added, which matters when the limits add up to more than you have.
function forecast(month, key, howMany, months, startTotal) {
	const savedMonths = months || {};
	const start = startTotal === undefined ? month.startBalance : startTotal;

	const rows = [];
	let total = start;
	let carefulTotal = start;
	let plan = month;
	for (let i = 0; i < howMany; i++) {
		const rowKey = shiftMonth(key, i);
		const ownPlan = i > 0 ? savedMonths[rowKey] : null;
		if (ownPlan) {
			plan = ownPlan;
		}
		const s = summarize(plan, rowKey);
		const added = s.income - s.fixed - s.limits;
		const carefulAdded = Math.min(s.savings, added);
		total += added;
		carefulTotal += carefulAdded;
		rows.push({
			key: rowKey,
			added: added,
			carefulAdded: carefulAdded,
			total: total,
			carefulTotal: carefulTotal,
			ownPlan: i === 0 || Boolean(ownPlan),
		});
	}

	const first = rows[0];
	return {
		start: start,
		perMonth: first.added,
		carefulPerMonth: first.carefulAdded,
		// True when the plans of the months differ, so "the same every month" would be wrong.
		varies: rows.some((row) => row.added !== first.added),
		carefulVaries: rows.some((row) => row.carefulAdded !== first.carefulAdded),
		rows: rows,
		endTotal: total,
		carefulEndTotal: carefulTotal,
		lastKey: shiftMonth(key, howMany - 1),
	};
}


// --- Reports and export -----------------------------------------------------

// "2026-09-30" -> "30.09.2026"
function dateText(dateKey) {
	const parts = dateKey.split("-");
	return parts[2] + "." + parts[1] + "." + parts[0];
}

function byDateOldestFirst(list) {
	// Stable: purchases on the same day stay in the order they were added.
	return [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function categoryNameIn(month, categoryId) {
	const category = month.categories.find((other) => other.id === categoryId);
	return category ? (category.name || "(uden navn)") : "Uden kategori";
}

// Everything the report for one month shows. The screen, the printout and the spreadsheet
// are all made from this, so they always agree.
function monthReport(month, key) {
	const s = summarize(month, key);
	return {
		key: key,
		label: monthLabel(key),
		summary: s,
		income: rowsForReport(month.income, key),
		fixed: rowsForReport(month.fixed, key),
		categories: s.categories,
		otherSpent: s.otherSpent,
		spending: byDateOldestFirst(month.spending).map((item) => ({
			date: item.date,
			category: categoryNameIn(month, item.categoryId),
			note: item.note,
			amount: item.amount,
		})),
	};
}

// The report for a whole year: only months that have been saved (a month nobody touched has
// nothing to report).
function yearReport(months, year) {
	const keys = Object.keys(months).filter((key) => key.startsWith(year + "-")).sort();

	const rows = [];
	const totals = { income: 0, fixed: 0, savings: 0, available: 0, spent: 0, left: 0 };
	const categoryNames = [];
	const spentByCategory = {};   // category name -> { "2026-09": øre, ... }
	const spending = [];

	for (const key of keys) {
		const month = months[key];
		const s = summarize(month, key);
		rows.push({
			key: key, label: monthLabel(key),
			income: s.income, fixed: s.fixed, savings: s.savings,
			available: s.available, spent: s.spent, left: s.left,
		});
		for (const field of Object.keys(totals)) {
			totals[field] += s[field];
		}

		// Spending per category NAME, so a category that exists in several months adds up.
		const spentHere = s.categories.map((c) => ({ name: c.name || "(uden navn)", spent: c.spent }));
		if (s.otherSpent > 0) {
			spentHere.push({ name: "Uden kategori", spent: s.otherSpent });
		}
		for (const entry of spentHere) {
			if (!spentByCategory[entry.name]) {
				spentByCategory[entry.name] = {};
				categoryNames.push(entry.name);
			}
			spentByCategory[entry.name][key] = (spentByCategory[entry.name][key] || 0) + entry.spent;
		}

		for (const item of byDateOldestFirst(month.spending)) {
			spending.push({ date: item.date, category: categoryNameIn(month, item.categoryId), note: item.note, amount: item.amount });
		}
	}

	const categories = categoryNames.map((name) => ({
		name: name,
		perMonth: spentByCategory[name],
		total: Object.values(spentByCategory[name]).reduce((sum, amount) => sum + amount, 0),
	}));

	return { year: year, monthKeys: keys, rows: rows, totals: totals, categories: categories, spending: spending };
}

// The years that have any saved month, oldest first: ["2026", "2027"].
function yearsWithData(months) {
	const years = new Set(Object.keys(months).map((key) => key.slice(0, 4)));
	return [...years].sort();
}

// Spreadsheet text. Danish Excel expects ; between cells and , as the decimal mark.
//
// An amount as a spreadsheet cell: 4995 -> "49,95", -150 -> "-150,00". Whole-number maths,
// so there are never rounding surprises.
function csvAmount(ore) {
	const sign = ore < 0 ? "-" : "";
	const absolute = Math.abs(ore);
	return sign + Math.floor(absolute / 100) + "," + String(absolute % 100).padStart(2, "0");
}

// Text as a spreadsheet cell. Two protections:
// - a cell that starts with = + - @ would be run as a formula by Excel, so it gets a ' in front;
// - a cell with ; or a quote or a line break is wrapped in quotes.
function csvText(text) {
	let cell = String(text);
	if (/^[=+\-@\t\r]/.test(cell)) {
		cell = "'" + cell;
	}
	if (/[;"\n\r]/.test(cell)) {
		cell = '"' + cell.replace(/"/g, '""') + '"';
	}
	return cell;
}

function csvLine(cells) {
	return cells.join(";");
}

// The spreadsheet for one month, as text (lines joined with \r\n, as Excel likes).
function monthCsv(report) {
	const s = report.summary;
	const lines = [
		csvLine([csvText("Budget"), csvText(report.label)]),
		"",
		csvText("Oversigt"),
		csvLine([csvText("Indkomst"), csvAmount(s.income)]),
		csvLine([csvText("Faste udgifter"), csvAmount(s.fixed)]),
		csvLine([csvText("Opsparing"), csvAmount(s.savings)]),
		csvLine([csvText("Til rådighed"), csvAmount(s.available)]),
		csvLine([csvText("Brugt"), csvAmount(s.spent)]),
		csvLine([csvText("Tilbage"), csvAmount(s.left)]),
		"",
		csvText("Indkomst"),
	];
	for (const row of report.income) {
		lines.push(csvLine([csvText(row.name), csvAmount(row.amount)]));
	}
	lines.push("", csvText("Faste udgifter"));
	for (const row of report.fixed) {
		lines.push(csvLine([csvText(row.name), csvAmount(row.amount)]));
	}
	lines.push("", csvText("Kategorier"), csvLine([csvText("Kategori"), csvText("Grænse"), csvText("Brugt"), csvText("Tilbage")]));
	for (const c of report.categories) {
		lines.push(csvLine([csvText(c.name || "(uden navn)"), csvAmount(c.limit), csvAmount(c.spent), csvAmount(c.left)]));
	}
	if (report.otherSpent > 0) {
		lines.push(csvLine([csvText("Uden kategori"), "", csvAmount(report.otherSpent), ""]));
	}
	lines.push("", csvText("Udgifter"), csvLine([csvText("Dato"), csvText("Kategori"), csvText("Note"), csvText("Beløb")]));
	for (const item of report.spending) {
		lines.push(csvLine([csvText(dateText(item.date)), csvText(item.category), csvText(item.note), csvAmount(item.amount)]));
	}
	return lines.join("\r\n");
}

// The spreadsheet for a whole year: a row per month, spending per category per month, and
// every purchase.
function yearCsv(report) {
	const lines = [
		csvLine([csvText("Budget"), csvText(report.year)]),
		"",
		csvText("Måned for måned"),
		csvLine(["Måned", "Indkomst", "Faste udgifter", "Opsparing", "Til rådighed", "Brugt", "Tilbage"].map(csvText)),
	];
	for (const row of report.rows) {
		lines.push(csvLine([csvText(row.label), csvAmount(row.income), csvAmount(row.fixed), csvAmount(row.savings), csvAmount(row.available), csvAmount(row.spent), csvAmount(row.left)]));
	}
	const t = report.totals;
	lines.push(csvLine([csvText("I alt"), csvAmount(t.income), csvAmount(t.fixed), csvAmount(t.savings), csvAmount(t.available), csvAmount(t.spent), csvAmount(t.left)]));

	lines.push("", csvText("Brugt pr. kategori"));
	lines.push(csvLine([csvText("Kategori"), ...report.monthKeys.map((key) => csvText(monthLabel(key))), csvText("I alt")]));
	for (const c of report.categories) {
		lines.push(csvLine([csvText(c.name), ...report.monthKeys.map((key) => csvAmount(c.perMonth[key] || 0)), csvAmount(c.total)]));
	}

	lines.push("", csvText("Udgifter"), csvLine(["Dato", "Kategori", "Note", "Beløb"].map(csvText)));
	for (const item of report.spending) {
		lines.push(csvLine([csvText(dateText(item.date)), csvText(item.category), csvText(item.note), csvAmount(item.amount)]));
	}
	return lines.join("\r\n");
}


// --- Kids' money in your pile (børn) ------------------------------------------

// You keep all your savings in one pile, and some of it is your kids'. The page tracks each
// kid's share on its own: what they have, and each time they used some or were given some.
// An entry is { id, date, person, amount, note } and, when it has them, also:
// - at: the moment it was written down (milliseconds), so moneyNow can tell what came after you
//   typed the savings number;
// - start: true on the first entry, "what they have when you add them" (money already in the pile).
// The amount is in øre and SIGNED: negative when the kid used money, positive when they got some.
// A kid is simply a name that has entries.
// Entries live in the month they happened in, like purchases; the balance adds them all up.

// Everyone with entries, each { person, balance, entries (newest first) }. The same name in
// other capitals is the same person. People are listed in the order of their first entry.
function potBalances(months) {
	const byKey = {};
	const order = [];
	for (const monthKey of Object.keys(months).sort()) {
		for (const entry of months[monthKey].pots || []) {
			const key = entry.person.trim().toLowerCase();
			if (key === "") {
				continue;
			}
			if (!byKey[key]) {
				byKey[key] = { person: entry.person.trim(), balance: 0, entries: [], firstDate: entry.date };
				order.push(key);
			}
			const person = byKey[key];
			person.balance += entry.amount;
			// kidToken is only there on an entry the kid wrote on their own page (see withKidEntries).
			person.entries.push({ id: entry.id, date: entry.date, amount: entry.amount, note: entry.note, monthKey: monthKey, kidToken: entry.kidToken });
			if (entry.date < person.firstDate) {
				person.firstDate = entry.date;
			}
		}
	}
	const people = order.map((key) => byKey[key]);
	people.sort((a, b) => (a.firstDate < b.firstDate ? -1 : a.firstDate > b.firstDate ? 1 : 0));
	for (const person of people) {
		// Newest first; the same day keeps the order things were added (latest first).
		person.entries = person.entries.reverse().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
	}
	return people;
}

// All the kids' balances added together: the part of your pile that is not yours.
function othersTotal(months) {
	return potBalances(months).reduce((sum, person) => sum + person.balance, 0);
}


// --- The kids' own page (a private link) --------------------------------------
//
// Each kid can get a link (Indstillinger -> Børn). Opened on the kid's phone it shows only what the
// kid has, and lets the kid write what they used. Nothing else.
//
// How the numbers travel, so that two people writing never overwrite each other:
// - The parent's page works out how much of the kid's money the PARENT has written down (the start
//   amount, "brugte", "fik") and saves that number on the kid's page: parentSide.
// - The kid writes entries of their own, one document each, which only ever get added. The kid's
//   page shows parentSide + those entries.
// - The parent's page reads the kid's entries too and counts them with its own (withKidEntries),
//   so Nathan's card, "Heraf Nathan" and Opsparing on Fremtid all include what Nathan wrote.

// 24 letters and digits = about 124 bits: far too many to guess. It is the key in the link.
const KID_TOKEN_LENGTH = 24;
const KID_TOKEN_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const KID_TOKEN_PATTERN = /^[a-z0-9]{20,40}$/;
const USERNAME_FOR_LINK_PATTERN = /^[a-z0-9_-]{3,20}$/;

// Turns random numbers (0-255, KID_TOKEN_LENGTH of them, from the browser's crypto) into a token.
function makeKidToken(randomBytes) {
	let token = "";
	for (let i = 0; i < KID_TOKEN_LENGTH; i++) {
		token += KID_TOKEN_CHARS[randomBytes[i] % KID_TOKEN_CHARS.length];
	}
	return token;
}

// The link to give a kid: the page's own address plus ?kid=<account>.<token>.
function kidLink(pageUrl, parent, token) {
	return pageUrl + "?kid=" + parent + "." + token;
}

// Reads "<account>.<token>" (what follows ?kid= in the link). Returns { parent, token } or null.
function parseKidKey(text) {
	const parts = String(text || "").split(".");
	if (parts.length !== 2 || !USERNAME_FOR_LINK_PATTERN.test(parts[0]) || !KID_TOKEN_PATTERN.test(parts[1])) {
		return null;
	}
	return { parent: parts[0], token: parts[1] };
}

// What the parent's page has written down for one kid (by name, capitals don't matter), not
// counting what the kid wrote. This is the number saved on the kid's page as parentSide.
function parentSideOf(months, person) {
	const wanted = person.trim().toLowerCase();
	let sum = 0;
	for (const monthKey of Object.keys(months)) {
		for (const entry of months[monthKey].pots || []) {
			if (entry.person.trim().toLowerCase() === wanted) {
				sum += entry.amount;
			}
		}
	}
	return sum;
}

// A kid's entry as it comes from the online storage, or null if it is not a real one. A kid only
// ever USES money, so the amount is negative (firestore.rules says the same).
function cleanKidEntry(id, raw) {
	if (!raw || typeof raw !== "object" || typeof raw.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) {
		return null;
	}
	const amount = Math.round(Number(raw.amount));
	if (!Number.isFinite(amount) || amount >= 0) {
		return null;
	}
	return {
		id: cleanText(id, 40),
		date: raw.date,
		amount: Math.max(-MAX_AMOUNT, amount),
		note: cleanText(raw.note, MAX_NOTE_LENGTH),
		at: cleanMoment(raw.at) || 0,
	};
}

// The months with the kids' own entries added, for working out balances (potBalances, moneyNow).
// kidEntries: [{ token, person, id, date, amount, note, at }]. Each goes into the month its date is
// in, as an ordinary entry that also carries kidToken. The real months are not changed.
function withKidEntries(months, kidEntries) {
	if (kidEntries.length === 0) {
		return months;
	}
	const merged = { ...months };
	for (const entry of kidEntries) {
		const monthKey = entry.date.slice(0, 7);
		const month = merged[monthKey];
		const asEntry = { id: entry.id, date: entry.date, person: entry.person, amount: entry.amount, note: entry.note, at: entry.at, kidToken: entry.token };
		if (merged[monthKey] === months[monthKey]) {
			// First time this month is touched: copy it, so the original keeps its own list.
			merged[monthKey] = { ...(month || { balances: {} }), pots: [...((month && month.pots) || [])] };
		}
		merged[monthKey].pots.push(asEntry);
	}
	return merged;
}


// --- Money now: what is on your accounts (Fremtid) ---------------------------
//
// Two numbers you type from the bank: "account" (Lønkonto) and "savings" (Opsparing). Each is
// { amount (øre, may be negative), at (the moment you typed it, in milliseconds) }. The newest
// one wins, wherever it was saved, so typing the real number always replaces the old one.
//
// The savings number follows the kids: when a kid used or got money AFTER you typed it, the
// savings go down or up by that. (Whatever happened before is already in the number you typed.)
// The account number never moves by itself. Fremtid starts from the total of the two.

const BALANCE_KEYS = ["account", "savings"];

// The newest typed number for "account" or "savings" in any month, or null if there is none.
function latestBalance(months, which) {
	let newest = null;
	for (const monthKey of Object.keys(months)) {
		const balances = months[monthKey].balances;
		const found = balances && balances[which];
		if (found && (newest === null || found.at > newest.at)) {
			newest = found;
		}
	}
	return newest;
}

// What the kids used or got since the moment `at`, added up (negative = used). Skips the "start"
// entries: those are money that was already in the pile.
//
// An entry counts when it was written down after `at` AND is dated that day or later; an entry
// for an earlier day is money that had already left or arrived, so the number you typed has it.
// Old entries have no moment, only a date: those count when the date is after the day you typed.
function potChangeSince(months, at) {
	const typedDay = dateKeyOf(new Date(at));
	let change = 0;
	for (const monthKey of Object.keys(months)) {
		for (const entry of months[monthKey].pots || []) {
			if (entry.start) {
				continue;
			}
			const isAfter = typeof entry.at === "number"
				? entry.at > at && entry.date >= typedDay
				: entry.date > typedDay;
			if (isAfter) {
				change += entry.amount;
			}
		}
	}
	return change;
}

// Everything Fremtid needs: both typed numbers (or null), what the kids changed in the savings
// since, each account as it is now, and the total. `any` is false until one number is typed.
function moneyNow(months) {
	const account = latestBalance(months, "account");
	const savings = latestBalance(months, "savings");
	const fromKids = savings ? potChangeSince(months, savings.at) : 0;
	const accountNow = account ? account.amount : 0;
	const savingsNow = savings ? savings.amount + fromKids : 0;
	return {
		account: account,
		savings: savings,
		fromKids: fromKids,
		accountNow: accountNow,
		savingsNow: savingsNow,
		total: accountNow + savingsNow,
		any: Boolean(account || savings),
	};
}


// --- Notes you have used before (the suggestions under "Note") --------------

const MOST_SUGGESTED_NOTES = 200;

// Every note used on a purchase in any month, for the suggestions while typing. Same note with
// different capitals ("rema 1000", "Rema 1000") counts as one. Most-used first, then most recent.
// Each entry: { note, count, lastDate, categoryName } - the text as it was written last, how many
// times it was used, and the category of its latest use ("" if that had none).
function noteHistory(months) {
	const byKey = {};
	for (const monthKey of Object.keys(months)) {
		const month = months[monthKey];
		for (const item of month.spending) {
			const note = item.note.trim();
			if (note === "") {
				continue;
			}
			const key = note.toLowerCase();
			const category = categoryNameIn(month, item.categoryId);
			const entry = byKey[key];
			if (!entry) {
				byKey[key] = { note: note, count: 1, lastDate: item.date, categoryName: category === "Uden kategori" ? "" : category };
				continue;
			}
			entry.count += 1;
			if (item.date >= entry.lastDate) {
				entry.lastDate = item.date;
				entry.note = note;
				entry.categoryName = category === "Uden kategori" ? "" : category;
			}
		}
	}
	return Object.values(byKey)
		.sort((a, b) => b.count - a.count || (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0) || a.note.localeCompare(b.note, "da"))
		.slice(0, MOST_SUGGESTED_NOTES);
}

// The id of the category of the month `month` that this note usually goes in, or "" when the note
// is new, or its usual category doesn't exist in this month. Matched by name, because the same
// category has a different id in another month's plan only if it was made again.
function categoryIdForNote(history, note, month) {
	const key = note.trim().toLowerCase();
	const entry = history.find((other) => other.note.toLowerCase() === key);
	if (!entry || entry.categoryName === "") {
		return "";
	}
	const wanted = entry.categoryName.trim().toLowerCase();
	const category = month.categories.find((other) => other.name.trim().toLowerCase() === wanted);
	return category ? category.id : "";
}


// --- Reading the bank's list from a picture ----------------------------------
//
// scan.js turns a screenshot of the bank's list of purchases into plain text, one line of text per
// line on the screen. These functions turn that text into purchases. They are careful: a line they
// are not sure about is never guessed at, it is handed back in `unclear` so you can write it in
// yourself. (The reading of the picture makes mistakes; that is why the page shows everything for
// checking before anything is saved.)

const BANK_MONTH_NAMES = "januar|jan|februar|feb|marts|mar|april|apr|maj|juni|jun|juli|jul|august|aug|september|sept|sep|oktober|okt|november|nov|december|dec";
const BANK_MONTH_SHORT = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const BANK_WEEKDAYS = "mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag|man|tir|ons|tor|fre|lør|søn";
const BANK_SKIP_NOTE = /^(saldo|disponibel|rådighedsbeløb|i alt|total|sum)(\s|$)/i;
const MOST_BANK_ROWS = 300;

// A date at the start of a line: "30. sep.", "30. september 2026", "30/09", "30-09-2026", "Tirsdag
// 30. sep.", "I dag", "I går". Returns { day, month, year (null when the line has none), rest } with
// `rest` being what follows, or null when the line does not start with a date.
function bankDateAtStart(line, today) {
	const noWeekday = line.replace(new RegExp("^(?:" + BANK_WEEKDAYS + ")\\.?,?\\s+", "i"), "");

	const relative = /^i\s?(dag|går|forgårs)(?![a-zæøå])[\s,:]*/i.exec(noWeekday);
	if (relative) {
		const back = { dag: 0, går: 1, forgårs: 2 }[relative[1].toLowerCase()];
		const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
		return { day: day.getDate(), month: day.getMonth() + 1, year: day.getFullYear(), rest: noWeekday.slice(relative[0].length) };
	}

	const named = new RegExp("^(\\d{1,2})\\.?\\s*(" + BANK_MONTH_NAMES + ")\\.?(?![a-zæøå])(?:\\s+(\\d{4})(?![\\d,.]))?[\\s,;:|]*", "i").exec(noWeekday);
	if (named) {
		const month = BANK_MONTH_SHORT.indexOf(named[2].toLowerCase().slice(0, 3)) + 1;
		return { day: Number(named[1]), month: month, year: named[3] ? Number(named[3]) : null, rest: noWeekday.slice(named[0].length) };
	}

	const numbers = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}|\d{2}))?(?![\d,])[\s,;:|]*/.exec(noWeekday);
	if (numbers && Number(numbers[2]) >= 1 && Number(numbers[2]) <= 12) {
		let year = null;
		if (numbers[3]) {
			year = numbers[3].length === 2 ? 2000 + Number(numbers[3]) : Number(numbers[3]);
		}
		return { day: Number(numbers[1]), month: Number(numbers[2]), year: year, rest: noWeekday.slice(numbers[0].length) };
	}
	return null;
}

// "2026-09-30" for a date from bankDateAtStart (a date without a year gets `defaultYear`), or null
// when there is no such day (31 February).
function bankDateKey(found, defaultYear) {
	const year = found.year === null ? defaultYear : found.year;
	if (found.day < 1 || found.month < 1 || found.month > 12 || found.day > new Date(year, found.month, 0).getDate()) {
		return null;
	}
	return year + "-" + String(found.month).padStart(2, "0") + "-" + String(found.day).padStart(2, "0");
}

// An amount at the END of a line: "-45,00", "−45,00 kr.", "1.250,00", "45.00 DKK", "-45". Returns
// { ore, sign (-1 for a minus, 1 for a plus, 0 for none), index (where it starts in the text), bare,
// unsure } or null. `bare` is true when only a sign vouches for it: no decimals and no "kr".
// `unsure` is true when the text ends in a "~" (see BANK_UNSURE_AMOUNT). A bare number without a sign
// ("Rema 1000") is not an amount: it needs decimals, "kr", or a sign.
function bankAmountAtEnd(text) {
	const match = /([-−–—+])?\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+[.,]\d{1,2}|\d+)\s*(kr\.?|dkk|,-)?[\s›>»~]*$/i.exec(text);
	if (!match) {
		return null;
	}
	const sign = match[1] || "";
	const number = match[2];
	const withDecimals = /,\d{1,2}$/.test(number) || /^\d+\.\d{1,2}$/.test(number);
	if (!withDecimals && !match[3] && sign === "") {
		return null;
	}

	let kroner = number;
	if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(number)) {
		kroner = number.replace(/\./g, "").replace(",", ".");   // "1.250,00": the dots are thousands
	} else {
		kroner = number.replace(",", ".");                      // "45,00" or "45.00"
	}
	const ore = Math.round(parseFloat(kroner) * 100);
	let signValue = 0;
	if (sign === "+") {
		signValue = 1;
	} else if (sign !== "") {
		signValue = -1;
	}
	return { ore: ore, sign: signValue, index: match.index, bare: !withDecimals && !match[3], unsure: text.trimEnd().endsWith(BANK_UNSURE_AMOUNT) };
}

// The text before the amount, tidied: no time of day, no stray lines and dots from the picture.
function bankNote(text) {
	return text
		.replace(/^\d{1,2}[:.]\d{2}\s+/, "")
		.replace(/[|_~•·]/g, " ")
		.replace(/\s+/g, " ")
		.replace(/^[^a-zA-ZæøåÆØÅ0-9]+/, "")   // what a shop's little picture in the list looks like to the reader
		.replace(/^forretning:\s*/i, "")        // some banks write "Forretning:" (shop) in front of every card purchase
		.replace(/[\s\-–—:,;]+$/g, "")
		.slice(0, MAX_NOTE_LENGTH)
		.trim();
}

// assembleBankText puts this after an amount that the two readings of the amount column did not agree on.
const BANK_UNSURE_AMOUNT = "~";

// How much of a list must show decimals for a number without them to count as a lost comma.
const BANK_DECIMALS_SHARE = 0.7;

// assembleBankText puts this at the end of a line whose amount could not be read.
const BANK_NO_AMOUNT = " [?]";

// Something that looks like an amount was tried but did not read cleanly ("45,0O", "kr").
const BANK_LOOKS_LIKE_AMOUNT = /\d[.,]\d|\d\s*(kr|dkk)(?![a-zæøå])|[-−–—+]\s*\d/i;

// Text from a picture -> { lines, unclear }.
//   lines:   [{ date: "2026-09-30", note, ore, sign, raw }] in the order of the picture. `ore` is
//            the amount without its sign; `sign` is -1 (minus), 1 (plus) or 0 (no sign).
//   unclear: the lines that had something of a date or an amount but could not be understood.
// A date on a line of its own ("Tirsdag 30. september", "I dag") counts for the lines under it. A
// date without a year gets the year of `monthKey`.
function parseBankText(text, monthKey, today) {
	const defaultYear = Number(monthKey.slice(0, 4));
	const lines = [];
	const unclear = [];
	let currentDate = null;

	for (const rawLine of String(text).split(/\r?\n/)) {
		const line = rawLine.replace(/\s+/g, " ").trim();
		if (line === "") {
			continue;
		}
		if (line.endsWith(BANK_NO_AMOUNT.trim())) {
			unclear.push(line.slice(0, -BANK_NO_AMOUNT.trim().length).trim());
			continue;
		}
		const found = bankDateAtStart(line, today);
		const rest = found ? found.rest : line;
		const dateKey = found ? bankDateKey(found, defaultYear) : null;

		const amount = bankAmountAtEnd(rest);
		if (amount === null) {
			if (BANK_LOOKS_LIKE_AMOUNT.test(rest)) {
				unclear.push(line);
			} else if (found) {
				currentDate = dateKey;   // a heading with only a date; an impossible one (31 Feb) leaves no date at all
				if (dateKey === null) {
					unclear.push(line);
				}
			}
			continue;
		}

		const note = bankNote(rest.slice(0, amount.index));
		if (BANK_SKIP_NOTE.test(note)) {
			continue;   // a balance or a total, not a purchase
		}
		if (found) {
			currentDate = dateKey;
		}
		const date = found ? dateKey : currentDate;
		if (date === null || amount.ore === 0 || amount.ore > MAX_AMOUNT) {
			unclear.push(line);
			continue;
		}
		lines.push({ date: date, note: note, ore: amount.ore, sign: amount.sign, raw: line, bare: amount.bare, guess: amount.unsure });
	}

	// A list that shows two decimals on nearly every amount, and one amount of three digits or more
	// with none ("-14895" among "-148,95", "-64,50"): the reader lost its comma. It is read as if the
	// comma were in front of the last two digits - and marked `guess`, so the page says "tjek beløbet".
	const withDecimals = lines.filter((line) => !line.bare).length;
	if (lines.length >= 4 && withDecimals >= BANK_DECIMALS_SHARE * lines.length) {
		for (const line of lines) {
			if (line.bare && line.ore >= 10000 && line.ore % 100 === 0) {
				line.ore = line.ore / 100;
				line.guess = true;
			}
		}
	}
	return { lines: lines, unclear: unclear };
}

// --- A bank list laid out in columns ---------------------------------------------
//
// Some banks (on a computer screen especially) put the date in a column of its own at the left ("29"
// with "SEP" under it, on the first line of each day only), and the amount in a column at the right
// with the balance in small letters under it. Read as one block of text, that comes out in a mess:
// small letters, the commas of the red numbers lost, the day numbers garbled. So scan.js reads the
// picture in up to three goes - the whole page for the names, the amount column on its own (digits
// only, enlarged) and the date column on its own - and these functions put them back together by
// where each word sits on the picture.
//
// A word is { text, x0, y0, x1, y1 } in the picture's own pixels; the reader of the amount column
// also says `red` (the number is written in red). The biggest number of a line is the amount of the
// purchase, the small one under it is the balance and is left out. A red number is a cost.

const BANK_AMOUNT_WORD = /^[-−–+]?\d[\d.,]*\d$/;
const BANK_MONTH_WORD = new RegExp("^(" + BANK_MONTH_NAMES + ")\\.?$", "i");
const BANK_UNSURE_SHARE = 0.75;   // a column list where this share of the lines has an amount: one without is marked

function middleOf(numbers) {
	const sorted = [...numbers].sort((a, b) => a - b);
	return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
}

// Looks at the words of the whole page and says where the amount column and the date column are:
// { amounts: { x0, x1 } or null, left: { x0, x1 } or null }, as spans of x across the picture.
// The amount column is where at least four numbers of three or more digits end at the same place
// (right-aligned). The date column is the space left of where the names start, when it is wide enough.
function bankColumns(words, width) {
	const numbers = words.filter((word) => BANK_AMOUNT_WORD.test(word.text) && word.text.replace(/\D/g, "").length >= 3);
	let amounts = null;
	if (numbers.length >= 4) {
		const edge = middleOf(numbers.map((word) => word.x1));
		const aligned = numbers.filter((word) => Math.abs(word.x1 - edge) <= 0.04 * width);
		if (aligned.length >= Math.max(4, numbers.length / 2)) {
			amounts = {
				x0: Math.max(0, Math.min(...aligned.map((word) => word.x0)) - 0.02 * width),
				x1: Math.min(width, Math.max(...aligned.map((word) => word.x1)) + 0.01 * width),
			};
		}
	}

	let left = null;
	const names = words.filter((word) => /[a-zA-ZæøåÆØÅ]{4,}/.test(word.text));
	if (names.length >= 3) {
		const sorted = names.map((word) => word.x0).sort((a, b) => a - b);
		const nameStart = sorted[Math.floor(sorted.length * 0.2)];
		if (nameStart >= 0.06 * width) {
			left = { x0: 0, x1: nameStart - 0.01 * width };
		}
	}
	return { amounts: amounts, left: left };
}

// Words -> lines of text from top to bottom: [{ text, y, height }] (y is the middle of the line).
function bankLinesOf(words) {
	if (words.length === 0) {
		return [];
	}
	const middle = (word) => (word.y0 + word.y1) / 2;
	const tolerance = 0.6 * middleOf(words.map((word) => word.y1 - word.y0));
	const groups = [];
	for (const word of [...words].sort((a, b) => middle(a) - middle(b))) {
		const group = groups[groups.length - 1];
		if (group && Math.abs(middle(word) - group.y) <= tolerance) {
			group.words.push(word);
			group.y = group.words.reduce((sum, other) => sum + middle(other), 0) / group.words.length;
		} else {
			groups.push({ words: [word], y: middle(word) });
		}
	}
	return groups
		.map((group) => ({
			text: group.words.sort((a, b) => a.x0 - b.x0).map((word) => word.text).join(" "),
			y: group.y,
			height: middleOf(group.words.map((word) => word.y1 - word.y0)),
		}))
		.filter((line) => /[a-zA-ZæøåÆØÅ]/.test(line.text));
}

// A sign the reader found as a word of its own ("-" then "64,50") is joined to its number.
function bankJoinSigns(words) {
	const used = new Set();
	const joined = [];
	for (const word of words) {
		if (!/^[-−–+]$/.test(word.text)) {
			continue;
		}
		const height = word.y1 - word.y0;
		const next = words.find((other) => other !== word && /^\d/.test(other.text) && !used.has(other)
			&& Math.abs((other.y0 + other.y1) / 2 - (word.y0 + word.y1) / 2) < 0.6 * Math.max(height, other.y1 - other.y0)
			&& other.x0 - word.x1 >= -2 && other.x0 - word.x1 < 1.5 * Math.max(height, other.y1 - other.y0));
		if (next) {
			used.add(word);
			used.add(next);
			joined.push({ ...next, text: word.text + next.text, x0: word.x0 });
		}
	}
	return words.filter((word) => !used.has(word)).concat(joined);
}

// Which of the numbers beside one line is the purchase's amount: the biggest letters; with the same
// size a red one; then one with a sign; then the upper one. (The balance under it is smaller.)
function bankPrimaryAmount(candidates) {
	const height = (word) => word.y1 - word.y0;
	return [...candidates].sort((a, b) => {
		if (height(a) > 1.12 * height(b)) {
			return -1;
		}
		if (height(b) > 1.12 * height(a)) {
			return 1;
		}
		if (Boolean(a.red) !== Boolean(b.red)) {
			return a.red ? -1 : 1;
		}
		const signed = (word) => /^[-−–+]/.test(word.text);
		if (signed(a) !== signed(b)) {
			return signed(a) ? -1 : 1;
		}
		return a.y0 - b.y0;
	})[0];
}

// The days in the date column: "29" with "SEP" under it (or beside it) becomes { y, text: "29 SEP" }.
function bankDateHeadings(words) {
	const days = words.filter((word) => /^\d{1,2}\.?$/.test(word.text));
	const months = words.filter((word) => BANK_MONTH_WORD.test(word.text));
	const taken = new Set();
	const headings = [];
	for (const day of days) {
		const height = day.y1 - day.y0;
		const middle = (day.y0 + day.y1) / 2;
		const match = months
			.filter((month) => !taken.has(month) && month.x0 < day.x1 + 0.5 * height && month.x1 > day.x0 - 0.5 * height
				&& (month.y0 + month.y1) / 2 - middle > -0.5 * height && (month.y0 + month.y1) / 2 - middle < 3 * height)
			.sort((a, b) => a.y0 - b.y0)[0]
			|| months.find((month) => !taken.has(month) && month.x0 >= day.x1 - 2 && month.x0 - day.x1 < 2 * height
				&& Math.abs((month.y0 + month.y1) / 2 - middle) < 0.6 * height);
		if (match) {
			taken.add(match);
			headings.push({ y: middle, text: day.text.replace(".", "") + " " + match.text.replace(".", "") });
		}
	}
	return headings.sort((a, b) => a.y - b.y);
}

// The amount column is read twice, at two sizes, because a small comma or a thin minus is sometimes
// lost at one size and kept at the other. This puts the two readings of every number together: when
// they say the same, fine (a sign found by only one is kept); when only one of them is a proper
// amount (digits, a comma, two decimals), that one is taken; when they disagree and both look right
// (or neither does), the first is kept and marked `unsure`, so the page says "tjek beløbet" instead of
// quietly picking one. A number only one of the readings saw is kept as it is.
function reconcileAmountReadings(first, second) {
	const proper = (text) => /^[-−–+]?\d+(\.\d{3})*,\d{2}$/.test(text);
	const digitsOf = (text) => text.replace(/[^\d,]/g, "");
	const taken = new Set();
	const merged = first.map((word) => {
		const middle = (word.y0 + word.y1) / 2;
		const limit = 0.6 * (word.y1 - word.y0);
		let other = null;
		for (const candidate of second) {
			const distance = Math.abs((candidate.y0 + candidate.y1) / 2 - middle);
			if (!taken.has(candidate) && distance < limit && (other === null || distance < Math.abs((other.y0 + other.y1) / 2 - middle))) {
				other = candidate;
			}
		}
		if (other === null) {
			return word;
		}
		taken.add(other);
		const hasSign = (text) => /^[-−–+]/.test(text);
		if (digitsOf(word.text) === digitsOf(other.text)) {
			return !hasSign(word.text) && hasSign(other.text) ? { ...word, text: other.text, red: word.red || other.red } : word;
		}
		if (proper(other.text) && !proper(word.text)) {
			return { ...word, text: other.text };
		}
		if (proper(word.text) && !proper(other.text)) {
			return word;
		}
		return { ...word, unsure: true };
	});
	return merged.concat(second.filter((word) => !taken.has(word) && !first.some((other) => Math.abs((other.y0 + other.y1) / 2 - (word.y0 + word.y1) / 2) < 0.6 * (word.y1 - word.y0))));
}

// Puts the three readings together as text, one line per purchase: the date as a line of its own
// before the first purchase of the day, then "name  amount". The words of the whole page that lie in
// the amount column, or right of it (the little tick boxes), or in the date column, are left out:
// they were read better on their own.
function assembleBankText(mainWords, columns, amountWords, dateWords) {
	const centre = (word) => (word.x0 + word.x1) / 2;
	const nameWords = mainWords.filter((word) => !(columns.amounts && centre(word) >= columns.amounts.x0)
		&& !(columns.left && centre(word) <= columns.left.x1));
	const lines = bankLinesOf(nameWords);

	// The numbers of the amount column go to the line they are nearest to.
	const gaps = lines.slice(1).map((line, index) => line.y - lines[index].y);
	const reach = 0.75 * (gaps.length > 0 ? middleOf(gaps) : 100);
	const beside = lines.map(() => []);
	for (const word of bankJoinSigns(amountWords)) {
		const text = word.text.replace(/,\./g, ",").replace(/^[.,]+|[.,]+$/g, "");
		if (!/\d/.test(text) || lines.length === 0) {
			continue;
		}
		const y = (word.y0 + word.y1) / 2;
		let nearest = 0;
		for (let i = 1; i < lines.length; i++) {
			if (Math.abs(lines[i].y - y) < Math.abs(lines[nearest].y - y)) {
				nearest = i;
			}
		}
		if (Math.abs(lines[nearest].y - y) <= reach) {
			beside[nearest].push({ ...word, text: text });
		}
	}
	const withAmount = beside.filter((list) => list.length > 0).length;
	const markMissing = columns.amounts !== null && lines.length > 0 && withAmount / lines.length >= BANK_UNSURE_SHARE;

	const output = [];
	const headings = bankDateHeadings(dateWords);
	let nextHeading = 0;
	lines.forEach((line, index) => {
		while (nextHeading < headings.length && headings[nextHeading].y - 0.5 * Math.max(reach / 0.75, 1) <= line.y) {
			output.push(headings[nextHeading].text);
			nextHeading += 1;
		}
		if (beside[index].length === 0) {
			output.push(line.text + (markMissing ? BANK_NO_AMOUNT : ""));
			return;
		}
		const amount = bankPrimaryAmount(beside[index]);
		const sign = amount.red && !/^[-−–+]/.test(amount.text) ? "-" : "";
		output.push(line.text + "   " + sign + amount.text + (amount.unsure ? BANK_UNSURE_AMOUNT : ""));
	});
	return output.join("\n");
}

// The category of the month `month` for a bank text: the one the same note had before; else the
// one of the longest earlier note the text starts with ("REMA 1000 AARHUS C" starts with "Rema 1000").
function bankCategoryId(history, note, month) {
	const exact = categoryIdForNote(history, note, month);
	if (exact !== "") {
		return exact;
	}
	const lower = note.toLowerCase();
	let best = null;
	for (const entry of history) {
		const earlier = entry.note.toLowerCase();
		const startsWith = lower.startsWith(earlier) && (lower.length === earlier.length || lower[earlier.length] === " ");
		if (earlier.length >= 3 && startsWith && (best === null || earlier.length > best.length)) {
			best = entry.note;
		}
	}
	return best === null ? "" : categoryIdForNote(history, best, month);
}

// Everything the page shows for checking after a picture was read. `month` is the month's data
// (its purchases and categories) and `history` is noteHistory(). Returns
//   rows:      the purchases for `monthKey`: { date, note, amount, categoryId, tick, why } in the
//              order of the picture. `tick` is whether it is chosen from the start; `why` says
//              what a not-chosen one is: "already" (the same purchase is already written in) or
//              "money-in" (it looks like money coming in, not a purchase). "check" is a chosen one
//              whose amount is a guess (a comma the reader lost was put back): look at it.
//   elsewhere: lines dated in another month: left out (they belong to that month).
//   unclear:   lines that could not be understood.
// Which sign means a purchase: if the picture has any minus at all, only minus lines are purchases
// (the rest is money in); with no minus anywhere, everything is a purchase except a plus line.
function planBankImport(text, monthKey, today, month, history) {
	const parsed = parseBankText(text, monthKey, today);
	const hasMinus = parsed.lines.some((line) => line.sign === -1);
	const written = month.spending.map((item) => ({ date: item.date, amount: item.amount, note: item.note.trim().toLowerCase(), used: false }));
	const rows = [];
	const elsewhere = [];

	for (const line of parsed.lines.slice(0, MOST_BANK_ROWS)) {
		if (line.date.slice(0, 7) !== monthKey) {
			elsewhere.push({ date: line.date, note: line.note, amount: line.ore });
			continue;
		}
		const lower = line.note.toLowerCase();
		const earlier = history.find((entry) => entry.note.toLowerCase() === lower);
		const note = earlier ? earlier.note : line.note;   // spelled the way you wrote it before

		const moneyIn = hasMinus ? line.sign !== -1 : line.sign === 1;
		let why = moneyIn ? "money-in" : (line.guess ? "check" : "");
		if (!moneyIn) {
			const same = written.find((item) => !item.used && item.date === line.date && item.amount === line.ore
				&& (item.note === "" || lower === "" || item.note === lower || item.note.startsWith(lower) || lower.startsWith(item.note)));
			if (same) {
				same.used = true;
				why = "already";
			}
		}
		rows.push({ date: line.date, note: note, amount: line.ore, categoryId: bankCategoryId(history, line.note, month), tick: why === "" || why === "check", why: why });
	}
	return { rows: rows, elsewhere: elsewhere, unclear: parsed.unclear };
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

// Like cleanAmount, but the amount may be negative (money a person used).
function cleanSignedAmount(value) {
	const n = Math.round(Number(value));
	if (!Number.isFinite(n)) {
		return 0;
	}
	return Math.max(-MAX_AMOUNT, Math.min(n, MAX_AMOUNT));
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

// dated: income and fixed-bill rows may carry a "from" and a "to" day; other rows never do.
// periodic: income and fixed bills may also come every 2, 3, 6 or 12 months (only with a "from" day).
function cleanRows(list, amountField, mostRows, dated, periodic) {
	if (!Array.isArray(list)) {
		return [];
	}
	return list.filter((row) => row && typeof row === "object").slice(0, mostRows).map((row) => {
		const clean = { id: cleanId(row.id), name: cleanText(row.name, MAX_NAME_LENGTH) };
		clean[amountField] = cleanAmount(row[amountField]);
		if (dated) {
			// Only a real-looking date is kept, and the field is left out when empty.
			for (const field of ["from", "to"]) {
				if (typeof row[field] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row[field])) {
					clean[field] = row[field];
				}
			}
		}
		if (periodic && clean.from && EVERY_CHOICES.includes(row.every) && row.every > 1) {
			clean.every = row.every;
		}
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

// A moment in milliseconds: a whole number from 1 up to year 5000 or so. The limit is the same in
// firestore.rules. Anything else is not a moment.
const MOST_MOMENT = 100000000000000;

function cleanMoment(value) {
	const n = Math.round(Number(value));
	return Number.isFinite(n) && n > 0 && n <= MOST_MOMENT ? n : null;
}

function cleanPots(list) {
	if (!Array.isArray(list)) {
		return [];
	}
	return list
		.filter((entry) => entry && typeof entry === "object" && /^\d{4}-\d{2}-\d{2}$/.test(entry.date))
		.map((entry) => {
			const clean = {
				id: cleanId(entry.id),
				date: entry.date,
				person: cleanText(entry.person, MAX_NAME_LENGTH).trim(),
				amount: cleanSignedAmount(entry.amount),
				note: cleanText(entry.note, MAX_NOTE_LENGTH),
			};
			// Optional, left out when missing: the moment it was written down, and the "start" mark.
			const at = cleanMoment(entry.at);
			if (at !== null) {
				clean.at = at;
			}
			if (entry.start === true) {
				clean.start = true;
			}
			return clean;
		})
		.filter((entry) => entry.person !== "")
		.slice(0, MOST_POT_ENTRIES_PER_MONTH);
}

// The typed "money now" numbers of one month: only "account" and "savings", each { amount, at }.
// A number without a real moment is dropped, because without it nobody can tell what came after.
function cleanBalances(raw) {
	const clean = {};
	if (!raw || typeof raw !== "object") {
		return clean;
	}
	for (const key of BALANCE_KEYS) {
		const found = raw[key];
		if (!found || typeof found !== "object") {
			continue;
		}
		const amount = Math.round(Number(found.amount));
		const at = cleanMoment(found.at);
		if (Number.isFinite(amount) && at !== null) {
			clean[key] = { amount: Math.max(-MAX_AMOUNT, Math.min(amount, MAX_AMOUNT)), at: at };
		}
	}
	return clean;
}

function cleanMonth(raw) {
	const source = raw && typeof raw === "object" ? raw : {};
	return {
		income: cleanRows(source.income, "amount", MOST_INCOME_ROWS, true, true),
		fixed: cleanRows(source.fixed, "amount", MOST_FIXED_ROWS, true, true),
		savings: cleanAmount(source.savings),
		categories: cleanRows(source.categories, "limit", MOST_CATEGORIES),
		spending: cleanSpending(source.spending),
		startBalance: cleanAmount(source.startBalance),
		balances: cleanBalances(source.balances),
		pots: cleanPots(source.pots),
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
		parseAmount, parseSignedAmount, formatKr, amountToInput, sumOf,
		monthKeyOf, dateKeyOf, shiftMonth, monthLabel, shortMonthLabel, dayLabel, lastDayOfMonth, daysLeftInMonth,
		newId, starterMonth, copyPlanOf, nearestMonthWithData, missingCategoryNames, parseBankText, planBankImport, bankCategoryId, bankColumns, assembleBankText, reconcileAmountReadings, mergeDeviceMonth, spendingNewestFirst, spendingByCategory,
		summarize, barShare, barLevel,
		activeDaysIn, amountIn, sumIn, windowText, rowsForReport,
		potBalances, othersTotal, cleanSignedAmount, MOST_POT_ENTRIES_PER_MONTH,
		latestBalance, potChangeSince, moneyNow, cleanBalances,
		makeKidToken, kidLink, parseKidKey, parentSideOf, cleanKidEntry, withKidEntries, KID_TOKEN_LENGTH,
		noteHistory, categoryIdForNote,
		EVERY_CHOICES, isPeriodic, monthsBetween, isDueIn, nextDueKey, everyText,
		FORECAST_MONTHS, forecast,
		dateText, monthReport, yearReport, yearsWithData, csvAmount, csvText, monthCsv, yearCsv,
		cleanAmount, cleanMonth, cleanData, sameData,
		MOST_INCOME_ROWS, MOST_FIXED_ROWS, MOST_CATEGORIES, MOST_SPENDING_PER_MONTH,
	};
}
