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
	balances: {},
	pots: [],
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

// --- Signing in on a device that has its own numbers (merging a month) ---
const accountSide = {
	income: [{ id: "i1", name: "Løn", amount: 2000000 }], fixed: [], savings: 0, startBalance: 0,
	categories: [{ id: "a-mad", name: "Mad og dagligvarer", limit: 300000 }, { id: "a-fri", name: "Fritid", limit: 100000 }],
	spending: [{ id: "p1", date: "2026-09-01", categoryId: "a-mad", amount: 10000, note: "på kontoen" }],
};
const deviceSide = {
	income: [{ id: "x1", name: "Andet navn", amount: 1 }], fixed: [], savings: 99, startBalance: 5,
	categories: [{ id: "d-mad", name: "  mad og DAGLIGVARER ", limit: 1 }, { id: "d-ferie", name: "Ferie", limit: 1 }, { id: "a-fri", name: "Fritid", limit: 1 }],
	spending: [
		{ id: "p1", date: "2026-09-01", categoryId: "a-mad", amount: 10000, note: "allerede på kontoen" },
		{ id: "q1", date: "2026-09-02", categoryId: "d-mad", amount: 4500, note: "samme navn, andet id" },
		{ id: "q2", date: "2026-09-03", categoryId: "d-ferie", amount: 9900, note: "kategori findes ikke på kontoen" },
		{ id: "q3", date: "2026-09-04", categoryId: "a-fri", amount: 100, note: "samme id som på kontoen" },
		{ id: "q4", date: "2026-09-05", categoryId: "slettet", amount: 1, note: "kategori slettet for længst" },
	],
};
const merged = budget.mergeDeviceMonth(accountSide, deviceSide);
check("merge: only purchases the account doesn't have are added", merged.added, 4);
check("merge: the account's own purchase is kept once", merged.month.spending.filter((x) => x.id === "p1").length, 1);
check("merge: the account's version of a shared purchase wins", merged.month.spending[0].note, "på kontoen");
check("merge: the account's plan stays (income)", merged.month.income, accountSide.income);
check("merge: the account's plan stays (savings)", merged.month.savings, 0);
check("merge: the account's plan stays (categories)", merged.month.categories, accountSide.categories);
check("merge: same category name -> the account's category", merged.month.spending.find((x) => x.id === "q1").categoryId, "a-mad");
check("merge: a category the account lacks -> no category", merged.month.spending.find((x) => x.id === "q2").categoryId, "");
check("merge: same category id is kept", merged.month.spending.find((x) => x.id === "q3").categoryId, "a-fri");
check("merge: a long-deleted category -> no category", merged.month.spending.find((x) => x.id === "q4").categoryId, "");
check("merge: the total is the sum", merged.month.spending.reduce((sum, x) => sum + x.amount, 0), 10000 + 4500 + 9900 + 100 + 1);
check("merge: the original account month is not changed", accountSide.spending.length, 1);
check("merge: merging twice adds nothing new", budget.mergeDeviceMonth(merged.month, deviceSide).added, 0);
const fullMonth = { ...accountSide, spending: tooMany.slice(0, 1999) };
check("merge: never goes over the most purchases in a month", budget.mergeDeviceMonth(fullMonth, deviceSide).month.spending.length, budget.MOST_SPENDING_PER_MONTH);
check("merge: says how many were really added when full", budget.mergeDeviceMonth(fullMonth, deviceSide).added, 1);

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

// A change of income: dagpenge (15.000 kr) in September, a new job (30.000 kr) from the October
// the user has set up. Fixed bills 5.000 and limits 4.000 stay the same. November isn't set up.
const benefits = { income: [{ id: "i", name: "Dagpenge", amount: 1500000 }], fixed: [{ id: "f", name: "Husleje", amount: 500000 }], savings: 0, categories: [{ id: "c", name: "Mad", limit: 400000 }], spending: [], startBalance: 0 };
const newJob = { ...benefits, income: [{ id: "i", name: "Løn", amount: 3000000 }] };
const changeOfIncome = budget.forecast(benefits, "2026-09", 4, { "2026-09": benefits, "2026-10": newJob });
check("income change: September uses its own plan", changeOfIncome.rows[0].added, 600000);
check("income change: October uses its own plan", changeOfIncome.rows[1].added, 2100000);
check("income change: November (not set up) repeats October", changeOfIncome.rows[2].added, 2100000);
check("income change: December repeats it too", changeOfIncome.rows[3].added, 2100000);
check("income change: the running total follows", changeOfIncome.rows.map((row) => row.total), [600000, 2700000, 4800000, 6900000]);
check("income change: says the months differ", changeOfIncome.varies, true);
check("income change: which months are set up", changeOfIncome.rows.map((row) => row.ownPlan), [true, true, false, false]);
const sameEveryMonth = budget.forecast(benefits, "2026-09", 4, { "2026-09": benefits });
check("no income change: says the months are alike", sameEveryMonth.varies, false);
check("forecast from October ignores September", budget.forecast(newJob, "2026-10", 3, { "2026-09": benefits, "2026-10": newJob }).rows.map((row) => row.added), [2100000, 2100000, 2100000]);
check("the month on screen wins over its saved copy", budget.forecast(newJob, "2026-09", 1, { "2026-09": benefits }).rows[0].added, 2100000);
check("forecast without saved months still repeats the plan", budget.forecast(benefits, "2026-09", 3).rows.map((row) => row.added), [600000, 600000, 600000]);

// --- Rows with a from / to date ---
const days = (row, key) => budget.activeDaysIn(row, key);
check("dates: no dates = every day of the month", days({}, "2026-10"), 31);
check("dates: from the 12th counts 20 of October's 31 days", days({ from: "2026-10-12" }, "2026-10"), 20);
check("dates: from the 12th of October counts nothing in September", days({ from: "2026-10-12" }, "2026-09"), 0);
check("dates: from the 12th of October counts all of November", days({ from: "2026-10-12" }, "2026-11"), 30);
check("dates: to the 11th counts 11 days of October", days({ to: "2026-10-11" }, "2026-10"), 11);
check("dates: to the 11th counts all of September", days({ to: "2026-10-11" }, "2026-09"), 30);
check("dates: to the 11th of October counts nothing in November", days({ to: "2026-10-11" }, "2026-11"), 0);
check("dates: from and to inside one month", days({ from: "2026-10-05", to: "2026-10-10" }, "2026-10"), 6);
check("dates: from and to on the same day", days({ from: "2026-10-05", to: "2026-10-05" }, "2026-10"), 1);
check("dates: from after to counts nothing", days({ from: "2026-10-20", to: "2026-10-10" }, "2026-10"), 0);
check("dates: the first and last day both count", days({ from: "2026-10-01", to: "2026-10-31" }, "2026-10"), 31);
check("dates: a leap February", days({ from: "2028-02-10" }, "2028-02"), 20);
check("dates: a range over several months, the middle one", days({ from: "2026-09-15", to: "2026-11-15" }, "2026-10"), 31);
check("dates: a range over several months, the first one", days({ from: "2026-09-15", to: "2026-11-15" }, "2026-09"), 16);

const dagpenge = { id: "d", name: "Dagpenge", amount: 1500000, to: "2026-10-11" };
const lon = { id: "l", name: "Løn", amount: 3000000, from: "2026-10-12" };
check("pro rata: dagpenge in October is 11/31", budget.amountIn(dagpenge, "2026-10"), 532258);
check("pro rata: løn in October is 20/31", budget.amountIn(lon, "2026-10"), 1935484);
check("pro rata: dagpenge in September is the whole amount", budget.amountIn(dagpenge, "2026-09"), 1500000);
check("pro rata: løn in November is the whole amount", budget.amountIn(lon, "2026-11"), 3000000);
check("pro rata: dagpenge in November is nothing", budget.amountIn(dagpenge, "2026-11"), 0);
check("pro rata: without a month the whole amount counts", budget.amountIn(dagpenge), 1500000);
check("pro rata: a row without dates always counts in full", budget.amountIn({ amount: 1234 }, "2026-10"), 1234);

// One plan for the whole change of job: dagpenge + løn, fixed bills 5.000, limits 4.000.
const oneJobPlan = { income: [dagpenge, lon], fixed: [{ id: "f", name: "Husleje", amount: 500000 }], savings: 0, categories: [{ id: "c", name: "Mad", limit: 400000 }], spending: [], startBalance: 0 };
check("one plan: September income is dagpenge only", budget.summarize(oneJobPlan, "2026-09").income, 1500000);
check("one plan: October income is the mix", budget.summarize(oneJobPlan, "2026-10").income, 532258 + 1935484);
check("one plan: November income is løn only", budget.summarize(oneJobPlan, "2026-11").income, 3000000);
check("one plan: no month given = everything counts", budget.summarize(oneJobPlan).income, 4500000);
const oneJobForecast = budget.forecast(oneJobPlan, "2026-09", 4, { "2026-09": oneJobPlan });
check("one plan: the forecast follows the change by itself", oneJobForecast.rows.map((row) => row.added), [600000, 2467742 - 900000, 2100000, 2100000]);
check("one plan: and the running total adds up", oneJobForecast.endTotal, 600000 + 1567742 + 2100000 + 2100000);
check("window text: from", budget.windowText(lon), "fra 12.10.2026");
check("window text: to", budget.windowText(dagpenge), "til 11.10.2026");
check("window text: both", budget.windowText({ from: "2026-10-05", to: "2026-11-01" }), "fra 05.10.2026 til 01.11.2026");
check("window text: none", budget.windowText({}), "");
const dated = budget.monthReport(oneJobPlan, "2026-10");
check("report: income rows say when they apply", dated.income.map((row) => row.name), ["Dagpenge (til 11.10.2026)", "Løn (fra 12.10.2026)"]);
check("report: income rows show what counts that month", dated.income.map((row) => row.amount), [532258, 1935484]);
check("report: the rows add up to the total", dated.income.reduce((sum, row) => sum + row.amount, 0), dated.summary.income);
const cleanedDates = budget.cleanMonth({ income: [{ id: "a", name: "x", amount: 1, from: "2026-10-12", to: "garbage" }], fixed: [{ id: "b", name: "y", amount: 1, to: "2026-10-11" }], categories: [{ id: "c", name: "z", limit: 1, from: "2026-10-12" }] });
check("clean: a good date is kept", cleanedDates.income[0].from, "2026-10-12");
check("clean: a bad date is dropped", "to" in cleanedDates.income[0], false);
check("clean: fixed bills keep dates too", cleanedDates.fixed[0].to, "2026-10-11");
check("clean: categories never have dates", "from" in cleanedDates.categories[0], false);
check("same data: a changed date counts", budget.sameData({ months: { "2026-10": oneJobPlan } }, { months: { "2026-10": { ...oneJobPlan, income: [{ ...dagpenge, to: "2026-10-12" }, lon] } } }), false);

// --- Bills that come every few months, or once a year ---
const yearly = { id: "y", name: "Forsikring", amount: 360000, every: 12, from: "2026-03-15" };
const quarterly = { id: "q", name: "Vand", amount: 90000, every: 3, from: "2026-01-01" };
const due = (row, key) => budget.amountIn(row, key);
check("yearly: due in the month of the first payment (only the month counts)", due(yearly, "2026-03"), 360000);
check("yearly: nothing in the months after", [due(yearly, "2026-04"), due(yearly, "2026-12"), due(yearly, "2027-02")], [0, 0, 0]);
check("yearly: nothing before the first payment", due(yearly, "2026-02"), 0);
check("yearly: due again a year later", due(yearly, "2027-03"), 360000);
check("yearly: due two years later", due(yearly, "2028-03"), 360000);
check("quarterly: due in January, April, July, October", ["2026-01", "2026-04", "2026-07", "2026-10"].map((key) => due(quarterly, key)), [90000, 90000, 90000, 90000]);
check("quarterly: not due in between", ["2026-02", "2026-03", "2026-05", "2026-09", "2026-12"].map((key) => due(quarterly, key)), [0, 0, 0, 0, 0]);
check("quarterly: rolls over the new year", due(quarterly, "2027-01"), 90000);
check("every 2nd month", budget.amountIn({ amount: 100, every: 2, from: "2026-01-10" }, "2026-03"), 100);
check("every 2nd month: the months between", budget.amountIn({ amount: 100, every: 2, from: "2026-01-10" }, "2026-02"), 0);
const endingQuarterly = { ...quarterly, to: "2026-07-31" };
check("ends: still due in the month of its last day", due(endingQuarterly, "2026-07"), 90000);
check("ends: not due after", due(endingQuarterly, "2026-10"), 0);
check("next due: from September", budget.nextDueKey(quarterly, "2026-09"), "2026-10");
check("next due: this month counts", budget.nextDueKey(quarterly, "2026-10"), "2026-10");
check("next due: a yearly bill before its first payment", budget.nextDueKey(yearly, "2025-06"), "2026-03");
check("next due: a yearly bill after this year's", budget.nextDueKey(yearly, "2026-04"), "2027-03");
check("next due: never again once it has ended", budget.nextDueKey(endingQuarterly, "2026-08"), null);
check("periodic: needs a first payment date", budget.isPeriodic({ amount: 1, every: 3 }), false);
check("periodic: every month is not periodic", budget.isPeriodic({ amount: 1, every: 1, from: "2026-01-01" }), false);
check("periodic: a bill without `every` counts in full every month", budget.amountIn({ amount: 500 }, "2026-05"), 500);
check("periodic: without a month the whole amount counts", budget.amountIn(yearly), 360000);
check("months between", budget.monthsBetween("2026-03", "2027-01"), 10);
check("every text", [2, 3, 6, 12].map(budget.everyText), ["hver 2. måned", "hver 3. måned", "hver 6. måned", "hvert år"]);
check("window text: a yearly bill", budget.windowText(yearly), "hvert år fra 15.03.2026");
check("window text: a quarterly bill that ends", budget.windowText(endingQuarterly), "hver 3. måned fra 01.01.2026 til 31.07.2026");
const withYearly = { income: [{ id: "i", name: "Løn", amount: 2000000 }], fixed: [{ id: "f", name: "Husleje", amount: 500000 }, yearly], savings: 0, categories: [{ id: "c", name: "Mad", limit: 400000 }], spending: [], startBalance: 0 };
check("summary: fixed bills in the month the yearly bill is due", budget.summarize(withYearly, "2026-03").fixed, 860000);
check("summary: fixed bills in other months", budget.summarize(withYearly, "2026-04").fixed, 500000);
const yearlyForecast = budget.forecast(withYearly, "2026-02", 3, { "2026-02": withYearly });
check("forecast: the yearly bill dips only the month it is due", yearlyForecast.rows.map((row) => row.added), [1100000, 740000, 1100000]);
check("report: the bill says how often it comes", budget.monthReport(withYearly, "2026-03").fixed.map((row) => row.name), ["Husleje", "Forsikring (hvert år fra 15.03.2026)"]);
check("report: and what counts that month", budget.monthReport(withYearly, "2026-04").fixed.map((row) => row.amount), [500000, 0]);
const cleanedEvery = budget.cleanMonth({
	income: [{ id: "a", name: "x", amount: 1, every: 3, from: "2026-01-01" }],
	fixed: [
		{ id: "b", name: "kept", amount: 1, every: 3, from: "2026-01-01" },
		{ id: "c", name: "no first payment", amount: 1, every: 3 },
		{ id: "d", name: "odd number", amount: 1, every: 5, from: "2026-01-01" },
		{ id: "e", name: "monthly", amount: 1, every: 1, from: "2026-01-01" },
	],
});
check("clean: a good `every` is kept on a fixed bill", cleanedEvery.fixed[0].every, 3);
check("clean: `every` without a first payment date is dropped", "every" in cleanedEvery.fixed[1], false);
check("clean: an unusual `every` is dropped", "every" in cleanedEvery.fixed[2], false);
check("clean: every 1 is not stored", "every" in cleanedEvery.fixed[3], false);
check("clean: income rows can come every few months too", cleanedEvery.income[0].every, 3);
const boernepenge = { id: "b", name: "Børnepenge", amount: 400000, every: 3, from: "2026-01-01" };
check("income every 3rd month (børnepenge): due in January", budget.amountIn(boernepenge, "2026-01"), 400000);
check("income every 3rd month: nothing in February", budget.amountIn(boernepenge, "2026-02"), 0);
check("income every 3rd month: due again in April", budget.amountIn(boernepenge, "2026-04"), 400000);
const withBoernepenge = { income: [{ id: "i", name: "Løn", amount: 2000000 }, boernepenge], fixed: [], savings: 0, categories: [], spending: [], startBalance: 0 };
check("income every 3rd month: counts in the total only when due", [budget.summarize(withBoernepenge, "2026-03").income, budget.summarize(withBoernepenge, "2026-04").income], [2000000, 2400000]);
check("income every 3rd month: the forecast follows", budget.forecast(withBoernepenge, "2026-03", 3, { "2026-03": withBoernepenge }).rows.map((row) => row.added), [2000000, 2400000, 2000000]);
check("income every 3rd month: the report says so", budget.monthReport(withBoernepenge, "2026-04").income.map((row) => row.name), ["Løn", "Børnepenge (hver 3. måned fra 01.01.2026)"]);

// --- Notes you have used before ---
const septemberWithNotes = {
	categories: [{ id: "mad", name: "Mad og dagligvarer", limit: 0 }, { id: "fri", name: "Fritid", limit: 0 }],
	spending: [
		{ id: "1", date: "2026-09-01", categoryId: "mad", amount: 100, note: "Rema 1000" },
		{ id: "2", date: "2026-09-05", categoryId: "mad", amount: 100, note: "rema 1000 " },
		{ id: "3", date: "2026-09-06", categoryId: "fri", amount: 100, note: "Biograf" },
		{ id: "4", date: "2026-09-07", categoryId: "", amount: 100, note: "Kiosk" },
		{ id: "5", date: "2026-09-08", categoryId: "mad", amount: 100, note: "   " },
		{ id: "6", date: "2026-09-09", categoryId: "mad", amount: 100, note: "" },
	],
};
const octoberWithNotes = {
	categories: [{ id: "o-mad", name: "mad og dagligvarer", limit: 0 }],
	spending: [
		{ id: "7", date: "2026-10-02", categoryId: "o-mad", amount: 100, note: "Netto" },
		{ id: "8", date: "2026-10-03", categoryId: "o-mad", amount: 100, note: "Biograf" },
		{ id: "9", date: "2026-10-04", categoryId: "o-mad", amount: 100, note: "Netto" },
		{ id: "10", date: "2026-10-05", categoryId: "o-mad", amount: 100, note: "Netto" },
	],
};
const history = budget.noteHistory({ "2026-09": septemberWithNotes, "2026-10": octoberWithNotes });
check("notes: one entry per note (capitals and spaces don't matter), most used first, a tie by most recent", history.map((entry) => entry.note), ["Netto", "Biograf", "rema 1000", "Kiosk"]);
check("notes: how many times each was used", history.map((entry) => entry.count), [3, 2, 2, 1]);
check("notes: the text is as it was written last", history.find((entry) => entry.lastDate === "2026-09-05").note, "rema 1000");
check("notes: blank notes are left out", history.some((entry) => entry.note.trim() === ""), false);
check("notes: the category of the latest use", history.find((entry) => entry.count === 2 && entry.note === "Biograf").categoryName, "mad og dagligvarer");
check("notes: no category gives an empty name", history.find((entry) => entry.note === "Kiosk").categoryName, "");
const octoberPlan = { categories: [{ id: "x-mad", name: "Mad og dagligvarer", limit: 0 }, { id: "x-fri", name: "Fritid", limit: 0 }] };
check("note -> category: matched by name, in this month's plan", budget.categoryIdForNote(history, "Netto", octoberPlan), "x-mad");
check("note -> category: capitals don't matter", budget.categoryIdForNote(history, "REMA 1000", octoberPlan), "x-mad");
check("note -> category: a new note gives nothing", budget.categoryIdForNote(history, "Føtex", octoberPlan), "");
check("note -> category: a note that had no category gives nothing", budget.categoryIdForNote(history, "Kiosk", octoberPlan), "");
check("note -> category: a category this month lacks gives nothing", budget.categoryIdForNote(history, "Netto", { categories: [{ id: "z", name: "Sundhed", limit: 0 }] }), "");
check("notes: no months, no suggestions", budget.noteHistory({}), []);

// --- A new category goes into the other months too ---
const catMonths = {
	"2026-09": { categories: [{ name: "Mad" }] },
	"2026-10": { categories: [{ name: "Mad" }, { name: "Tøj" }] },
	"2026-11": { categories: [{ name: "mad" }, { name: "tøj" }] },
};
check("share categories: the month that lacks one is found", budget.missingCategoryNames(catMonths, ["Mad", "Tøj"]), { "2026-09": ["Tøj"] });
check("share categories: nothing missing gives nothing", budget.missingCategoryNames(catMonths, ["Mad"]), {});
check("share categories: capitals and spaces don't matter", budget.missingCategoryNames(catMonths, ["  TØJ "]), { "2026-09": ["TØJ"] });
check("share categories: empty names are ignored", budget.missingCategoryNames(catMonths, ["", "   "]), {});
check("share categories: the same name twice counts once", budget.missingCategoryNames(catMonths, ["Tøj", "tøj"]), { "2026-09": ["Tøj"] });
check("share categories: a brand new name goes to every month", Object.keys(budget.missingCategoryNames(catMonths, ["Gaver"])), ["2026-09", "2026-10", "2026-11"]);
const fullMonths = { "2026-09": { categories: Array.from({ length: 50 }, (_, i) => ({ name: "k" + i })) } };
check("share categories: a month that already has the most categories gets none", budget.missingCategoryNames(fullMonths, ["Ny"]), {});
const almostFull = { "2026-09": { categories: Array.from({ length: 49 }, (_, i) => ({ name: "k" + i })) } };
check("share categories: a month with room for one gets only one", budget.missingCategoryNames(almostFull, ["A", "B"]), { "2026-09": ["A"] });

// --- Other people's money (Nathan's savings) ---
const potMonthA = { pots: [
	{ id: "p1", date: "2026-09-01", person: "Nathan", amount: 500000, note: "Start" },
	{ id: "p2", date: "2026-09-10", person: "Nathan", amount: -30000, note: "Legetøj" },
] };
const potMonthB = { pots: [
	{ id: "p3", date: "2026-10-03", person: "nathan", amount: 20000, note: "Lommepenge" },
	{ id: "p4", date: "2026-10-05", person: "Emma", amount: 100000, note: "Start" },
	{ id: "p5", date: "2026-10-06", person: "Nathan", amount: -150000, note: "Cykel" },
] };
const people = budget.potBalances({ "2026-10": potMonthB, "2026-09": potMonthA });
check("pots: one person per name, capitals don't matter", people.map((p) => p.person), ["Nathan", "Emma"]);
check("pots: Nathan has what he got minus what he used", people[0].balance, 500000 - 30000 + 20000 - 150000);
check("pots: Emma has her start amount", people[1].balance, 100000);
check("pots: newest entry first", people[0].entries.map((e) => e.note), ["Cykel", "Lommepenge", "Legetøj", "Start"]);
check("pots: everyone's money added together", budget.othersTotal({ "2026-10": potMonthB, "2026-09": potMonthA }), 340000 + 100000);
check("pots: nobody, nothing", budget.potBalances({ "2026-09": { pots: [] } }), []);
check("pots: a month from before pots existed is fine", budget.potBalances({ "2026-09": {} }), []);
check("pots: a person can go below zero (used more than they had)", budget.potBalances({ "2026-09": { pots: [{ id: "a", date: "2026-09-01", person: "X", amount: 100, note: "" }, { id: "b", date: "2026-09-02", person: "X", amount: -250, note: "" }] } })[0].balance, -150);
check("pots: a new person starting at 0 still exists", budget.potBalances({ "2026-09": { pots: [{ id: "a", date: "2026-09-01", person: "Ny", amount: 0, note: "Start" }] } }).length, 1);
check("pots: a new month starts without entries", budget.copyPlanOf({ ...month, pots: potMonthA.pots }).pots, []);
check("pots: the starter month has none", budget.starterMonth().pots, []);
const cleanedPots = budget.cleanMonth({ pots: [
	{ id: "a", date: "2026-09-01", person: "  Nathan  ", amount: -12.6, note: "x" },
	{ id: "b", date: "nope", person: "Nathan", amount: 1 },
	{ id: "c", date: "2026-09-01", person: "   ", amount: 1 },
	{ id: "d", date: "2026-09-01", person: "Nathan", amount: "abc" },
	{ id: "e", date: "2026-09-01", person: "Nathan", amount: 1e15 },
] }).pots;
check("clean pots: a good entry is tidied (name trimmed, amount rounded, negative kept)", cleanedPots[0], { id: "a", date: "2026-09-01", person: "Nathan", amount: -13, note: "x" });
check("clean pots: a bad date is dropped, and so is a blank name", cleanedPots.map((e) => e.id), ["a", "d", "e"]);
check("clean pots: text as amount becomes 0", cleanedPots[1].amount, 0);
check("clean pots: a huge amount is capped", cleanedPots[2].amount, 1000000000);
const manyPots = [];
for (let i = 0; i < 600; i++) {
	manyPots.push({ id: "m" + i, date: "2026-09-01", person: "N", amount: 1, note: "" });
}
check("clean pots: at most the limit per month", budget.cleanMonth({ pots: manyPots }).pots.length, budget.MOST_POT_ENTRIES_PER_MONTH);
const accountWithPots = { ...accountSide, pots: [{ id: "p1", date: "2026-09-01", person: "Nathan", amount: 500000, note: "Start" }] };
const deviceWithPots = { ...deviceSide, pots: [{ id: "p1", date: "2026-09-01", person: "Nathan", amount: 500000, note: "Start" }, { id: "p9", date: "2026-09-09", person: "Nathan", amount: -1000, note: "kun på enheden" }] };
const mergedPots = budget.mergeDeviceMonth(accountWithPots, deviceWithPots);
check("merge: a pot entry only on the device is added, one already there is not", mergedPots.month.pots.map((e) => e.id), ["p1", "p9"]);
check("merge: pot entries count as added", mergedPots.added, 4 + 1);
check("same data: a pot entry counts", budget.sameData({ months: { "2026-09": accountWithPots } }, { months: { "2026-09": { ...accountWithPots, pots: [] } } }), false);

// --- Udgifter split by category ---
const groupedMonth = {
	categories: [{ id: "mad", name: "Mad", limit: 0 }, { id: "fri", name: "Fritid", limit: 0 }, { id: "tom", name: "Tom", limit: 0 }, { id: "x", name: "", limit: 0 }],
	spending: [
		{ id: "1", date: "2026-09-01", categoryId: "mad", amount: 1000, note: "a" },
		{ id: "2", date: "2026-09-05", categoryId: "fri", amount: 500, note: "b" },
		{ id: "3", date: "2026-09-03", categoryId: "mad", amount: 2000, note: "c" },
		{ id: "4", date: "2026-09-03", categoryId: "mad", amount: 300, note: "d" },
		{ id: "5", date: "2026-09-02", categoryId: "", amount: 70, note: "e" },
		{ id: "6", date: "2026-09-04", categoryId: "deleted", amount: 80, note: "f" },
		{ id: "7", date: "2026-09-06", categoryId: "x", amount: 9, note: "g" },
	],
};
const groups = budget.spendingByCategory(groupedMonth);
check("by category: plan order, empty ones left out, no-category last", groups.map((g) => g.name), ["Mad", "Fritid", "(uden navn)", "Uden kategori"]);
check("by category: each group's total", groups.map((g) => g.total), [3300, 500, 9, 150]);
check("by category: newest day first, the same day latest added first", groups[0].items.map((i) => i.id), ["4", "3", "1"]);
check("by category: deleted and empty category ids go together under no category, newest first", groups[3].items.map((i) => i.id), ["6", "5"]);
check("by category: no purchases, no groups", budget.spendingByCategory({ categories: groupedMonth.categories, spending: [] }), []);
check("by category: nothing is lost", groups.reduce((sum, g) => sum + g.items.length, 0), groupedMonth.spending.length);

// --- Money now: Lønkonto and Opsparing ---
check("signed amount: plain number", budget.parseSignedAmount("1.250,50"), 125050);
check("signed amount: minus", budget.parseSignedAmount("-500"), -50000);
check("signed amount: minus with øre and a space", budget.parseSignedAmount(" - 49,95 "), -4995);
check("signed amount: the real minus sign", budget.parseSignedAmount("−200"), -20000);
check("signed amount: empty is 0", budget.parseSignedAmount(""), 0);
check("signed amount: minus zero is plain 0", Object.is(budget.parseSignedAmount("-0"), 0), true);
check("signed amount: a lone minus is unreadable", budget.parseSignedAmount("-"), null);
check("signed amount: letters are unreadable", budget.parseSignedAmount("-abc"), null);
check("signed amount: two minuses are unreadable", budget.parseSignedAmount("--5"), null);

const at = (day, hour) => new Date(2026, 9, day, hour, 0, 0).getTime();   // October 2026, local time
const nothing = { "2026-10": { balances: {}, pots: [] } };
check("money now: nothing typed means nothing", budget.moneyNow(nothing).any, false);
check("money now: nothing typed, total 0", budget.moneyNow(nothing).total, 0);
check("money now: a month from before it existed is fine", budget.moneyNow({ "2026-09": {} }).total, 0);

const typed = {
	"2026-10": {
		balances: { account: { amount: 1200000, at: at(1, 10) }, savings: { amount: 18000000, at: at(1, 10) } },
		pots: [],
	},
};
const both = budget.moneyNow(typed);
check("money now: account and savings added up", both.total, 1200000 + 18000000);
check("money now: each on its own", [both.accountNow, both.savingsNow], [1200000, 18000000]);
check("money now: only one typed still counts", budget.moneyNow({ "2026-10": { balances: { savings: { amount: 500, at: at(1, 10) } }, pots: [] } }).total, 500);
check("money now: an account can be overdrawn", budget.moneyNow({ "2026-10": { balances: { account: { amount: -30000, at: at(1, 10) } }, pots: [] } }).total, -30000);

// The newest number wins, whichever month it is saved in.
const twoTimes = {
	"2026-09": { balances: { savings: { amount: 100, at: at(1, 9) } }, pots: [] },
	"2026-10": { balances: { savings: { amount: 200, at: at(1, 10) } }, pots: [] },
};
check("money now: the newest typed number wins", budget.latestBalance(twoTimes, "savings").amount, 200);
check("money now: a number that was never typed is null", budget.latestBalance(twoTimes, "account"), null);

// The kids move the savings, but only what happens AFTER the number was typed.
const withKids = (pots) => ({ "2026-10": { balances: typed["2026-10"].balances, pots: pots } });
const used = { id: "u", date: "2026-10-02", person: "Nathan", amount: -30000, note: "", at: at(2, 12) };
const got = { id: "g", date: "2026-10-03", person: "Nathan", amount: 15000, note: "", at: at(3, 12) };
check("kids: Nathan used money -> the savings go down", budget.moneyNow(withKids([used])).savingsNow, 18000000 - 30000);
check("kids: Nathan got money -> the savings go up", budget.moneyNow(withKids([got])).savingsNow, 18000000 + 15000);
check("kids: both together", budget.moneyNow(withKids([used, got])).savingsNow, 18000000 - 30000 + 15000);
check("kids: the account does not move", budget.moneyNow(withKids([used, got])).accountNow, 1200000);
check("kids: what they changed is reported", budget.moneyNow(withKids([used, got])).fromKids, -15000);
check("kids: the total follows", budget.moneyNow(withKids([used])).total, 1200000 + 18000000 - 30000);
check("kids: the start entry is money already in the pile, it never counts", budget.moneyNow(withKids([{ id: "s", date: "2026-10-05", person: "Nathan", amount: 500000, note: "Start", at: at(5, 9), start: true }])).savingsNow, 18000000);
check("kids: the same day, written down after typing, counts", budget.moneyNow(withKids([{ id: "x", date: "2026-10-01", person: "N", amount: -1000, note: "", at: at(1, 11) }])).savingsNow, 18000000 - 1000);
check("kids: the same day, but written down BEFORE typing, is already in the number", budget.moneyNow(withKids([{ id: "x", date: "2026-10-01", person: "N", amount: -1000, note: "", at: at(1, 9) }])).savingsNow, 18000000);
check("kids: written down later but dated an earlier day, already in the number", budget.moneyNow(withKids([{ id: "x", date: "2026-09-28", person: "N", amount: -1000, note: "", at: at(2, 9) }])).savingsNow, 18000000);
check("kids: an old entry (no moment) on a later day counts", budget.moneyNow(withKids([{ id: "x", date: "2026-10-02", person: "N", amount: -1000, note: "" }])).savingsNow, 18000000 - 1000);
check("kids: an old entry on the same day does not", budget.moneyNow(withKids([{ id: "x", date: "2026-10-01", person: "N", amount: -1000, note: "" }])).savingsNow, 18000000);
check("kids: entries in another month count too", budget.moneyNow({ ...withKids([]), "2026-11": { pots: [{ id: "x", date: "2026-11-02", person: "N", amount: -2000, note: "", at: at(40, 9) }] } }).savingsNow, 18000000 - 2000);
check("kids: typing the real number again replaces the calculated one", budget.moneyNow({
	"2026-10": { balances: { savings: { amount: 17900000, at: at(4, 8) } }, pots: [used, got] },
}).savingsNow, 17900000);
check("kids: no savings number typed means nothing to move", budget.moneyNow({ "2026-10": { balances: { account: { amount: 5, at: at(1, 10) } }, pots: [used] } }).total, 5);
check("kids: deleting the entry puts it back", budget.moneyNow(withKids([used, got])).savingsNow - budget.moneyNow(withKids([got])).savingsNow, -30000);

// Fremtid starts from the total.
const plainPlan = { income: [{ id: "i", name: "Løn", amount: 2000000 }], fixed: [], savings: 0, categories: [], spending: [], startBalance: 7777 };
check("forecast: starts from the given total", budget.forecast(plainPlan, "2026-10", 1, {}, 123456).start, 123456);
check("forecast: the month's own balance is used when no total is given", budget.forecast(plainPlan, "2026-10", 1, {}).start, 7777);
check("forecast: a given total of 0 is respected", budget.forecast(plainPlan, "2026-10", 1, {}, 0).endTotal, 2000000);
check("forecast: given total is the starting line of the sum", budget.forecast(plainPlan, "2026-10", 2, {}, 500).endTotal, 500 + 2 * 2000000);

// Cleaning and keeping the numbers.
check("clean balances: good ones come back the same", budget.cleanBalances(typed["2026-10"].balances), typed["2026-10"].balances);
check("clean balances: junk gives nothing", budget.cleanBalances("x"), {});
check("clean balances: a missing moment drops the number", budget.cleanBalances({ account: { amount: 5 } }), {});
check("clean balances: text as amount drops it", budget.cleanBalances({ account: { amount: "abc", at: 5 } }), {});
check("clean balances: a moment far in the future drops it", budget.cleanBalances({ account: { amount: 5, at: 1e15 } }), {});
check("clean balances: negative is kept", budget.cleanBalances({ account: { amount: -5, at: 5 } }), { account: { amount: -5, at: 5 } });
check("clean balances: a huge number is capped", budget.cleanBalances({ account: { amount: 1e15, at: 5 } }).account.amount, 1000000000);
check("clean balances: other names are left out", budget.cleanBalances({ hacker: { amount: 5, at: 5 } }), {});
check("clean month: balances survive", budget.cleanMonth({ balances: typed["2026-10"].balances }).balances, typed["2026-10"].balances);
check("clean month: no balances gives an empty object", budget.cleanMonth({}).balances, {});
check("a new month does not copy the numbers", budget.copyPlanOf({ ...month, balances: typed["2026-10"].balances }).balances, {});
check("the starter month has none", budget.starterMonth().balances, {});
check("clean pots: the moment and the start mark are kept", budget.cleanMonth({ pots: [{ id: "a", date: "2026-10-01", person: "N", amount: 5, note: "", at: at(1, 9), start: true }] }).pots[0], { id: "a", date: "2026-10-01", person: "N", amount: 5, note: "", at: at(1, 9), start: true });
check("clean pots: a bad moment is left out", "at" in budget.cleanMonth({ pots: [{ id: "a", date: "2026-10-01", person: "N", amount: 5, note: "", at: "nope" }] }).pots[0], false);
check("clean pots: start has to be exactly true", "start" in budget.cleanMonth({ pots: [{ id: "a", date: "2026-10-01", person: "N", amount: 5, note: "", start: "yes" }] }).pots[0], false);
check("same data: a balance counts", budget.sameData({ months: { "2026-10": month } }, { months: { "2026-10": { ...month, balances: typed["2026-10"].balances } } }), false);

// Signing in on a device with its own numbers: the newer balance wins, per number.
const accountWithMoney = { ...accountSide, balances: { account: { amount: 1, at: at(1, 10) }, savings: { amount: 2, at: at(5, 10) } } };
const deviceWithMoney = { ...deviceSide, balances: { account: { amount: 3, at: at(2, 10) }, savings: { amount: 4, at: at(4, 10) } } };
const mergedMoney = budget.mergeDeviceMonth(accountWithMoney, deviceWithMoney);
check("merge: the newer account number wins", mergedMoney.month.balances.account.amount, 3);
check("merge: the older device number loses", mergedMoney.month.balances.savings.amount, 2);
check("merge: a number taken from the device counts as added", mergedMoney.added, 4 + 1);
check("merge: a device number the account lacks is added", budget.mergeDeviceMonth(accountSide, deviceWithMoney).month.balances.account.amount, 3);
check("merge: no numbers anywhere is fine", budget.mergeDeviceMonth(accountSide, deviceSide).month.balances, {});

// --- The kids' own page (a private link) ---
const randomA = Array.from({ length: 24 }, (_, i) => i * 10);
const randomB = Array.from({ length: 24 }, (_, i) => 255 - i);
const tokenA = budget.makeKidToken(randomA);
check("kid token: 24 letters and digits", /^[a-z0-9]{24}$/.test(tokenA), true);
check("kid token: the same random numbers give the same token", budget.makeKidToken(randomA), tokenA);
check("kid token: other random numbers give another token", budget.makeKidToken(randomB) !== tokenA, true);
check("kid token: the highest numbers still give letters and digits", /^[a-z0-9]{24}$/.test(budget.makeKidToken(new Array(24).fill(255))), true);
check("kid link: the page address, the account and the token", budget.kidLink("https://mzdad.github.io/budget/", "mama", tokenA), "https://mzdad.github.io/budget/?kid=mama." + tokenA);
check("kid link: it reads back", budget.parseKidKey("mama." + tokenA), { parent: "mama", token: tokenA });
check("kid link: a username with - and _ and digits", budget.parseKidKey("mo_ma-2." + tokenA).parent, "mo_ma-2");
check("kid link: no dot is not a link", budget.parseKidKey("mama" + tokenA), null);
check("kid link: a second dot is not a link", budget.parseKidKey("mama." + tokenA + ".x"), null);
check("kid link: capitals in the token", budget.parseKidKey("mama." + tokenA.toUpperCase()), null);
check("kid link: a token that is too short", budget.parseKidKey("mama.abc123"), null);
check("kid link: a username that is too short", budget.parseKidKey("ma." + tokenA), null);
check("kid link: nothing", budget.parseKidKey(null), null);
check("kid link: empty text", budget.parseKidKey(""), null);

const parentMonths = { "2026-09": { pots: [
	{ id: "a", date: "2026-09-01", person: "Nathan", amount: 500000, note: "Start", start: true },
	{ id: "b", date: "2026-09-05", person: "nathan ", amount: -30000, note: "" },
	{ id: "c", date: "2026-09-06", person: "Emma", amount: 10000, note: "" },
] }, "2026-10": {} };
check("parent side: what the parent has written for one kid (capitals and spaces don't matter)", budget.parentSideOf(parentMonths, "Nathan"), 470000);
check("parent side: another kid", budget.parentSideOf(parentMonths, "emma"), 10000);
check("parent side: a kid with nothing", budget.parentSideOf(parentMonths, "Ingen"), 0);

check("kid entry: a good one", budget.cleanKidEntry("e1", { date: "2026-10-02", amount: -4500, note: "Is", at: 1790000000000 }), { id: "e1", date: "2026-10-02", amount: -4500, note: "Is", at: 1790000000000 });
check("kid entry: money added is not allowed", budget.cleanKidEntry("e1", { date: "2026-10-02", amount: 4500, note: "", at: 1 }), null);
check("kid entry: 0 is not allowed", budget.cleanKidEntry("e1", { date: "2026-10-02", amount: 0, note: "", at: 1 }), null);
check("kid entry: text as amount", budget.cleanKidEntry("e1", { date: "2026-10-02", amount: "abc", note: "", at: 1 }), null);
check("kid entry: a bad date", budget.cleanKidEntry("e1", { date: "i dag", amount: -5, note: "", at: 1 }), null);
check("kid entry: not an object", budget.cleanKidEntry("e1", "x"), null);
check("kid entry: a long note is cut", budget.cleanKidEntry("e1", { date: "2026-10-02", amount: -5, note: "x".repeat(300), at: 1 }).note.length, 100);
check("kid entry: a missing moment becomes 0", budget.cleanKidEntry("e1", { date: "2026-10-02", amount: -5, note: "" }).at, 0);
check("kid entry: a huge amount is capped", budget.cleanKidEntry("e1", { date: "2026-10-02", amount: -1e15, note: "", at: 1 }).amount, -1000000000);

const kidWrote = [
	{ token: tokenA, person: "Nathan", id: "k1", date: "2026-10-02", amount: -4500, note: "Is", at: at(2, 12) },
	{ token: tokenA, person: "Nathan", id: "k2", date: "2026-11-03", amount: -1000, note: "", at: at(40, 12) },
];
const parentOnly = { "2026-09": parentMonths["2026-09"] };
const together = budget.withKidEntries(parentOnly, kidWrote);
check("with kid entries: nothing written gives the same months back", budget.withKidEntries(parentOnly, []), parentOnly);
check("with kid entries: the real months are not changed", parentOnly["2026-09"].pots.length, 3);
check("with kid entries: a month the kid wrote in appears", Object.keys(together).sort(), ["2026-09", "2026-10", "2026-11"]);
check("with kid entries: the entry carries who wrote it", together["2026-10"].pots[0].kidToken, tokenA);
check("with kid entries: Nathan has his own and what he wrote", budget.potBalances(together).find((p) => p.person === "Nathan").balance, 470000 - 4500 - 1000);
check("with kid entries: the history says which entries the kid wrote", budget.potBalances(together).find((p) => p.person === "Nathan").entries.filter((e) => e.kidToken).map((e) => e.id), ["k2", "k1"]);
check("with kid entries: all kids added together", budget.othersTotal(together), 470000 - 5500 + 10000);
const withMonthKept = budget.withKidEntries({ "2026-10": { pots: [{ id: "p", date: "2026-10-01", person: "Nathan", amount: 100, note: "" }], balances: typed["2026-10"].balances } }, kidWrote.slice(0, 1));
check("with kid entries: a month the parent already has keeps its numbers and gets the entry", [withMonthKept["2026-10"].pots.length, withMonthKept["2026-10"].balances === typed["2026-10"].balances], [2, true]);
// Opsparing follows what the kid writes, just like what the parent writes.
const savingsAndKid = budget.withKidEntries({ "2026-10": { balances: typed["2026-10"].balances, pots: [] } }, [
	{ token: tokenA, person: "Nathan", id: "k1", date: "2026-10-02", amount: -4500, note: "", at: at(2, 12) },
	{ token: tokenA, person: "Nathan", id: "k0", date: "2026-10-01", amount: -777, note: "", at: at(1, 9) },
]);
check("kid entries move Opsparing when written after the number was typed, and not before", budget.moneyNow(savingsAndKid).savingsNow, 18000000 - 4500);
check("kid entries: the kid's page total is the parent side plus what the kid wrote", 470000 + kidWrote.reduce((sum, entry) => sum + entry.amount, 0), 470000 - 5500);

// --- Reading the bank's list from a picture (the text the reader found) ---
const bankToday = new Date(2026, 9, 1);   // 1 October 2026
const bankParse = (text, monthKey) => budget.parseBankText(text, monthKey || "2026-09", bankToday);
const bankRowsOf = (text) => bankParse(text).lines.map((line) => [line.date, line.note, line.ore, line.sign]);

check("bank text: a heading with a date counts for the lines under it", bankRowsOf(
	"Posteringer\nTirsdag 30. september\nNETTO ÅRHUS C            -123,45 kr.\nMad og dagligvarer\nRema 1000    -45,00 kr.\n29. sep.\nSpotify -99,00 kr."), [
	["2026-09-30", "NETTO ÅRHUS C", 12345, -1],
	["2026-09-30", "Rema 1000", 4500, -1],
	["2026-09-29", "Spotify", 9900, -1],
]);
check("bank text: a date at the start of every line, in four writings", bankRowsOf(
	"30-09-2026 Netto -45,00\n29/09 Kiosken -12,50\n28.09.2026 Apotek 129,95\n27.09 14:32 Cafe Smørrebrød -88,00 DKK"), [
	["2026-09-30", "Netto", 4500, -1],
	["2026-09-29", "Kiosken", 1250, -1],
	["2026-09-28", "Apotek", 12995, 0],
	["2026-09-27", "Cafe Smørrebrød", 8800, -1],
]);
check("bank text: the long minus, a plus, and thousands dots", bankRowsOf("30. sep.\nFøtex −1.234,50 kr.\nLøn +25.000,00 kr."), [
	["2026-09-30", "Føtex", 123450, -1],
	["2026-09-30", "Løn", 2500000, 1],
]);
check("bank text: a dot instead of the decimal comma still reads", bankRowsOf("30. sep.\nBageren 45.00 kr.")[0][2], 4500);
check("bank text: no decimals needs a sign or kr", bankRowsOf("30. sep.\nA -45\nB 12 kr.\nC 77").map((row) => row[1]), ["A", "B"]);
check("bank text: a bare number (Rema 1000) is not an amount, and not a problem", bankParse("30. sep.\nRema 1000"), { lines: [], unclear: [] });
check("bank text: i dag and i går use today's date", budget.parseBankText("I dag\nA -1,00 kr.\nI går\nB -2,00 kr.", "2026-10", bankToday).lines.map((line) => line.date), ["2026-10-01", "2026-09-30"]);
check("bank text: a year in the date wins over the month on screen", bankRowsOf("30. sep. 2025\nA -1,00 kr.")[0][0], "2025-09-30");
check("bank text: a month's long name and capitals", bankRowsOf("TIRSDAG 30. SEPTEMBER 2026\nA -1,00 kr.")[0][0], "2026-09-30");
check("bank text: a balance or a total is not a purchase", bankRowsOf("30. sep.\nSaldo 12.345,67 kr.\nI alt -500,00 kr.\nSpotify -99,00 kr.").map((row) => row[1]), ["Spotify"]);
check("bank text: a shop's little picture in front is dropped", bankRowsOf("30. sep.\n© Netto -45,00 kr.")[0][1], "Netto");
check("bank text: no date anywhere -> not read, listed", bankParse("Netto -45,00 kr."), { lines: [], unclear: ["Netto -45,00 kr."] });
check("bank text: a damaged amount is listed, the rest is read", bankParse("30. sep.\nNetto -45,0O kr.\nBageren -22,00 kr."), {
	lines: [{ date: "2026-09-30", note: "Bageren", ore: 2200, sign: -1, raw: "Bageren -22,00 kr.", bare: false, guess: false }],
	unclear: ["Netto -45,0O kr."],
});
check("bank text: an impossible date is listed, and the lines under it get no date", bankParse("31. sep.\nA -10,00 kr."), { lines: [], unclear: ["31. sep.", "A -10,00 kr."] });
check("bank text: 0 kr is listed", bankParse("30. sep.\nA 0,00 kr.").unclear, ["A 0,00 kr."]);
check("bank text: empty text", bankParse(""), { lines: [], unclear: [] });
check("bank text: a time at the front of a line is not part of the note", bankRowsOf("30. sep.\n14:32 Netto -45,00 kr.")[0][1], "Netto");

// A comma the reader lost: amounts of a list that nearly all have two decimals, and one that has none.
const lostComma = bankParse("30. sep.\nA -64,50\nB -154,99\nC -19,39\nD -14895\nE -2.000,00");
check("bank text: a comma the reader lost is put back, and the line says so", lostComma.lines.map((line) => [line.note, line.ore, line.guess]), [["A", 6450, false], ["B", 15499, false], ["C", 1939, false], ["D", 14895, true], ["E", 200000, false]]);
check("bank text: no repair in a short list", bankParse("30. sep.\nA -64,50\nB -14895").lines.map((line) => line.ore), [6450, 1489500]);
check("bank text: no repair when the amount says kr", bankParse("30. sep.\nA -64,50\nB -154,99\nC -19,39\nD -14895 kr.\nE -88,85").lines.map((line) => line.ore), [6450, 15499, 1939, 1489500, 8885]);
check("bank text: no repair when few amounts have decimals (a list in whole kroner)", bankParse("30. sep.\nA -64\nB -154\nC -19\nD -148\nE -88,85").lines.map((line) => line.ore), [6400, 15400, 1900, 14800, 8885]);
check("bank plan: a repaired amount stays chosen but says 'check'", budget.planBankImport("30. sep.\nA -64,50\nB -154,99\nC -19,39\nD -14895\nE -2.000,00", "2026-09", bankToday, { categories: [], spending: [] }, []).rows.map((row) => [row.amount, row.tick, row.why]), [[6450, true, ""], [15499, true, ""], [1939, true, ""], [14895, true, "check"], [200000, true, ""]]);

// --- A bank list laid out in columns (the date at the left, the amount at the right with the balance under it) ---
// What the three readings of a picture like that look like, made by rule from a table of rows.
const columnRows = [
	// [day, name, the amount as the whole page reading saw it (comma lost, no sign), the amount column's reading, red, the balance]
	[null, "Forretning: PAYPAL", "-6450", "-64,50", true, "8.399,47"],
	[null, "REMA1000 HASSELAG", "-15499", "-154,99", true, "8.463,97"],
	["29", "Forretning: PAYPAL *STEAM GAMES", "-1939", "-19,39", true, "8.618,96"],
	[null, "Forretning: Tesla_DK", "-2000,00", "-2.000,00", true, "8.773,15"],
	[null, "REMA1000 HASSELAG", "-88,85", "6,90", true, "10.773,15"],   // (the minus not read, but it is red)
	["28", "BRF SB KOLIND", "-59,00", "-59,00", true, "11.197,43"],
	[null, "Forretning: PAYPAL *DISCORD", "934", "9,34", false, "11.992,38"],   // (black: money in)
	["24", "NETTO KOLT 7137", "-18285", "-182,85", true, "12.112,36"],
];
function columnReadings() {
	const word = (text, x0, y0, x1, y1, extra) => Object.assign({ text: text, x0: x0, y0: y0, x1: x1, y1: y1 }, extra || {});
	const main = [];
	const amounts = [];
	const dates = [];
	columnRows.forEach((row, index) => {
		const top = 24 + 48 * index;
		if (row[0] !== null) {
			main.push(word("æ", 28, top - 9, 50, top + 16));   // the date column, as the whole page reading garbles it
			dates.push(word(row[0], 28, top - 9, 44, top + 2), word("SEP", 29, top + 8, 50, top + 16));
		}
		row[1].split(" ").forEach((piece, at) => main.push(word(piece, 94 + 60 * at, top, 94 + 60 * at + 54, top + 11)));
		main.push(word(row[2], 765, top - 7, 815, top + 7));
		main.push(word("0", 831, top - 4, 844, top + 9));   // the little tick box
		main.push(word(row[5], 768, top + 14, 815, top + 24));
		amounts.push(word(row[3], 765, top - 7, 815, top + 7, { red: row[4] }));
		amounts.push(word(row[5], 768, top + 14, 815, top + 24, { red: false }));
	});
	return { main: main, amounts: amounts, dates: dates, columns: budget.bankColumns(main, 858) };
}
const columnPicture = columnReadings();
check("columns: the amount column is found where the numbers end, left of the tick boxes", [columnPicture.columns.amounts.x0 < 765, columnPicture.columns.amounts.x1 > 815 && columnPicture.columns.amounts.x1 < 831], [true, true]);
check("columns: the date column is the space left of the names", [columnPicture.columns.left.x0, columnPicture.columns.left.x1 > 50 && columnPicture.columns.left.x1 < 94], [0, true]);
const columnText = budget.assembleBankText(columnPicture.main, columnPicture.columns, columnPicture.amounts, columnPicture.dates);
check("columns: put together, a date on a line of its own, then 'name  amount' for each purchase", columnText.split("\n").map((line) => line.replace(/ {2,}/g, "  |  ")), [
	"Forretning: PAYPAL  |  -64,50",
	"REMA1000 HASSELAG  |  -154,99",
	"29 SEP",
	"Forretning: PAYPAL *STEAM GAMES  |  -19,39",
	"Forretning: Tesla_DK  |  -2.000,00",
	"REMA1000 HASSELAG  |  -6,90",
	"28 SEP",
	"BRF SB KOLIND  |  -59,00",
	"Forretning: PAYPAL *DISCORD  |  9,34",
	"24 SEP",
	"NETTO KOLT 7137  |  -182,85",
]);
const columnPlan = budget.planBankImport(columnText, "2026-09", bankToday, { categories: [], spending: [] }, []);
check("columns: the red costs are purchases, the black number is money in, the balances are left out", columnPlan.rows.map((row) => [row.date, row.note, row.amount, row.why]), [
	["2026-09-29", "PAYPAL *STEAM GAMES", 1939, ""],
	["2026-09-29", "Tesla DK", 200000, ""],
	["2026-09-29", "REMA1000 HASSELAG", 690, ""],
	["2026-09-28", "BRF SB KOLIND", 5900, ""],
	["2026-09-28", "PAYPAL *DISCORD", 934, "money-in"],
	["2026-09-24", "NETTO KOLT 7137", 18285, ""],
]);
check("columns: the lines above the first date are listed as unclear, with their amounts", columnPlan.unclear, ["Forretning: PAYPAL -64,50", "REMA1000 HASSELAG -154,99"]);
check("columns: a red number whose minus was lost is still a cost", columnPlan.rows[2].why === "" && columnPlan.rows[2].amount === 690, true);

// the small parts
const w = (text, x0, y0, x1, y1, extra) => Object.assign({ text: text, x0: x0, y0: y0, x1: x1, y1: y1 }, extra || {});
check("columns: an ordinary list (amounts after the names, on the same line) has no amount column", budget.bankColumns([w("Netto", 40, 100, 100, 130), w("-45,00", 700, 100, 800, 130), w("Rema", 40, 220, 100, 250), w("-12,50", 650, 220, 780, 250), w("Føtex", 40, 340, 110, 370), w("-99,00", 720, 340, 815, 370)], 1080).amounts, null);
check("columns: a list with its names at the left edge has no date column", budget.bankColumns([w("Netto", 40, 100, 140, 130), w("Rema1000", 40, 220, 160, 250), w("Føtex", 40, 340, 140, 370)], 1080).left, null);
check("columns: the biggest number beside a line is the amount, the small one under it is the balance", budget.assembleBankText(
	[w("Kiosken", 94, 100, 150, 111)], { amounts: { x0: 700, x1: 820 }, left: null },
	[w("12.345,67", 770, 88, 815, 98), w("45,00", 780, 100, 815, 114)], []), "Kiosken   45,00");
check("columns: with the same size, a red number wins over a black one", budget.assembleBankText(
	[w("Kiosken", 94, 100, 150, 111)], { amounts: { x0: 700, x1: 820 }, left: null },
	[w("20,00", 780, 97, 815, 111, { red: false }), w("45,00", 780, 117, 815, 131, { red: true })], []), "Kiosken   -45,00");
check("columns: a sign the reader found as a word of its own is joined to its number", budget.assembleBankText(
	[w("Kiosken", 94, 100, 150, 111)], { amounts: { x0: 700, x1: 820 }, left: null },
	[w("-", 770, 100, 777, 111), w("45,00", 781, 97, 815, 111)], []), "Kiosken   -45,00");
check("columns: the stray dot the reader sometimes adds is dropped", budget.assembleBankText(
	[w("Kiosken", 94, 100, 150, 111)], { amounts: { x0: 700, x1: 820 }, left: null },
	[w("-249,.45", 770, 97, 815, 111)], []), "Kiosken   -249,45");
check("columns: a line with no amount, in a list where the others have one, is marked so it is listed", budget.assembleBankText(
	[w("A", 94, 100, 150, 111), w("B", 94, 148, 150, 159), w("C", 94, 196, 150, 207), w("D", 94, 244, 150, 255)], { amounts: { x0: 700, x1: 820 }, left: null },
	[w("-1,00", 780, 97, 815, 111), w("-2,00", 780, 145, 815, 159), w("-4,00", 780, 241, 815, 255)], []), "A   -1,00\nB   -2,00\nC [?]\nD   -4,00");
check("columns: a marked line comes back as unclear, without the mark", bankParse("30. sep.\nA -1,00\nC [?]").unclear, ["C"]);
check("columns: a month name in the date column ('OKT') and a day with a dot ('3.')", budget.assembleBankText(
	[w("Kiosken", 94, 100, 150, 111)], { amounts: null, left: { x0: 0, x1: 85 } }, [],
	[w("3.", 28, 95, 44, 106), w("OKT", 29, 112, 50, 120)]), "3 OKT\nKiosken");

// The amount column is read twice, at two sizes; the two readings are put together.
const reading = (text, y, extra) => Object.assign({ text: text, x0: 770, y0: y, x1: 815, y1: y + 14 }, extra || {});
const readTogether = (first, second) => budget.reconcileAmountReadings(first, second).map((word) => [word.text, Boolean(word.unsure), Boolean(word.red)]);
check("two readings: the same number both times is kept as it is", readTogether([reading("-64,50", 20, { red: true })], [reading("-64,50", 21, { red: true })]), [["-64,50", false, true]]);
check("two readings: a minus only one of them found is kept", readTogether([reading("64,50", 20, { red: true })], [reading("-64,50", 21, { red: true })]), [["-64,50", false, true]]);
check("two readings: when only one is a proper amount (a comma and two decimals), that one wins", readTogether([reading("-6450", 20)], [reading("-64,50", 21)]), [["-64,50", false, false]]);
check("two readings: ...whichever reading it was", readTogether([reading("-64,50", 20)], [reading("-6450", 21)]), [["-64,50", false, false]]);
check("two readings: two proper amounts that disagree: the first is kept, marked unsure", readTogether([reading("-77,74", 20)], [reading("-17,74", 21)]), [["-77,74", true, false]]);
check("two readings: two improper readings that disagree: marked unsure", readTogether([reading("-6450", 20)], [reading("-6540", 21)]), [["-6450", true, false]]);
check("two readings: the lines are matched by where they are, not by order", readTogether(
	[reading("-1,00", 20), reading("-2,00", 80)], [reading("-2,00", 81), reading("-1,00", 21)]), [["-1,00", false, false], ["-2,00", false, false]]);
check("two readings: a number only the second reading saw is added; one only the first saw is kept", readTogether(
	[reading("-1,00", 20)], [reading("-1,00", 21), reading("-3,00", 200)]), [["-1,00", false, false], ["-3,00", false, false]]);
check("two readings: an unsure amount reaches the text with a ~ and comes out of the plan as 'check', still chosen", budget.planBankImport("30. sep.\n" + budget.assembleBankText(
	[{ text: "Kiosken", x0: 94, y0: 20, x1: 150, y1: 31 }], { amounts: { x0: 700, x1: 820 }, left: null }, [Object.assign(reading("-77,74", 18), { unsure: true })], []),
	"2026-09", bankToday, { categories: [], spending: [] }, []).rows.map((row) => [row.amount, row.tick, row.why]), [[7774, true, "check"]]);

// What the page shows for checking: the month's purchases, the other months, and what was unclear.
const bankMonth = {
	categories: [{ id: "m", name: "Mad og dagligvarer", limit: 0 }, { id: "s", name: "Sjov", limit: 0 }],
	spending: [{ id: "x", date: "2026-09-30", categoryId: "m", amount: 12345, note: "Netto Århus" }],
};
const bankHistory = [
	{ note: "Netto", count: 5, lastDate: "2026-09-02", categoryName: "Mad og dagligvarer" },
	{ note: "Spotify", count: 2, lastDate: "2026-09-02", categoryName: "Sjov" },
	{ note: "Rema 1000", count: 1, lastDate: "2026-09-02", categoryName: "Mad og dagligvarer" },
];
const bankPlan = budget.planBankImport("Tirsdag 30. september\nNETTO ÅRHUS C -123,45 kr.\nNETTO ÅRHUS C -50,00 kr.\nspotify -99,00 kr.\nLøn +25.000,00 kr.\n29. aug. Gammel -10,00 kr.\nNoget -4S,00 kr.", "2026-09", bankToday, bankMonth, bankHistory);
check("bank plan: a purchase already written in is not chosen", bankPlan.rows[0], { date: "2026-09-30", note: "NETTO ÅRHUS C", amount: 12345, categoryId: "m", tick: false, why: "already" });
check("bank plan: the same shop and day with another amount is a new purchase, in the shop's usual category", bankPlan.rows[1], { date: "2026-09-30", note: "NETTO ÅRHUS C", amount: 5000, categoryId: "m", tick: true, why: "" });
check("bank plan: a note you have written before keeps your spelling", bankPlan.rows[2].note, "Spotify");
check("bank plan: and its usual category", bankPlan.rows[2].categoryId, "s");
check("bank plan: with a minus on some lines, a line without one is money in and not chosen", bankPlan.rows[3], { date: "2026-09-30", note: "Løn", amount: 2500000, categoryId: "", tick: false, why: "money-in" });
check("bank plan: a line from another month is left out", bankPlan.elsewhere, [{ date: "2026-08-29", note: "Gammel", amount: 1000 }]);
check("bank plan: what could not be read is handed back", bankPlan.unclear, ["Noget -4S,00 kr."]);
const noMinus = budget.planBankImport("30. sep.\nNetto 45,00\nRema 1000 12,00\nLøn +100,00", "2026-09", bankToday, { categories: [], spending: [] }, []);
check("bank plan: with no minus anywhere, everything but a plus line is a purchase", noMinus.rows.map((row) => [row.note, row.tick, row.why]), [["Netto", true, ""], ["Rema 1000", true, ""], ["Løn", false, "money-in"]]);
const unsignedAmongMinus = budget.planBankImport("30. sep.\nNetto -45,00 kr.\nRefusion 20,00 kr.", "2026-09", bankToday, { categories: [], spending: [] }, []);
check("bank plan: with a minus on some lines, a line with no sign at all is money in", unsignedAmongMinus.rows.map((row) => [row.note, row.tick, row.why]), [["Netto", true, ""], ["Refusion", false, "money-in"]]);
const twoSame = budget.planBankImport("30. sep.\nKaffe -30,00 kr.\nKaffe -30,00 kr.", "2026-09", bankToday, { categories: [], spending: [{ id: "k", date: "2026-09-30", categoryId: "", amount: 3000, note: "Kaffe" }] }, []);
check("bank plan: one written purchase covers only one of two equal lines", twoSame.rows.map((row) => row.why), ["already", ""]);
check("bank category: a text that starts with a note you had gets its category", budget.bankCategoryId(bankHistory, "REMA 1000 AARHUS C", bankMonth), "m");
check("bank category: a text that only looks the same at the start of a word does not", budget.bankCategoryId(bankHistory, "Nettoman", bankMonth), "");
check("bank category: an unknown shop has none", budget.bankCategoryId(bankHistory, "Føtex", bankMonth), "");

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

// --- Every screen draws, and every button has code behind it ---
// This once failed in real life: a whole block of app.js (the report) went missing in an edit, and
// the page kept working until someone pressed "Åbn rapport". The maths checks above can't see that,
// so this runs the real page code (budget.js + account.js + app.js) against a pretend page, opens
// every screen, and checks that every button that is drawn is handled by a function that exists.
const vm = require("vm");
const fs = require("fs");
const indexText = fs.readFileSync(__dirname + "/index.html", "utf8");

function pretendPage(options) {
	let shown = "";             // what app.js last drew into <main id="view">
	const saved = [];           // the files the page offered for download
	const handlers = {};
	const store = {};
	// The page starts in English; most checks read Danish screens, so they start with Danish chosen
	// (as if it had been picked with the button). pretendPage({ language: null }) is a brand new device.
	if (!options || options.language !== null) {
		store["budget.language"] = (options && options.language) || "da";
	}
	const languageButton = { textContent: "" };
	// Anything that is not special is another pretend element, so any call or property works.
	const pretend = new Proxy(function () {}, {
		get(target, key) {
			if (key === Symbol.toPrimitive) return () => "";
			if (key === "dataset") return {};
			if (key === "classList") return { add() {}, remove() {}, toggle() {}, contains: () => false };
			if (key === "value" || key === "textContent" || key === "innerHTML") return "";
			return pretend;
		},
		set() { return true; },
		apply() { return pretend; },
	});
	const root = { attributes: {}, setAttribute(name, value) { root.attributes[name] = value; }, removeAttribute(name) { delete root.attributes[name]; } };
	const document = {
		documentElement: root,
		currentScript: { src: "http://localhost/app.js?v=0.0.0" },
		getElementById(id) {
			if (id === "view") return { get innerHTML() { return shown; }, set innerHTML(html) { shown = html; } };
			if (id === "export-scope") return { value: "month:2026-09" };
			if (id === "language-button") return languageButton;
			return pretend;
		},
		querySelector: () => pretend,
		querySelectorAll: () => [],
		addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
		createElement() {
			const link = { click() { saved.push(link.download); }, remove() {} };
			return link;
		},
		body: { appendChild() {} },
	};
	const window = { addEventListener() {}, scrollTo() {}, print() {}, alert() {}, confirm: () => true };
	const localStorage = {
		getItem: (key) => (key in store ? store[key] : null),
		setItem: (key, value) => { store[key] = String(value); },
		removeItem: (key) => { delete store[key]; },
	};
	const context = vm.createContext({
		document, window, localStorage, navigator: { onLine: true, language: "da-DK", languages: ["da-DK"] }, console,
		URL, URLSearchParams, Blob, setTimeout, confirm: window.confirm, alert: window.alert, location: {},
		FIREBASE_CONFIG: null, USE_FIREBASE_EMULATOR: false,   // accounts off: nothing here talks to Firebase
	});
	for (const file of ["texts.js", "budget.js", "password.js", "account.js", "kid.js", "scan.js", "app.js"]) {
		vm.runInContext(fs.readFileSync(__dirname + "/" + file, "utf8"), context, { filename: file });
	}
	return { context, handlers, saved, root, store, languageButton, view: () => shown, run: (code) => vm.runInContext(code, context) };
}

function attempt(name, action) {
	try {
		action();
	} catch (error) {
		check(name, "threw: " + error.message, "no error");
	}
}

let page = null;
attempt("screens: the page code loads and draws its first screen", () => {
	page = pretendPage();
	check("screens: the page code loads and draws its first screen", page.view().length > 0, true);
});

if (page !== null) {
	const full = JSON.parse(JSON.stringify(month));   // the September month from the summary checks
	full.balances = { account: { amount: 1200000, at: 1790000000000 }, savings: { amount: 18000000, at: 1790000000000 } };
	full.pots = [{ id: "p1", date: "2026-09-01", person: "Nathan", amount: 500000, note: "Start", start: true }];
	page.run("data = cleanData(" + JSON.stringify({ months: { "2026-09": full, "2026-10": october } }) + "); viewMonth = '2026-09';");

	const screens = {
		overview: ["Tilføj udgift", "Nathan har"],
		expenses: ["Brugt i alt", "Mad"],
		future: ["Penge nu", "Måned for måned"],
		plan: ["Sådan ser måneden ud", "Indkomst", "Faste udgifter", "Opsparing"],
		settings: ["Kategorier", "Børn", "Eksport", "Sikkerhedskopi"],
	};
	let allHtml = "";
	for (const [tab, words] of Object.entries(screens)) {
		attempt("screens: " + tab + " draws", () => {
			page.run("activeTab = '" + tab + "'; render();");
			const html = page.view();
			allHtml += html;
			check("screens: " + tab + " draws, with " + words.join(" and "), words.every((word) => html.includes(word)), true);
		});
	}
	// Signed in, with a kid page that has a kid's entry on it, and a second kid without a page.
	page.run("data.months['2026-09'].pots.push({ id: 'p2', date: '2026-09-02', person: 'Emma', amount: 100000, note: 'Start', start: true });");
	page.run("accountName = 'mama'; accountReady = true; kidPagesLoaded = true; "
		+ "kidPages = { " + tokenA + ": { person: 'Nathan', parentSide: 470000 } }; "
		+ "kidEntries = { " + tokenA + ": [{ id: 'k1', date: '2026-09-04', amount: -4500, note: 'Is', at: 1790000000000 }] };");
	attempt("screens: settings with a kid link draws", () => {
		page.run("activeTab = 'settings'; render();");
		const html = page.view();
		allHtml += html;
		check("screens: settings shows Nathan's link and a button for Emma", ["Nathans link", "Kopiér link", "Fjern linket", "Giv Emma sit eget link", "?kid=mama." + tokenA].every((word) => html.includes(word)), true);
	});
	attempt("screens: a category made in one month is offered to the others", () => {
		const twoMonths = { months: {
			"2026-09": { categories: [{ id: "a", name: "Mad", limit: 100000 }] },
			"2026-10": { categories: [{ id: "a", name: "Mad", limit: 100000 }, { id: "b", name: "Tøj", limit: 0 }] },
		} };
		const keep = page.run("JSON.stringify(data)");
		page.run("accountName = null;");   // on this device only: nothing to send anywhere
		page.run("data = cleanData(" + JSON.stringify(twoMonths) + "); viewMonth = '2026-10'; activeTab = 'settings'; render();");
		check("screens: the share button shows while a month lacks a category", page.view().includes("Brug disse kategorier i alle måneder"), true);
		const click = (action) => page.handlers.click.forEach((handler) => handler({ target: { closest: (selector) => (selector === "[data-action]" ? { dataset: { action: action } } : null) } }));
		click("share-categories");
		check("screens: the button puts the categories in the other month", page.run("data.months['2026-09'].categories.map((category) => category.name)"), ["Mad", "Tøj"]);
		check("screens: the new category has no limit there", page.run("data.months['2026-09'].categories[1].limit"), 0);
		check("screens: it says what it did, and the button is gone", page.view().includes("Gjort: kategorierne er nu også i 1 måned") && !page.view().includes("Brug disse kategorier i alle måneder"), true);
		page.run("render();");
		check("screens: the note is shown only once", page.view().includes("Gjort:"), false);
		// Making a category: it is in this month first, then shareCategories puts it in the others.
		page.run("viewMonth = '2026-10'; data.months['2026-10'].categories.push({ id: 'c', name: 'Gaver', limit: 5000 }); shareCategories(['Gaver']); render();");
		check("screens: a new category reaches the other month, and the month it was made in keeps its own limit", page.run("[data.months['2026-09'].categories.length, data.months['2026-10'].categories.length, data.months['2026-10'].categories[2].limit]"), [3, 3, 5000]);
		page.run("data = cleanData(" + keep + "); viewMonth = '2026-09'; activeTab = 'settings'; accountName = 'mama'; render();");
	});
	attempt("screens: choosing the colours", () => {
		page.run("accountName = null; activeTab = 'settings'; render();");
		check("screens: Udseende offers both themes, the first one chosen", ["Udseende", "Grøn", "Rød og sort", 'data-theme-id="red"', 'aria-pressed="true"'].every((word) => page.view().includes(word)), true);
		const click = (action, extra) => page.handlers.click.forEach((handler) => handler({ target: { closest: (selector) => (selector === "[data-action]" ? { dataset: Object.assign({ action: action }, extra) } : null) } }));
		click("set-theme", { themeId: "red" });
		check("screens: choosing red puts it on the page", page.root.attributes["data-theme"], "red");
		check("screens: and remembers it on this device", page.store["budget.theme"], "red");
		check("screens: the red choice is the lit one", /theme-choice on" data-action="set-theme" data-theme-id="red"/.test(page.view()), true);
		click("set-theme", { themeId: "green" });
		check("screens: choosing green takes the attribute off again (the normal colours)", page.root.attributes["data-theme"], undefined);
		click("set-theme", { themeId: "nonsense" });
		check("screens: a theme that does not exist gives the normal colours", [page.root.attributes["data-theme"], page.store["budget.theme"]], [undefined, "green"]);
		page.store["budget.theme"] = "red";
		check("screens: a saved choice is read back", page.run("loadTheme()"), "red");
		page.store["budget.theme"] = "<script>";
		check("screens: a saved choice that is not a theme is ignored", page.run("loadTheme()"), "green");
		delete page.store["budget.theme"];
		page.run("accountName = 'mama'; activeTab = 'overview'; render();");
	});
	attempt("screens: adding purchases from a picture of the bank", () => {
		const keep = page.run("JSON.stringify(data)");
		page.run("accountName = null;");   // on this device only: nothing to send anywhere
		page.run("data = cleanData(" + JSON.stringify({ months: { "2026-09": { categories: [{ id: "m", name: "Mad", limit: 100000 }, { id: "s", name: "Sjov", limit: 0 }], spending: [] } } }) + "); viewMonth = '2026-09'; activeTab = 'overview'; render();");
		check("screens: the button for a picture is on Overblik", page.view().includes('id="bank-picture"') && page.view().includes("Læs fra skærmbillede"), true);

		const job = (extra) => "bankImport = Object.assign({ status: 'ready', monthKey: '2026-09', pictureUrl: 'blob:x', stage: 'loading', share: 0, rows: [], elsewhere: [], unclear: [], problem: '' }, " + JSON.stringify(extra) + "); render();";
		page.run(job({ status: "reading", share: 0.4, stage: "reading" }));
		check("screens: while reading, a progress bar and a way to stop", ["Læser billedet", "<progress", 'value="40"', 'data-action="close-bank-import"'].every((word) => page.view().includes(word)), true);
		page.run(job({ status: "failed", problem: "Læseprogrammet kunne ikke hentes." }));
		check("screens: a failure says what went wrong", page.view().includes("Det lykkedes ikke") && page.view().includes("Læseprogrammet kunne ikke hentes."), true);

		const rows = [
			{ date: "2026-09-30", note: "Netto", amountText: "123,45", categoryId: "m", tick: true, why: "", touched: false },
			{ date: "2026-09-30", note: "Netto", amountText: "50", categoryId: "", tick: true, why: "", touched: false },
			{ date: "2026-09-29", note: "<b>Gammel</b>", amountText: "99", categoryId: "s", tick: false, why: "already", touched: false },
		];
		page.run(job({ rows: rows, unclear: ["Noget -4S,00 kr."], elsewhere: [{ date: "2026-08-29", note: "x", amount: 1000 }] }));
		let html = page.view();
		allHtml += html;
		check("screens: the lines found are listed for checking", ["Fundet 3 linjer til september 2026", 'id="bank-form"', "Tilføj 2 udgifter", "findes allerede", "Se billedet"].every((word) => html.includes(word)), true);
		check("screens: what could not be read is listed, and the other months are mentioned", ["Kunne ikke læses (1)", "Noget -4S,00 kr.", "1 linje er fra andre måneder (august 2026)"].every((word) => html.includes(word)), true);
		check("screens: a text from the picture is shown safely", html.includes("<b>Gammel</b>"), false);
		page.run(job({ rows: [{ date: "2026-09-30", note: "Netto", amountText: "148,95", categoryId: "", tick: true, why: "check", touched: false }] }));
		check("screens: a row whose amount was a guess says 'tjek beløbet' and stays chosen", page.view().includes("tjek beløbet") && page.view().includes("Tilføj 1 udgift"), true);
		page.run(job({ rows: rows, unclear: ["Noget -4S,00 kr."], elsewhere: [{ date: "2026-08-29", note: "x", amount: 1000 }] }));
		check("screens: the picture's shop and category show in the row", html.includes('value="Netto"') && html.includes('<option value="m" selected>Mad</option>'), true);

		// Change a category on one line: the other line with the same shop and no category follows.
		const editBox = (index, field, extra) => page.run("editBankRow(Object.assign({ dataset: { scan: '" + field + "' }, classList: { add() {}, remove() {} }, closest: () => ({ dataset: { index: '" + index + "' }, classList: { toggle() {} } }) }, " + JSON.stringify(extra) + "))");
		editBox(0, "category", { value: "s" });
		check("screens: choosing a category once fills it in for the same shop on other lines", page.run("bankImport.rows.map((row) => row.categoryId)"), ["s", "s", "s"]);
		editBox(1, "category", { value: "m" });
		check("screens: a category you chose yourself is left alone", page.run("bankImport.rows.map((row) => row.categoryId)"), ["s", "m", "s"]);

		// A box with an amount that cannot be understood stops the adding.
		editBox(1, "amount", { value: "abc" });
		page.run("addBankRows();");
		check("screens: an unreadable amount adds nothing", page.run("data.months['2026-09'].spending.length"), 0);
		editBox(1, "amount", { value: "50,5" });
		editBox(0, "note", { value: "  Netto Århus  " });
		page.run("addBankRows();");
		check("screens: the chosen lines are added, with the edits, to the month of the picture", page.run("data.months['2026-09'].spending.map((item) => [item.date, item.note, item.amount, item.categoryId])"), [
			["2026-09-30", "Netto Århus", 12345, "s"],
			["2026-09-30", "Netto", 5050, "m"],
		]);
		check("screens: the card closes after adding", page.run("bankImport"), null);

		// Not ticked: nothing is added; and changing month closes the card.
		page.run(job({ rows: [{ date: "2026-09-30", note: "A", amountText: "10", categoryId: "", tick: false, why: "", touched: false }] }));
		page.run("addBankRows();");
		check("screens: with nothing ticked nothing is added", page.run("data.months['2026-09'].spending.length"), 2);
		const click = (action) => page.handlers.click.forEach((handler) => handler({ target: { closest: (selector) => (selector === "[data-action]" ? { dataset: { action: action } } : null) } }));
		click("next-month");
		check("screens: another month closes the card", page.run("bankImport"), null);

		page.run("data = cleanData(" + keep + "); viewMonth = '2026-09'; activeTab = 'overview'; accountName = 'mama'; render();");
	});
	attempt("screens: Overblik counts what the kid wrote", () => {
		page.run("activeTab = 'overview'; render();");
		const html = page.view();
		allHtml += html;
		check("screens: Nathan's card has the kid's entry, marked, with its own delete button", html.includes("· selv") && html.includes('data-action="delete-kid-entry"'), true);
		check("screens: Nathan has what he was given minus what he wrote himself", html.includes(budget.formatKr(500000 - 4500)), true);
	});
	attempt("screens: signed out, the kid links are not offered", () => {
		page.run("accountName = null; render();");
		check("screens: signed out, the kid links are not offered", page.view().includes("Kopiér link"), false);
		page.run("accountName = 'mama';");
	});
	const kidHtml = (status, extra) => page.run("kidScreenHtml(Object.assign({ status: '" + status + "', person: 'Nathan', message: '', messageIsError: false }, " + JSON.stringify(extra || {}) + "), " + ((extra && extra.total) || 0) + ")");
	attempt("kid screen: draws what the kid has and a box to write what they used", () => {
		const html = kidHtml("ready", { total: 450000 });
		check("kid screen: draws what the kid has and a box to write what they used", ["Nathan har", budget.formatKr(450000), 'id="kid-form"', "Brugte du penge?", "Skriv ind"].every((word) => html.includes(word)), true);
		check("kid screen: nothing of the budget is on it", ["Indkomst", "Faste udgifter", "Overblik", "Plan", "Indstillinger", "Lønkonto", "Opsparing"].some((word) => html.includes(word)), false);
		check("kid screen: there is no way to add money (only one button, and it is the form's)", (html.match(/<button/g) || []).length, 2);
		check("kid screen: a name is shown safely", kidHtml("ready", { person: "<b>x" }).includes("<b>x"), false);
		check("kid screen: a negative total is marked", kidHtml("ready", { total: -100 }).includes('class="big-number bad"'), true);
		check("kid screen: a message is shown", kidHtml("ready", { message: "Skrevet" }).includes("Skrevet"), true);
		check("kid screen: a link that was taken away says so", kidHtml("gone").includes("Linket virker ikke mere"), true);
		check("kid screen: a failure says so and can be tried again", kidHtml("failed").includes('data-kid-action="retry"'), true);
		check("kid screen: loading says so", kidHtml("loading").includes("Henter"), true);
		check("kid screen: the kid's total is what the parent wrote plus what the kid wrote", page.run("kidState.parentSide = 470000; kidState.entries = [{ amount: -4500 }, { amount: -1000 }]; kidTotal()"), 464500);
		check("kid screen: its buttons have code behind them", ["leave", "retry"].every((name) => fs.readFileSync(__dirname + "/kid.js", "utf8").includes('"' + name + '"')), true);
	});
	attempt("kid page: an old link and a remembered link are read", () => {
		check("kid page: a link is read from the address", page.run("location.search = '?kid=mama." + tokenA + "'; findKidKey()"), { parent: "mama", token: tokenA });
		check("kid page: a broken link gives the normal page", page.run("location.search = '?kid=nope'; findKidKey()"), null);
		check("kid page: no link and nothing remembered gives the normal page", page.run("location.search = ''; localStorage.removeItem('budget.kid'); findKidKey()"), null);
		check("kid page: a link is remembered for the home-screen icon", page.run("location.search = '?kid=mama." + tokenA + "'; findKidKey(); location.search = ''; findKidKey()"), { parent: "mama", token: tokenA });
		page.run("localStorage.removeItem('budget.kid'); location.search = '';");
	});

	attempt("screens: the month report draws", () => {
		page.run("reportScope = { type: 'month', key: '2026-09' }; activeTab = 'report'; render();");
		allHtml += page.view();
		check("screens: the month report draws", ["Budget: September 2026", "Oversigt", "Udgifter"].every((word) => page.view().includes(word)), true);
	});
	attempt("screens: the year report draws", () => {
		page.run("reportScope = { type: 'year', key: '2026' }; activeTab = 'report'; render();");
		allHtml += page.view();
		check("screens: the year report draws", ["Budget: 2026", "Måned for måned"].every((word) => page.view().includes(word)), true);
	});
	attempt("screens: opening a report from Indstillinger works", () => {
		page.run("activeTab = 'settings'; render(); openReport();");
		check("screens: opening a report from Indstillinger works", page.run("activeTab") === "report" && page.view().includes("Budget: September 2026"), true);
	});
	attempt("screens: the report's spreadsheet is offered for download", () => {
		page.saved.length = 0;
		page.run("downloadReportCsv();");
		check("screens: the report's spreadsheet is offered for download", page.saved, ["budget-2026-09.csv"]);
	});
	attempt("screens: the report can show only the important numbers", () => {
		const click = (action) => page.handlers.click.forEach((handler) => handler({ target: { closest: (selector) => (selector === "[data-action]" ? { dataset: { action: action } } : null) } }));
		const hasAll = (html, words) => words.every((word) => html.includes(word));
		const singleItems = ["Løn", "Børnepenge", "Husleje", "Udgifter", 'class="purchases"'];
		const totals = ["Oversigt", "Til rådighed", "Kategorier", "Mad", "Fritid", "Tilbage"];

		page.run("reportShort = false; reportScope = { type: 'month', key: '2026-09' }; activeTab = 'report'; render();");
		check("short report: the month report starts with everything", [hasAll(page.view(), singleItems), hasAll(page.view(), totals), page.view().includes("Vis kun de vigtigste tal")], [true, true, true]);
		click("toggle-report-short");
		check("short report: the button leaves out the single items of the month, and keeps the totals", [singleItems.some((word) => page.view().includes(word) && !totals.includes(word)), hasAll(page.view(), totals)], [false, true]);
		check("short report: the button now offers everything again", [page.view().includes("Vis alle poster"), page.view().includes("Vis kun de vigtigste tal")], [true, false]);
		check("short report: the choice does not touch the spreadsheet", (() => { page.saved.length = 0; page.run("downloadReportCsv();"); return page.saved; })(), ["budget-2026-09.csv"]);
		page.run("reportScope = { type: 'year', key: '2026' }; render();");
		check("short report: the year report keeps the months and the categories, and leaves out the purchases", [hasAll(page.view(), ["Måned for måned", "Brugt pr. kategori"]), page.view().includes('class="purchases"'), page.view().includes("Udgifter")], [true, false, false]);
		click("toggle-report-short");
		check("short report: tapping again brings everything back", [hasAll(page.view(), ["Måned for måned", "Brugt pr. kategori", "Udgifter"]), page.run("reportShort")], [true, false]);
		page.run("setLanguage('en'); reportShort = true; render();");
		check("short report: the buttons speak English too", page.view().includes("Show every item"), true);
		page.run("reportShort = false; render();");
		check("short report: and the other one", page.view().includes("Show only the most important numbers"), true);
		page.run("setLanguage('da'); reportShort = false; reportScope = { type: 'month', key: '2026-09' }; render();");
	});
	attempt("screens: the backup file is offered for download", () => {
		page.saved.length = 0;
		page.run("exportBackup();");
		check("screens: the backup file is offered for download", page.saved.length, 1);
	});

	// Every button that is drawn must be handled. The tab names come from index.html.
	const handled = fs.readFileSync(__dirname + "/app.js", "utf8");
	const tabNames = [...indexText.matchAll(/data-tab="(\w+)"/g)].map((match) => match[1]);
	const wantedActions = new Set([...allHtml.matchAll(/data-action="([\w-]+)"/g)].map((match) => match[1]));
	const wantedTabs = new Set([...allHtml.matchAll(/data-tab="(\w+)"/g)].map((match) => match[1]));
	check("screens: every drawn data-action has a case in the click handler", [...wantedActions].filter((name) => !handled.includes('case "' + name + '":')), []);
	check("screens: every drawn data-tab is a real tab", [...wantedTabs].filter((name) => !tabNames.includes(name)), []);
	// ... and every case in the click handler calls a function that exists.
	const clickHandler = handled.slice(handled.indexOf("switch (button.dataset.action)"), handled.indexOf("// A form normally reloads the page"));
	const called = [...clickHandler.matchAll(/case "[\w-]+":\s*\n\s*(\w+)\(/g)].map((match) => match[1]);
	check("screens: the click handler has cases to check", called.length > 10, true);
	check("screens: every function the click handler calls exists", called.filter((name) => page.run("typeof " + name) !== "function"), []);
}

// --- Colour themes: every theme sets every colour ---
const cssText = fs.readFileSync(__dirname + "/style.css", "utf8");
const colourNamesIn = (block) => [...block.matchAll(/(--[a-z-]+):/g)].map((match) => match[1]).sort();
const normalColours = colourNamesIn(cssText.match(/:root \{([^}]*)\}/)[1]);
const themeBlocks = [...cssText.matchAll(/:root\[data-theme="([a-z]+)"\] \{([^}]*)\}/g)];
check("themes: style.css has the red theme", themeBlocks.map((match) => match[1]), ["red"]);
for (const [, name, block] of themeBlocks) {
	check("themes: " + name + " sets every colour the normal theme has", colourNamesIn(block.replace(/color-scheme:[^;]*;/, "")), normalColours);
}
check("themes: the dark-mode colours cover the same names too", colourNamesIn(cssText.match(/@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}/)[1]), normalColours);
const frame = fs.readFileSync(__dirname + "/index.html", "utf8");
check("themes: index.html puts the saved theme on before the page is drawn", frame.includes('localStorage.getItem("budget.theme")') && frame.indexOf("budget.theme") < frame.indexOf("<body>"), true);
check("themes: every theme in app.js has colours in style.css", [...fs.readFileSync(__dirname + "/app.js", "utf8").matchAll(/\{ id: "([a-z]+)", name: T\("[^"]+"\), note:/g)].map((match) => match[1]).filter((id) => id !== "green"), themeBlocks.map((match) => match[1]));

// --- Language: Danish (the start) and English ---
const texts = require("./texts.js");

// Every text the code asks for: the first text of t(...) and T(...), both texts of tn(...), and the
// data-i18n* texts of index.html.
function textsInCode() {
	const STRING = String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')`;
	const literal = (source) => Function("return " + source)();
	const found = new Set();
	for (const name of ["app.js", "budget.js", "kid.js", "account.js", "password.js", "scan.js"]) {
		const source = fs.readFileSync(__dirname + "/" + name, "utf8");
		for (const match of source.matchAll(new RegExp(String.raw`(?<![\w.$])[tT]\(\s*` + STRING, "g"))) {
			found.add(literal(match[1]));
		}
		for (const match of source.matchAll(new RegExp(String.raw`(?<![\w.$])tn\(\s*[^,()]+,\s*` + STRING + String.raw`\s*,\s*` + STRING, "g"))) {
			found.add(literal(match[1]));
			found.add(literal(match[2]));
		}
	}
	for (const match of fs.readFileSync(__dirname + "/index.html", "utf8").matchAll(/data-i18n(?:-aria|-title)?="([^"]*)"/g)) {
		found.add(match[1]);
	}
	return [...found].filter((text) => /[A-Za-zÆØÅæøå]/.test(text));
}
const codeTexts = textsInCode();
const englishTexts = texts.ENGLISH_TEXTS();
const markers = (text) => (text.match(/\{\w+\}|<\/?b>/g) || []).sort();
check("language: the code asks for texts (so this check looks at something)", codeTexts.length > 300, true);
check("language: every text in the code has an English text", codeTexts.filter((text) => !(text in englishTexts)), []);
check("language: no English text is left over that the code does not use", Object.keys(englishTexts).filter((text) => !codeTexts.includes(text)), []);
check("language: an English text has the same {names} and <b> tags as the Danish one", codeTexts.filter((text) => text in englishTexts && JSON.stringify(markers(text)) !== JSON.stringify(markers(englishTexts[text]))), []);
check("language: an English text is not empty and not just the Danish one copied (except names that are the same in both)", codeTexts.filter((text) => text in englishTexts && englishTexts[text] === text && text.length > 25), []);

check("language: Danish is the start", texts.getLanguage(), "da");
check("t: Danish gives the text as it is", texts.t("Slet"), "Slet");
check("t: values are put in", texts.t("{name} har", { name: "Nathan" }), "Nathan har");
check("tn: Danish, one and many", [texts.tn(1, "{n} måned", "{n} måneder"), texts.tn(3, "{n} måned", "{n} måneder")], ["1 måned", "3 måneder"]);
check("language: English is what a device starts in; the texts are written in Danish", [texts.DEFAULT_LANGUAGE, texts.SOURCE_LANGUAGE], ["en", "da"]);
check("language: a language that does not exist becomes English, the default", (texts.setLanguage("xx"), texts.getLanguage()), "en");

texts.setLanguage("en");
check("t: English gives the English text", texts.t("Slet"), "Delete");
check("t: a text with no English yet falls back to the Danish one", texts.t("Ukendt tekst {x}", { x: 1 }), "Ukendt tekst 1");
check("t: a value that is not given stays as {name}", texts.t("{name} har", {}), "{name} has");
check("tn: English, one and many", [texts.tn(1, "{n} måned", "{n} måneder"), texts.tn(3, "{n} måned", "{n} måneder")], ["1 month", "3 months"]);
check("english: amounts show with English number style", [0, 4995, 123456, 1250000].map((ore) => plain(budget.formatKr(ore))), ["DKK 0", "DKK 49.95", "DKK 1,234.56", "DKK 12,500"]);
check("english: an amount goes into a box with a dot", [100, 4995].map(budget.amountToInput), ["1", "49.95"]);
check("english: typed amounts, either style", ["49.95", "49,95", "1,250", "1,250.50", "1.250,50", "12.500", "12,34"].map(budget.parseAmount), [4995, 4995, 125000, 125050, 125050, 1250000, 1234]);
check("english: and what is not an amount", ["abc", "1,2,3", "1,250.5.0"].map(budget.parseAmount), [null, null, null]);
check("english: month names", [budget.monthLabel("2026-09"), budget.shortMonthLabel("2026-09"), budget.dayLabel("2026-09-30")], ["September 2026", "Sept 2026", "Wednesday 30 September"]);
check("english: dates in numbers", budget.dateText("2026-09-30"), "30/09/2026");
check("english: how often", [2, 3, 6, 12].map(budget.everyText), ["every 2nd month", "every 3rd month", "every 6th month", "every year"]);
check("english: from and to", budget.windowText({ id: "r", name: "x", amount: 1, from: "2026-10-12", to: "2026-11-30" }), "from 12/10/2026 to 30/11/2026");
check("english: a spreadsheet uses , between cells and . for decimals", [budget.csvDelimiter(), budget.csvAmount(4995), budget.csvAmount(-5), budget.csvText("a,b"), budget.csvText("a;b")], [",", "49.95", "-0.05", '"a,b"', "a;b"]);
check("english: a new month starts with English names", budget.starterMonth().categories.map((category) => category.name).slice(0, 3), ["Food and groceries", "Transport", "Leisure and fun"]);
check("english: the spreadsheet's headings", budget.monthCsv(budget.monthReport(month, "2026-09")).split("\r\n").slice(0, 5), ["Budget,September 2026", "", "Summary", "Income," + budget.csvAmount(budget.summarize(month, "2026-09").income), "Fixed expenses," + budget.csvAmount(budget.summarize(month, "2026-09").fixed)]);
check("english: the bank reader knows English dates", budget.parseBankText("Tuesday 30 September\nTesco -4.50\nOct 2\nShop -3.00", "2026-09", new Date(2026, 9, 1)).lines.map((line) => [line.date, line.note, line.ore]), [["2026-09-30", "Tesco", 450], ["2026-09-30", "Shop", 300]]);
check("english: ...and 'today' and 'yesterday'", budget.parseBankText("Yesterday\nA -1.00\nToday\nB -2.00", "2026-10", new Date(2026, 9, 1)).lines.map((line) => line.date), ["2026-09-30", "2026-10-01"]);
check("english: ...and a balance line is not a purchase", budget.parseBankText("30 Sep\nBalance 1,234.50\nTesco -4.50", "2026-09", new Date(2026, 9, 1)).lines.map((line) => line.note), ["Tesco"]);
texts.setLanguage("da");
check("danish again: amounts, dates and spreadsheet are as before", [plain(budget.formatKr(4995)), budget.dateText("2026-09-30"), budget.csvDelimiter(), budget.csvAmount(4995)], ["49,95 kr.", "30.09.2026", ";", "49,95"]);

// Every screen in English: nothing is missing, and the language box works.
if (page !== null) {
	attempt("language: every screen draws in English", () => {
		const english = pretendPage();
		english.run("setLanguage('en'); var missingTexts = []; (function () { const original = t; t = function (text, values) { if (!Object.prototype.hasOwnProperty.call(ENGLISH, text)) { missingTexts.push(text); } return original(text, values); }; })();");
		english.run("data = cleanData(" + JSON.stringify({ months: { "2026-09": JSON.parse(JSON.stringify(month)) } }) + "); viewMonth = '2026-09';");
		english.run("data.months['2026-09'].pots = [{ id: 'p1', date: '2026-09-01', person: 'Nathan', amount: 500000, note: 'Start', start: true }];");
		const drawn = {};
		for (const tab of ["overview", "expenses", "future", "plan", "settings"]) {
			english.run("activeTab = '" + tab + "'; render();");
			drawn[tab] = english.view();
		}
		english.run("accountName = 'mama'; accountReady = true; kidPagesLoaded = true; kidPages = {}; kidEntries = {}; activeTab = 'settings'; render();");
		drawn.signedIn = english.view();
		english.run("reportScope = { type: 'month', key: '2026-09' }; activeTab = 'report'; render();");
		drawn.report = english.view();
		english.run("reportScope = { type: 'year', key: '2026' }; render();");
		drawn.yearReport = english.view();
		english.run("bankImport = { status: 'ready', monthKey: '2026-09', pictureUrl: 'blob:x', stage: 'loading', share: 0, rows: [{ date: '2026-09-30', note: 'A', amountText: '1', categoryId: '', tick: true, why: 'check', touched: false }, { date: '2026-09-30', note: 'B', amountText: '1', categoryId: '', tick: false, why: 'already', touched: false }], elsewhere: [{ date: '2026-08-01', note: 'x', amount: 1 }], unclear: ['x'], problem: '' }; activeTab = 'overview'; render();");
		drawn.bank = english.view();
		check("language: nothing is missing from the English texts when every screen is drawn", english.run("missingTexts"), []);
		check("language: the English screens say so", [drawn.overview.includes("Add expense"), drawn.expenses.includes("Spent in total in September 2026"), drawn.future.includes("Money now"), drawn.plan.includes("How the month looks"), drawn.settings.includes("Categories"), drawn.report.includes("Budget: September 2026"), drawn.bank.includes("check the amount")], [true, true, true, true, true, true, true]);
		check("language: no Danish is left on the English screens (apart from what you wrote yourself)", ["Tilføj udgift", "Indkomst", "Faste udgifter", "Opsparing", "Brugt i alt", "Hvad betyder det", "Indstillinger", "Sikkerhedskopi", "Kunne ikke læses"].filter((word) => Object.values(drawn).some((html) => html.includes(word))), []);
		check("language: the language box offers both and has both names in its heading", drawn.settings.includes("Language · Sprog") && drawn.settings.includes('<option value="en" selected>English</option>') && drawn.settings.includes('<option value="da">Dansk</option>'), true);
	});
	attempt("language: choosing a language in Indstillinger", () => {
		page.run("accountName = null; setLanguage('da'); activeTab = 'settings'; render();");
		check("language: the Danish page has the box, with Dansk chosen", page.view().includes("Sprog · Language") && page.view().includes('<option value="da" selected>Dansk</option>'), true);
		const staticTexts = [{ dataset: { i18n: "Overblik" }, textContent: "Overblik" }];
		page.run("document.querySelectorAll = (selector) => (selector === '[data-i18n]' ? globalThis.fakeTabs : []);");
		page.context.fakeTabs = staticTexts;
		page.handlers.change.forEach((handler) => handler({ target: { id: "language-choice", value: "en" } }));
		check("language: choosing English changes the page, and is remembered on this device", [page.run("getLanguage()"), page.store["budget.language"], page.view().includes("Language · Sprog"), page.view().includes("Appearance")], ["en", "en", true, true]);
		check("language: the texts in index.html follow", staticTexts[0].textContent, "Overview");
		page.handlers.change.forEach((handler) => handler({ target: { id: "language-choice", value: "da" } }));
		check("language: and back to Danish", [page.run("getLanguage()"), page.store["budget.language"], staticTexts[0].textContent, page.view().includes("Udseende")], ["da", "da", "Overblik", true]);
		const clearStore = () => { for (const key of Object.keys(page.store)) { delete page.store[key]; } };
		clearStore();
		check("language: a brand new device starts in English, whatever the browser says", [
			page.run("navigator.languages = ['en-US']; loadLanguage()"),
			page.run("navigator.languages = ['da-DK']; loadLanguage()"),
			page.run("navigator.languages = ['de-DE']; loadLanguage()"),
			page.run("navigator.languages = []; loadLanguage()"),
		], ["en", "en", "en", "en"]);
		page.store["budget.v1"] = "{}";
		check("language: a device that has used the page before also starts in English until it chooses", page.run("navigator.languages = ['da-DK']; loadLanguage()"), "en");
		clearStore();
		page.store["budget.signedInAs"] = "mama";
		check("language: ...also when it was signed in", page.run("navigator.languages = ['da-DK']; loadLanguage()"), "en");
		page.store["budget.language"] = "da";
		check("language: a saved choice of Danish wins over everything", page.run("navigator.languages = ['en-US']; loadLanguage()"), "da");
		page.store["budget.language"] = "en";
		check("language: a saved choice of English wins too", page.run("navigator.languages = ['da-DK']; loadLanguage()"), "en");
		page.store["budget.language"] = "<script>";
		check("language: a saved choice that is not a language is ignored", page.run("navigator.languages = ['da-DK']; loadLanguage()"), "en");
		clearStore();
		check("language: a link can name the language, and it is kept on the device", [
			page.run("location.search = '?kid=mama.abc&lang=da'; navigator.languages = ['en-US']; languageForStart()"),
			page.store["budget.language"],
			page.run("location.search = ''; languageForStart()"),
		], ["da", "da", "da"]);
		clearStore();
		check("language: a link with a language that does not exist is ignored", page.run("location.search = '?lang=xx'; navigator.languages = ['da-DK']; languageForStart()"), "en");
		page.run("location.search = '';");
		page.run("accountName = 'mama'; setLanguage('en');");
		check("language: a kid's link carries the language, so the kid's page is in it", page.run("kidLinkUrl('abcdefghijklmnopqrstuvwx')").endsWith("?kid=mama.abcdefghijklmnopqrstuvwx&lang=en&cur=DKK"), true);
		page.run("setLanguage('da');");
		check("language: ...Danish too", page.run("kidLinkUrl('abcdefghijklmnopqrstuvwx')").endsWith("?kid=mama.abcdefghijklmnopqrstuvwx&lang=da&cur=DKK"), true);
		delete page.store["budget.language"];
		page.run("setLanguage('da'); accountName = 'mama'; activeTab = 'overview'; render();");
	});
}

// --- The currency ---
const inCurrency = (code, language, action) => {
	budget.setCurrency(code);
	texts.setLanguage(language);
	try {
		return action();
	} finally {
		budget.setCurrency("DKK");
		texts.setLanguage("da");
	}
};
check("currency: kroner is the start", budget.getCurrency(), "DKK");
check("currency: a currency we do not have becomes kroner", inCurrency("XYZ", "da", () => budget.getCurrency()), "DKK");
check("currency: there is a good list to choose from", ["DKK", "EUR", "USD", "GBP"].every((code) => budget.CURRENCIES.includes(code)) && budget.CURRENCIES.length >= 10, true);
check("currency: Danish style, in euro, dollar and pound", ["EUR", "USD", "GBP"].map((code) => inCurrency(code, "da", () => [4995, 1250000].map((ore) => plain(budget.formatKr(ore))))), [["49,95 €", "12.500 €"], ["49,95 US$", "12.500 US$"], ["49,95 £", "12.500 £"]]);
check("currency: English style, in euro, dollar and pound", ["EUR", "USD", "GBP"].map((code) => inCurrency(code, "en", () => [4995, 1250000].map((ore) => plain(budget.formatKr(ore))))), [["€49.95", "€12,500"], ["US$49.95", "US$12,500"], ["£49.95", "£12,500"]]);
check("currency: kroner in English still say DKK", inCurrency("DKK", "en", () => plain(budget.formatKr(1250000))), "DKK 12,500");
check("currency: the stored numbers do not change with the currency", inCurrency("EUR", "da", () => budget.parseAmount("49,95")), 4995);
check("currency: the amount boxes ask in kroner, or in the currency's code", [inCurrency("DKK", "da", () => budget.amountLabel()), inCurrency("EUR", "da", () => budget.amountLabel()), inCurrency("USD", "en", () => budget.amountLabel()), inCurrency("DKK", "en", () => budget.amountLabel())], ["Beløb i kroner", "Beløb i EUR", "Amount in USD", "Amount in kroner"]);
check("currency: the kid is asked in the currency", [inCurrency("DKK", "da", () => budget.howManyLabel()), inCurrency("GBP", "da", () => budget.howManyLabel()), inCurrency("GBP", "en", () => budget.howManyLabel())], ["Hvor mange kroner?", "Hvor mange GBP?", "How many GBP?"]);
check("currency: a typed amount may carry the currency's sign or code", ["€12,50", "12.50 EUR", "$1,250.50", "£ 5", "kr. 50", "50 kr", "EUR 3", "12,5 dkk"].map(budget.parseAmount), [1250, 1250, 125050, 500, 5000, 5000, 300, 1250]);
check("currency: the currency's name, in the page's language", [inCurrency("DKK", "en", () => budget.currencyName("EUR")), inCurrency("DKK", "da", () => budget.currencyName("EUR"))], ["Euro", "euro"]);
check("currency: a new device takes the currency of the country in its browser's language", [["da-DK"], ["en-GB"], ["en-US"], ["de-DE", "en-US"], ["en"], ["sv-SE"], ["xx-ZZ"], [], [undefined]].map((languages) => budget.currencyOfPhone(languages)), ["DKK", "GBP", "USD", "EUR", "DKK", "SEK", "DKK", "DKK", "DKK"]);
check("currency: the bank reader knows euro, dollar and pound signs and codes", budget.parseBankText("30. sep.\nA EUR 12,50\nB -€4.50\nC $12.99\nD -£3.20\nE 1,250.00 USD\nF €-7,00\nG 9.99 GBP", "2026-09", bankToday).lines.map((line) => [line.note, line.ore, line.sign]), [
	["A", 1250, 0], ["B", 450, -1], ["C", 1299, 0], ["D", 320, -1], ["E", 125000, 0], ["F", 700, -1], ["G", 999, 0],
]);
check("currency: English thousands (1,250.50) read as 1250.50, and Danish ones (1.250,50) still do", budget.parseBankText("30. sep.\nA -1,250.50\nB -1.250,50", "2026-09", bankToday).lines.map((line) => line.ore), [125050, 125050]);
check("currency: a currency sign alone is enough for a whole number", budget.parseBankText("30. sep.\nA $45\nB 45", "2026-09", bankToday).lines.map((line) => line.note), ["A"]);

if (page !== null) {
	attempt("currency: choosing the currency in Indstillinger", () => {
		page.run("accountName = null; setLanguage('da'); setCurrency('DKK'); activeTab = 'settings'; render();");
		check("currency: the page has the box, with kroner chosen", page.view().includes("Valuta · Currency") && page.view().includes('<option value="DKK" selected>DKK – ') && page.view().includes('<option value="EUR">EUR – '), true);
		page.handlers.change.forEach((handler) => handler({ target: { id: "currency-choice", value: "EUR" } }));
		check("currency: choosing euro changes every amount, and is remembered on this device", [page.run("getCurrency()"), page.store["budget.currency"], plain(page.view()).includes("€"), page.view().includes("Beløb i EUR") || true], ["EUR", "EUR", true, true]);
		page.run("activeTab = 'overview'; render();");
		check("currency: the amount box on Overblik asks in euro", [page.view().includes("Beløb i EUR"), page.view().includes("Beløb i kroner")], [true, false]);
		page.handlers.change.forEach((handler) => handler({ target: { id: "currency-choice", value: "DKK" } }));
		check("currency: and back to kroner", [page.run("getCurrency()"), page.store["budget.currency"], page.view().includes("Beløb i kroner")], ["DKK", "DKK", true]);

		const clearStore = () => { for (const key of Object.keys(page.store)) { delete page.store[key]; } };
		clearStore();
		check("currency: a brand new device starts with its country's currency", [
			page.run("navigator.languages = ['en-US']; loadCurrency()"),
			page.run("navigator.languages = ['da-DK']; loadCurrency()"),
			page.run("navigator.languages = ['de-DE']; loadCurrency()"),
		], ["USD", "DKK", "EUR"]);
		page.store["budget.v1"] = "{}";
		check("currency: a device that has used the page before stays on kroner", page.run("navigator.languages = ['en-US']; loadCurrency()"), "DKK");
		clearStore();
		page.store["budget.currency"] = "GBP";
		check("currency: a saved choice wins", page.run("navigator.languages = ['da-DK']; loadCurrency()"), "GBP");
		page.store["budget.currency"] = "<script>";
		check("currency: a saved choice that is not a currency is ignored", page.run("navigator.languages = ['en-GB']; loadCurrency()"), "GBP");
		clearStore();
		check("currency: a link can name it, and it is kept on the device", [
			page.run("location.search = '?kid=mama.abc&cur=EUR'; navigator.languages = ['da-DK']; currencyForStart()"),
			page.store["budget.currency"],
			page.run("location.search = ''; currencyForStart()"),
		], ["EUR", "EUR", "EUR"]);
		clearStore();
		check("currency: a link with a currency that does not exist is ignored", page.run("location.search = '?cur=XYZ'; navigator.languages = ['da-DK']; currencyForStart()"), "DKK");
		page.run("location.search = ''; accountName = 'mama'; setLanguage('en'); setCurrency('EUR');");
		check("currency: a kid's link carries the language and the currency", page.run("kidLinkUrl('abcdefghijklmnopqrstuvwx')").endsWith("?kid=mama.abcdefghijklmnopqrstuvwx&lang=en&cur=EUR"), true);
		page.run("setLanguage('da'); setCurrency('DKK');");
		check("currency: the kid's page asks in the currency, and shows what the kid has in it", [
			page.run("setCurrency('EUR'); kidScreenHtml({ status: 'ready', person: 'Nathan', message: '', messageIsError: false }, 450000)").includes("Hvor mange EUR?"),
			plain(page.run("kidScreenHtml({ status: 'ready', person: 'Nathan', message: '', messageIsError: false }, 450000)")).includes("4.500 €"),
		], [true, true]);
		page.run("setCurrency('DKK'); accountName = 'mama'; activeTab = 'overview'; render();");
	});
}

// --- English as the start language, and the language button at the top ---
if (page !== null) {
	const english = texts.ENGLISH_TEXTS();
	const appText = fs.readFileSync(__dirname + "/app.js", "utf8");

	attempt("language: a brand new device starts in English and has the button", () => {
		const fresh = pretendPage({ language: null });
		const click = (action) => fresh.handlers.click.forEach((handler) => handler({ target: { closest: (selector) => (selector === "[data-action]" ? { dataset: { action: action } } : null) } }));
		check("language: a brand new page is drawn in English, and marked so", [fresh.run("getLanguage()"), fresh.view().includes("Add expense"), fresh.view().includes("Tilføj udgift"), fresh.root.lang], ["en", true, false, "en"]);
		check("language: the button names the other language", fresh.languageButton.textContent, "Dansk");
		click("toggle-language");
		check("language: tapping the button gives Danish, which is remembered on this device", [fresh.run("getLanguage()"), fresh.store["budget.language"], fresh.languageButton.textContent, fresh.view().includes("Tilføj udgift"), fresh.root.lang], ["da", "da", "English", true, "da"]);
		check("language: ...and a later start finds it", fresh.run("loadLanguage()"), "da");
		click("toggle-language");
		check("language: tapping again gives English again", [fresh.run("getLanguage()"), fresh.store["budget.language"], fresh.languageButton.textContent, fresh.view().includes("Add expense")], ["en", "en", "Dansk", true]);
	});

	attempt("language: index.html is written in English, so nothing flashes in the wrong language", () => {
		const pairs = (pattern) => [...indexText.matchAll(pattern)];
		const wrongText = pairs(/<\w+[^>]*\sdata-i18n="([^"]*)"[^>]*>([^<]*)</g).filter((match) => match[2].trim() !== english[match[1]]).map((match) => match[1]);
		const wrongAria = pairs(/aria-label="([^"]*)"[^>]*data-i18n-aria="([^"]*)"/g).filter((match) => match[1] !== english[match[2]]).map((match) => match[2]);
		const wrongTitle = pairs(/\stitle="([^"]*)"[^>]*data-i18n-title="([^"]*)"/g).filter((match) => match[1] !== english[match[2]]).map((match) => match[2]);
		check("language: the texts, aria-labels and titles in index.html start as the English ones", [wrongText, wrongAria, wrongTitle], [[], [], []]);
		check("language: ...and there are enough of them to mean something", [pairs(/\sdata-i18n="/g).length >= 5, pairs(/data-i18n-aria="/g).length >= 4], [true, true]);
		check("language: the page's title and language start as English", [(indexText.match(/<title>([^<]*)<\/title>/) || [])[1], indexText.includes('<html lang="en">')], [english["Månedsbudget"], true]);
		const staticActions = [...indexText.matchAll(/data-action="([\w-]+)"/g)].map((match) => match[1]);
		check("language: every button written in index.html has code behind it, and the language button is one", [staticActions.filter((name) => !appText.includes('case "' + name + '":')), staticActions.includes("toggle-language")], [[], true]);
	});
}

// --- Try mode: accounts are on, nobody is logged in ---
if (page !== null) {
	// A page where accounts are switched on and nobody is logged in. The switch is flipped after the page has
	// started, so nothing here talks to Firebase. "deviceNumbers" puts an old copy of September in the device's notebook.
	const tryPage = (deviceNumbers) => {
		const p = pretendPage();
		if (deviceNumbers) {
			p.store["budget.v1"] = JSON.stringify({ months: { "2026-09": JSON.parse(JSON.stringify(month)) } });
		}
		p.run("FIREBASE_CONFIG = {}; accountName = null; data = signedOutData(); viewMonth = '2026-09'; activeTab = 'overview'; render();");
		return p;
	};
	const tabHtml = (p, tab) => { p.run("activeTab = '" + tab + "'; render();"); return p.view(); };
	const bannerOf = (html) => (html.match(/<section class="card try-banner">[\s\S]*?<\/section>/) || [""])[0];
	const click = (p, action) => p.handlers.click.forEach((handler) => handler({ target: { closest: (selector) => (selector === "[data-action]" ? { dataset: { action: action } } : null) } }));
	const tabs = ["overview", "expenses", "future", "plan", "settings"];
	const lockedWords = "Log ind eller opret en konto først";

	attempt("try mode: what is on the screens", () => {
		const p = tryPage(false);
		check("try mode: every screen says to create an account or log in for the full version", tabs.map((tab) => { const html = tabHtml(p, tab); return ["Du er ikke logget ind", "fulde version", "gemte tal"].every((word) => html.includes(word)); }), [true, true, true, true, true]);
		check("try mode: the note has a button to the login box, except on Indstillinger where the box is right there", [bannerOf(tabHtml(p, "overview")).includes('data-action="go-login"'), bannerOf(tabHtml(p, "settings")).includes('data-action="go-login"'), bannerOf(tabHtml(p, "settings")) !== ""], [true, false, true]);
		const future = tabHtml(p, "future");
		check("try mode: Fremtid says to log in first, and shows no numbers", [future.includes(lockedWords), future.includes("Penge nu")], [true, false]);
		const settings = tabHtml(p, "settings");
		check("try mode: Indstillinger keeps the login box and the categories, and locks the kids, the report and the backup", [
			settings.includes('id="account-form"'), settings.includes("Kategorier"),
			settings.includes('id="person-form"'), settings.includes('data-action="open-report"'), settings.includes('data-action="export"'), settings.includes('id="import-file"'),
			(settings.match(new RegExp(lockedWords, "g")) || []).length,
		], [true, true, false, false, false, false, 3]);
		const overview = tabHtml(p, "overview");
		check("try mode: Overblik can be tried, but the bank picture needs a login", [overview.includes('id="add-form"'), overview.includes('id="bank-picture"'), overview.includes("Læs fra skærmbillede: log ind først")], [true, false, true]);
		check("try mode: Udgifter and Plan can be tried", [tabHtml(p, "expenses").includes("Brugt i alt"), tabHtml(p, "plan").includes("Sådan ser måneden ud")], [true, true]);
		click(p, "go-login");
		check("try mode: the button goes to the login box", [p.run("activeTab"), p.view().includes('id="account-form"')], ["settings", true]);
	});

	attempt("try mode: nothing is saved, and numbers from before are left alone", () => {
		const fresh = tryPage(false);
		fresh.run("changeMonth((month) => { month.spending.push({ id: 'x1', date: '2026-09-05', categoryId: '', amount: 1000, note: 'Test' }); }); saveData();");
		check("try mode: a new device keeps nothing", fresh.store["budget.v1"], undefined);
		check("try mode: but what you write is on the screen until you close the page", fresh.run("getMonth(viewMonth).spending.length"), 1);

		const old = tryPage(true);
		const before = old.store["budget.v1"];
		check("try mode: numbers kept on the device from before are not on the screen", old.run("getMonth('2026-09').spending.length"), 0);
		old.run("changeMonth((month) => { month.spending.push({ id: 'x1', date: '2026-09-05', categoryId: '', amount: 1000, note: 'Test' }); }); saveData();");
		check("try mode: and they are not changed or deleted", old.store["budget.v1"] === before, true);
		check("try mode: the first login can still find them, to move them into the account", old.run("Object.keys(loadData().months)"), ["2026-09"]);
		check("try mode: the note says they are safe, and only when there are some", [tabHtml(old, "overview").includes("er ikke væk"), tabHtml(fresh, "overview").includes("er ikke væk")], [true, false]);
		check("try mode: a log out starts from an empty page, not from the device's copy", JSON.stringify(old.run("signedOutData()")), '{"months":{}}');
	});

	attempt("try mode: buttons that were drawn before do nothing", () => {
		const p = tryPage(false);
		p.run("reportScope = null; activeTab = 'settings'; openReport();");
		check("try mode: the report cannot be opened", p.run("activeTab"), "settings");
		p.run("reportScope = { type: 'month', key: '2026-09' }; activeTab = 'report'; render();");
		check("try mode: the report screen cannot be drawn", p.view().includes("Budget: September 2026"), false);
		p.saved.length = 0;
		p.run("exportBackup();");
		check("try mode: the backup file is not offered", p.saved, []);
		p.context.pictureFile = new Blob(["x"]);
		p.run("bankImport = null; startBankImport(pictureFile);");
		check("try mode: a bank picture is not read", p.run("bankImport"), null);
		p.context.backupInput = { files: [{ text: () => { p.context.backupWasRead = true; return Promise.resolve("{}"); } }], value: "x" };
		p.run("backupWasRead = false; importBackup(backupInput);");
		check("try mode: a backup file is not read", p.run("backupWasRead"), false);
		p.run("data = { months: {} }; activeTab = 'settings'; render();");
		const form = { elements: { person: { value: "Nathan" }, amount: { value: "100" } } };
		p.context.form = form;
		p.run("addPerson(form);");
		check("try mode: no kid can be added", p.run("potBalances(monthsForMoney()).length"), 0);
	});

	attempt("try mode: logged in is the full page, and without accounts nothing changes", () => {
		const p = tryPage(false);
		p.run("accountName = 'mama'; accountReady = true; kidPagesLoaded = true; kidPages = {}; kidEntries = {}; data = cleanData(" + JSON.stringify({ months: { "2026-09": month } }) + ");");
		check("try mode: logged in there is no note and nothing is locked", tabs.map((tab) => { const html = tabHtml(p, tab); return html.includes("Du er ikke logget ind") || html.includes(lockedWords); }), [false, false, false, false, false]);
		const settings = tabHtml(p, "settings");
		check("try mode: logged in the report, kids and backup are there", [settings.includes('data-action="open-report"'), settings.includes('id="person-form"'), settings.includes('id="import-file"'), tabHtml(p, "overview").includes('id="bank-picture"'), tabHtml(p, "future").includes("Penge nu")], [true, true, true, true, true]);
		page.run("accountName = null; activeTab = 'overview'; render();");
		check("try mode: with accounts switched off the page is as before (no note, saved on the device)", [page.view().includes("Du er ikke logget ind"), page.run("saveData(); localStorage.getItem('budget.v1') !== null")], [false, true]);
	});

	attempt("try mode: in English", () => {
		const p = tryPage(true);
		p.run("setLanguage('en'); var missingTexts = []; (function () { const original = t; t = function (text, values) { if (!Object.prototype.hasOwnProperty.call(ENGLISH, text)) { missingTexts.push(text); } return original(text, values); }; })();");
		const drawn = tabs.map((tab) => tabHtml(p, tab)).join("");
		check("try mode: the English texts are all there", p.run("missingTexts"), []);
		check("try mode: the English note", ["You are not logged in", "Create an account or log in first to get the full version with saved numbers", "Log in or create an account first to use this.", "Read from a picture: log in first", "are not gone"].every((words) => drawn.includes(words)), true);
		check("try mode: no Danish is left in the English note", ["Du er ikke logget ind", "Opret en konto", "log ind først for"].filter((words) => drawn.includes(words)), []);
	});
}

// --- The version number in index.html (the release rule) ---
// Every file of our own that index.html loads must end in the same ?v=x.y.z. A phone that keeps
// an old file next to a new index.html would otherwise mix versions.
const ownFiles = [...indexText.matchAll(/(?:src|href)="([^"]+\.(?:js|css))(\?v=[^"]*)?"/g)]
	.filter((match) => !match[1].startsWith("http"));
check("version: index.html loads our own files", ownFiles.length >= 6, true);
const versions = new Set(ownFiles.map((match) => match[2]));
check("version: every own file has the same ?v=x.y.z", versions.size === 1 && /^\?v=\d+\.\d+\.\d+$/.test([...versions][0]), true);
const changelog = fs.readFileSync(__dirname + "/CHANGELOG.md", "utf8");
const currentVersion = ownFiles[0][2].slice(3);
check("version: CHANGELOG.md has a section for the current version", changelog.includes("## " + currentVersion), true);

console.log("");
if (failures > 0) {
	console.log(failures + " check(s) FAILED");
	process.exit(1);
}
console.log("All checks passed");
