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
check("clean: income rows never have `every`", "every" in cleanedEvery.income[0], false);

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

// --- The version number in index.html (the release rule) ---
// Every file of our own that index.html loads must end in the same ?v=x.y.z. A phone that keeps
// an old file next to a new index.html would otherwise mix versions.
const fs = require("fs");
const indexText = fs.readFileSync(__dirname + "/index.html", "utf8");
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
