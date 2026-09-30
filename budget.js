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
		pots: [],
	};
}

// A new month starts with last month's plan but no spending. The "money I have now" number
// is NOT carried over: it was true on a particular day, and would be stale a month later.
function copyPlanOf(month) {
	const copy = JSON.parse(JSON.stringify(month));
	copy.spending = [];
	copy.startBalance = 0;
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

	const merged = JSON.parse(JSON.stringify(accountMonth));
	merged.spending = accountMonth.spending.concat(taken);
	merged.pots = (accountMonth.pots || []).concat(takenPots);
	return { month: merged, added: taken.length + takenPots.length };
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

// A simple what-if over the next `howMany` months, starting with the money the month says you
// have at its start (startBalance). It is arithmetic, not a prediction.
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
function forecast(month, key, howMany, months) {
	const savedMonths = months || {};

	const rows = [];
	let total = month.startBalance;
	let carefulTotal = month.startBalance;
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
		start: month.startBalance,
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
// kid's share on its own: what they have, and each time they used some or were given some. An entry is { id, date, person, amount, note }; the amount is in øre and
// SIGNED: negative when the person used money, positive when they got some (the first entry is
// what they have when you add them). A person is simply a name that has entries.
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
			person.entries.push({ id: entry.id, date: entry.date, amount: entry.amount, note: entry.note, monthKey: monthKey });
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

function cleanPots(list) {
	if (!Array.isArray(list)) {
		return [];
	}
	return list
		.filter((entry) => entry && typeof entry === "object" && /^\d{4}-\d{2}-\d{2}$/.test(entry.date))
		.map((entry) => ({
			id: cleanId(entry.id),
			date: entry.date,
			person: cleanText(entry.person, MAX_NAME_LENGTH).trim(),
			amount: cleanSignedAmount(entry.amount),
			note: cleanText(entry.note, MAX_NOTE_LENGTH),
		}))
		.filter((entry) => entry.person !== "")
		.slice(0, MOST_POT_ENTRIES_PER_MONTH);
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
		parseAmount, formatKr, amountToInput, sumOf,
		monthKeyOf, dateKeyOf, shiftMonth, monthLabel, shortMonthLabel, dayLabel, lastDayOfMonth, daysLeftInMonth,
		newId, starterMonth, copyPlanOf, nearestMonthWithData, mergeDeviceMonth, spendingNewestFirst,
		summarize, barShare, barLevel,
		activeDaysIn, amountIn, sumIn, windowText, rowsForReport,
		potBalances, othersTotal, cleanSignedAmount, MOST_POT_ENTRIES_PER_MONTH,
		noteHistory, categoryIdForNote,
		EVERY_CHOICES, isPeriodic, monthsBetween, isDueIn, nextDueKey, everyText,
		FORECAST_MONTHS, forecast,
		dateText, monthReport, yearReport, yearsWithData, csvAmount, csvText, monthCsv, yearCsv,
		cleanAmount, cleanMonth, cleanData, sameData,
		MOST_INCOME_ROWS, MOST_FIXED_ROWS, MOST_CATEGORIES, MOST_SPENDING_PER_MONTH,
	};
}
