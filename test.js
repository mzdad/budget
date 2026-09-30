// test.js - checks the maths in budget.js.
//
// Run it with:   node test.js
// It prints PASS or FAIL for each check and exits with an error if any fail.

const budget = require("./budget.js");

let failures = 0;

function check(name, actual, expected) {
	const same = JSON.stringify(actual) === JSON.stringify(expected);
	if (same) {
		console.log("PASS  " + name);
	} else {
		failures += 1;
		console.log("FAIL  " + name);
		console.log("      expected: " + JSON.stringify(expected));
		console.log("      got:      " + JSON.stringify(actual));
	}
}

// The Danish format puts a non-breaking space before "kr." - swap it for a
// normal space so the expected text in these checks is easy to read.
function plain(text) {
	return text.replace(/ /g, " ");
}


// --- Typed amounts ---
check("parse 49,95", budget.parseAmount("49,95"), 4995);
check("parse 49.95 (dot as decimal)", budget.parseAmount("49.95"), 4995);
check("parse 1.250 (dot as thousands)", budget.parseAmount("1.250"), 125000);
check("parse 1.250,50", budget.parseAmount("1.250,50"), 125050);
check("parse 12500", budget.parseAmount("12500"), 1250000);
check("parse with kr and spaces", budget.parseAmount(" 12 500 kr. "), 1250000);
check("parse 0,5", budget.parseAmount("0,5"), 50);
check("parse empty box is 0", budget.parseAmount(""), 0);
check("parse letters is unreadable", budget.parseAmount("abc"), null);
check("parse negative is unreadable", budget.parseAmount("-5"), null);
check("parse three decimals is unreadable", budget.parseAmount("1,234"), null);
check("parse 1,2,3 is unreadable", budget.parseAmount("1,2,3"), null);
check("parse far too big is unreadable", budget.parseAmount("99999999"), null);
check("parse 0,29 is exact", budget.parseAmount("0,29"), 29);
check("parse 1,15 is exact", budget.parseAmount("1,15"), 115);

// --- Showing amounts ---
check("format whole kroner", plain(budget.formatKr(1250000)), "12.500 kr.");
check("format with øre", plain(budget.formatKr(4995)), "49,95 kr.");
check("format zero", plain(budget.formatKr(0)), "0 kr.");
check("format negative", plain(budget.formatKr(-15000)), "-150 kr.");
check("input text for 0 is empty", budget.amountToInput(0), "");
check("input text for 4995", budget.amountToInput(4995), "49,95");
check("input text for 2000", budget.amountToInput(2000), "20");
check("input text round-trips", budget.parseAmount(budget.amountToInput(123456)), 123456);

// --- Months and dates ---
check("month key", budget.monthKeyOf(new Date(2026, 8, 30)), "2026-09");
check("date key pads the day", budget.dateKeyOf(new Date(2026, 0, 5)), "2026-01-05");
check("next month", budget.shiftMonth("2026-09", 1), "2026-10");
check("next month over new year", budget.shiftMonth("2026-12", 1), "2027-01");
check("previous month over new year", budget.shiftMonth("2027-01", -1), "2026-12");
check("month label", budget.monthLabel("2026-09"), "September 2026");
check("short month label", budget.shortMonthLabel("2026-09"), "sep. 2026");
check("day label",budget.dayLabel("2026-09-30"), "onsdag 30. september");
check("last day of september", budget.lastDayOfMonth("2026-09"), 30);
check("last day of february 2028 (leap)", budget.lastDayOfMonth("2028-02"), 29);
check("days left on the 30th of 30", budget.daysLeftInMonth("2026-09", new Date(2026, 8, 30)), 1);
check("days left on the 1st of 30", budget.daysLeftInMonth("2026-09", new Date(2026, 8, 1)), 30);
check("days left in another month is null", budget.daysLeftInMonth("2026-10", new Date(2026, 8, 30)), null);

// --- Copying a plan into a new month ---
const saved = {
	"2026-07": { income: [], fixed: [], savings: 0, categories: [], spending: [] },
	"2026-09": { income: [{ id: "a", name: "Løn", amount: 100 }], fixed: [], savings: 5, categories: [], spending: [{ id: "s", date: "2026-09-02", categoryId: "", amount: 9, note: "" }] },
};
check("new month copies the latest earlier month", budget.nearestMonthWithData(saved, "2026-10"), "2026-09");
check("new month between two copies the earlier", budget.nearestMonthWithData(saved, "2026-08"), "2026-07");
check("month before all copies the first later one", budget.nearestMonthWithData(saved, "2026-01"), "2026-07");
check("no saved months gives null", budget.nearestMonthWithData({}, "2026-01"), null);
const copied = budget.copyPlanOf(saved["2026-09"]);
check("copied plan keeps income", copied.income[0].amount, 100);
check("copied plan drops spending", copied.spending, []);
copied.income[0].amount = 999;
check("copy is separate from the original", saved["2026-09"].income[0].amount, 100);

// --- The summary ---
const month = {
	income: [{ id: "i1", name: "Løn", amount: 2500000 }, { id: "i2", name: "Børnepenge", amount: 100000 }],
	fixed: [{ id: "f1", name: "Husleje", amount: 900000 }, { id: "f2", name: "El", amount: 50000 }],
	savings: 200000,
	categories: [{ id: "mad", name: "Mad", limit: 300000 }, { id: "fri", name: "Fritid", limit: 100000 }],
	spending: [
		{ id: "1", date: "2026-09-01", categoryId: "mad", amount: 45050, note: "" },
		{ id: "2", date: "2026-09-02", categoryId: "mad", amount: 10000, note: "" },
		{ id: "3", date: "2026-09-02", categoryId: "fri", amount: 120000, note: "" },
		{ id: "4", date: "2026-09-03", categoryId: "gone", amount: 5000, note: "" },
	],
	startBalance: 1000000,
};
const s = budget.summarize(month);
check("income total", s.income, 2600000);
check("fixed total", s.fixed, 950000);
check("available = income - fixed - savings", s.available, 1450000);
check("limits total", s.limits, 400000);
check("unassigned = available - limits", s.unassigned, 1050000);
check("spent total", s.spent, 180050);
check("left = available - spent", s.left, 1269950);
check("mad spent", s.categories[0].spent, 55050);
check("mad left", s.categories[0].left, 244950);
check("fritid left goes negative", s.categories[1].left, -20000);
check("spending in a deleted category is kept", s.otherSpent, 5000);

// --- Bars ---
check("bar half full", budget.barShare(50, 100), 0.5);
check("bar never overflows", budget.barShare(250, 100), 1);
check("bar with no limit and no spending is empty", budget.barShare(0, 0), 0);
check("level ok", budget.barLevel(50, 100), "ok");
check("level close at 80%", budget.barLevel(80, 100), "close");
check("level exactly at limit is close, not over", budget.barLevel(100, 100), "close");
check("level over", budget.barLevel(101, 100), "over");
check("level nolimit", budget.barLevel(10, 0), "nolimit");

// --- Newest first ---
const ordered = budget.spendingNewestFirst([
	{ id: "a", date: "2026-09-01" },
	{ id: "b", date: "2026-09-03" },
	{ id: "c", date: "2026-09-03" },
	{ id: "d", date: "2026-09-02" },
]);
check("newest date first, later-added first within a day", ordered.map((x) => x.id), ["c", "b", "d", "a"]);

// --- Cleaning saved data ---
check("clean amount: text", budget.cleanAmount("abc"), 0);
check("clean amount: negative", budget.cleanAmount(-5), 0);
check("clean amount: decimals", budget.cleanAmount(12.6), 13);
check("clean amount: huge", budget.cleanAmount(1e15), 1000000000);
check("clean data: nonsense gives no months", budget.cleanData("hello"), { months: {} });
check("clean data: null gives no months", budget.cleanData(null), { months: {} });
const dirty = budget.cleanData({ months: { "2026-09": { income: "x", savings: "12", spending: [{ date: "nope" }, { date: "2026-09-01", amount: 5 }] }, "hello": {}, "2026-13": {} } });
check("clean data: only real month names survive", Object.keys(dirty.months), ["2026-09"]);
check("clean data: bad list becomes empty list", dirty.months["2026-09"].income, []);
check("clean data: savings read from text", dirty.months["2026-09"].savings, 12);
check("clean data: spending without a date is dropped", dirty.months["2026-09"].spending.length, 1);
const roundTrip = budget.cleanData(JSON.parse(JSON.stringify({ months: { "2026-09": month } })));
check("clean data: a good month comes back the same", roundTrip.months["2026-09"], month);

// Months too big for the online storage are cut down when read back, so they can always be saved.
const tooMany = [];
for (let i = 0; i < 2100; i++) {
	tooMany.push({ id: "s" + i, date: "2026-09-01", categoryId: "", amount: 1, note: "" });
}
const cut = budget.cleanMonth({ spending: tooMany });
check("clean month: spending cut to the limit", cut.spending.length, budget.MOST_SPENDING_PER_MONTH);
const manyRows = [];
for (let i = 0; i < 60; i++) {
	manyRows.push({ id: "r" + i, name: "x", amount: 1 });
}
check("clean month: income rows cut to the limit", budget.cleanMonth({ income: manyRows }).income.length, budget.MOST_INCOME_ROWS);

// --- Same data? (used to tell a change from another phone from an echo of our own) ---
const one = { months: { "2026-09": month } };
const reordered = JSON.parse(JSON.stringify(one));
reordered.months["2026-09"].spending = reordered.months["2026-09"].spending.map((row) => ({ note: row.note, amount: row.amount, categoryId: row.categoryId, date: row.date, id: row.id }));
reordered.months["2026-09"].updatedAt = "a timestamp from the online storage";
check("same data: field order and timestamps don't count", budget.sameData(one, reordered), true);
const changed = JSON.parse(JSON.stringify(one));
changed.months["2026-09"].spending[0].amount += 1;
check("same data: a changed amount counts", budget.sameData(one, changed), false);
check("same data: an extra month counts", budget.sameData(one, { months: { "2026-09": month, "2026-10": month } }), false);

// --- The money I have now (startBalance) ---
check("clean month: balance is kept", budget.cleanMonth({ startBalance: 1000000 }).startBalance, 1000000);
check("clean month: a month from before the balance existed gets 0", budget.cleanMonth({}).startBalance, 0);
check("clean month: negative balance becomes 0", budget.cleanMonth({ startBalance: -5 }).startBalance, 0);
check("a new month does not copy the balance", budget.copyPlanOf(month).startBalance, 0);

// --- Looking ahead ---
// month: income 26.000, fixed 9.500, savings 2.000, limits 4.000 (in kr), balance 10.000.
const future = budget.forecast(month, "2026-09", 12);
check("forecast: grows by income - fixed - limits each month", future.perMonth, 1250000);
check("forecast: careful version grows by the savings only", future.carefulPerMonth, 200000);
check("forecast: has 12 rows", future.rows.length, 12);
check("forecast: first row is the month itself", future.rows[0].key, "2026-09");
check("forecast: first month's total", future.rows[0].total, 2250000);
check("forecast: last row is 11 months later", future.lastKey, "2027-08");
check("forecast: money after 12 months", future.endTotal, 1000000 + 12 * 1250000);
check("forecast: careful money after 12 months", future.carefulEndTotal, 1000000 + 12 * 200000);
check("forecast: rows line up with the end total", future.rows[11].total, future.endTotal);
const tight = budget.forecast({ income: [{ id: "i", name: "", amount: 100000 }], fixed: [], savings: 50000, categories: [{ id: "c", name: "", limit: 200000 }], spending: [], startBalance: 0 }, "2026-09", 3);
check("forecast: limits above income make the money shrink", tight.perMonth, -100000);
check("forecast: careful is never more than the plain version", tight.carefulPerMonth, -100000);
check("forecast: can go negative", tight.endTotal, -300000);

// --- Spreadsheet text ---
check("csv amount: kroner and øre", budget.csvAmount(123456), "1234,56");
check("csv amount: zero", budget.csvAmount(0), "0,00");
check("csv amount: 5 øre", budget.csvAmount(5), "0,05");
check("csv amount: negative", budget.csvAmount(-15000), "-150,00");
check("csv amount: negative øre only", budget.csvAmount(-5), "-0,05");
check("csv text: plain", budget.csvText("Mad"), "Mad");
check("csv text: semicolon is quoted", budget.csvText("a;b"), '"a;b"');
check("csv text: quote is doubled", budget.csvText('say "hi"'), '"say ""hi"""');
check("csv text: a formula is defused", budget.csvText("=1+1"), "'=1+1");
check("csv text: a leading minus is defused", budget.csvText("-5 kr"), "'-5 kr");
check("csv text: a leading plus is defused", budget.csvText("+45 1234"), "'+45 1234");
check("csv text: Danish letters survive", budget.csvText("Smørrebrød og åbent"), "Smørrebrød og åbent");
check("date text", budget.dateText("2026-09-30"), "30.09.2026");

// --- Month report ---
const report = budget.monthReport(month, "2026-09");
check("month report: label", report.label, "September 2026");
check("month report: purchases oldest first", report.spending.map((x) => x.date), ["2026-09-01", "2026-09-02", "2026-09-02", "2026-09-03"]);
check("month report: same-day purchases keep their order", report.spending.map((x) => x.amount), [45050, 10000, 120000, 5000]);
check("month report: category names are looked up", report.spending.map((x) => x.category), ["Mad", "Mad", "Fritid", "Uden kategori"]);
const csv = budget.monthCsv(report).split("\r\n");
check("month csv: title", csv[0], "Budget;September 2026");
check("month csv: income line", csv[3], "Indkomst;26000,00");
check("month csv: left line", csv[8], "Tilbage;12699,50");
check("month csv: a purchase line", csv.includes("02.09.2026;Fritid;;1200,00"), true);
check("month csv: category line with overspending", csv.includes("Fritid;1000,00;1200,00;-200,00"), true);
check("month csv: no-category spending", csv.includes("Uden kategori;;50,00;"), true);

// --- Year report ---
const october = JSON.parse(JSON.stringify(month));
october.spending = [{ id: "o1", date: "2026-10-05", categoryId: "mad", amount: 20000, note: "Føtex; stor indkøb" }];
const twentyFive = JSON.parse(JSON.stringify(month));
twentyFive.spending = [];
const all = { "2026-09": month, "2026-10": october, "2027-01": twentyFive };
check("years with data", budget.yearsWithData(all), ["2026", "2027"]);
const year = budget.yearReport(all, "2026");
check("year report: only that year's months", year.monthKeys, ["2026-09", "2026-10"]);
check("year report: spent adds up", year.totals.spent, 180050 + 20000);
check("year report: income adds up", year.totals.income, 2 * 2600000);
check("year report: Mad adds across months", year.categories.find((c) => c.name === "Mad").total, 55050 + 20000);
check("year report: Mad per month", year.categories.find((c) => c.name === "Mad").perMonth, { "2026-09": 55050, "2026-10": 20000 });
check("year report: no-category spending has its own row", year.categories.find((c) => c.name === "Uden kategori").total, 5000);
check("year report: every purchase is listed", year.spending.length, 5);
const yearLines = budget.yearCsv(year).split("\r\n");
check("year csv: title", yearLines[0], "Budget;2026");
check("year csv: header", yearLines[3], "Måned;Indkomst;Faste udgifter;Opsparing;Til rådighed;Brugt;Tilbage");
check("year csv: total row", yearLines.includes("I alt;52000,00;19000,00;4000,00;29000,00;2000,50;26999,50"), true);
check("year csv: category matrix", yearLines.includes("Mad;550,50;200,00;750,50"), true);
check("year csv: a note with a semicolon is quoted", yearLines.some((l) => l.includes('"Føtex; stor indkøb"')), true);
check("year report of a year with no data is empty", budget.yearReport(all, "2030").rows, []);

// --- Starter month ---
const starter = budget.starterMonth();
check("starter has income rows", starter.income.length > 0, true);
check("starter ids are stable between calls", budget.starterMonth().fixed[0].id, starter.fixed[0].id);
check("starter amounts are 0", budget.summarize(starter).available, 0);

console.log("");
if (failures > 0) {
	console.log(failures + " check(s) FAILED");
	process.exit(1);
}
console.log("All checks passed");
