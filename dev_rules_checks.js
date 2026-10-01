// dev_rules_checks.js - checks firestore.rules against the local Firebase test copy.
//
// Start the test copy first:   firebase emulators:start --project demo-budget --only auth,firestore
// Then run:                    node dev_rules_checks.js
// Each check says whether the online storage ALLOWED or DENIED a request, and compares with
// what the rules are supposed to do. Run it again whenever firestore.rules changes.

const AUTH = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const FS = "http://127.0.0.1:8080/v1/projects/demo-budget/databases/(default)/documents";
const DOCS = "projects/demo-budget/databases/(default)/documents";

let failures = 0;
let count = 0;

async function makeUser(email) {
	const response = await fetch(AUTH + "/accounts:signUp?key=demo-key", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password: "a-long-test-password-47", returnSecureToken: true }),
	});
	let body = await response.json();
	if (body.error && body.error.message === "EMAIL_EXISTS") {
		// A run before this one made the user already: sign in instead.
		const again = await fetch(AUTH + "/accounts:signInWithPassword?key=demo-key", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, password: "a-long-test-password-47", returnSecureToken: true }),
		});
		body = await again.json();
	}
	if (!body.idToken) throw new Error("could not make " + email + ": " + JSON.stringify(body));
	return body.idToken;
}

const int = (n) => ({ integerValue: String(n) });
const str = (s) => ({ stringValue: s });
const list = (values) => ({ arrayValue: { values } });
const row = (id, name, amount, field) => ({ mapValue: { fields: { id: str(id), name: str(name), [field || "amount"]: int(amount) } } });
// An income or fixed-bill row that starts or stops on a date ("from" / "to").
const datedRow = (id, name, amount, extra) => ({ mapValue: { fields: { id: str(id), name: str(name), amount: int(amount), ...extra } } });
const purchase = (i) => ({ mapValue: { fields: { id: str("s" + i), date: str("2026-09-01"), categoryId: str("c"), amount: int(100), note: str("") } } });

// A good month, which tests then spoil in one way each.
function goodFields() {
	return {
		income: list([row("i1", "Løn", 2500000)]),
		fixed: list([row("f1", "Husleje", 900000)]),
		savings: int(200000),
		categories: list([row("c1", "Mad", 300000, "limit")]),
		spending: list([purchase(1)]),
	};
}

async function write(token, path, fields, options = {}) {
	const update = { name: DOCS + "/" + path, fields };
	const write = { update };
	if (!options.noTimestamp && !options.clientTimestamp) {
		write.updateTransforms = [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }];
	}
	if (options.clientTimestamp) {
		update.fields = { ...fields, updatedAt: { timestampValue: "2020-01-01T00:00:00Z" } };
	}
	const headers = { "Content-Type": "application/json" };
	if (token) headers.Authorization = "Bearer " + token;
	const response = await fetch(FS + ":commit", { method: "POST", headers, body: JSON.stringify({ writes: [write] }) });
	return response.status === 200 ? "ALLOW" : "DENY";
}

async function remove(token, path) {
	const headers = { "Content-Type": "application/json" };
	if (token) headers.Authorization = "Bearer " + token;
	const response = await fetch(FS + ":commit", { method: "POST", headers, body: JSON.stringify({ writes: [{ delete: DOCS + "/" + path }] }) });
	return response.status === 200 ? "ALLOW" : "DENY";
}

async function read(token, path) {
	const headers = {};
	if (token) headers.Authorization = "Bearer " + token;
	const response = await fetch(FS + "/" + path, { headers });
	return response.status === 200 ? "ALLOW" : "DENY";
}

function check(name, actual, expected) {
	count += 1;
	if (actual === expected) {
		console.log("PASS  " + name + " -> " + actual);
	} else {
		failures += 1;
		console.log("FAIL  " + name + " -> got " + actual + ", expected " + expected);
	}
}

async function main() {
	// Start from an empty test database, so an earlier run can't change the answers.
	await fetch("http://127.0.0.1:8080/emulator/v1/projects/demo-budget/databases/(default)/documents", { method: "DELETE" });

	const alice = await makeUser("alice@budget.example.com");
	const bob = await makeUser("bob@budget.example.com");
	const wrongDomain = await makeUser("alice@kortpris.example.com");
	const lookalike = await makeUser("alice@budget.example.com.evil.test");
	const MONTH = "budgets/alice/months/2026-09";

	// The owner
	check("owner writes own month", await write(alice, MONTH, goodFields()), "ALLOW");
	check("owner reads own month", await read(alice, MONTH), "ALLOW");
	check("owner lists own months", await read(alice, "budgets/alice/months"), "ALLOW");
	check("owner rewrites own month (update)", await write(alice, MONTH, goodFields()), "ALLOW");

	// Everyone else
	check("another user reads it", await read(bob, MONTH), "DENY");
	check("another user lists the months", await read(bob, "budgets/alice/months"), "DENY");
	check("another user writes into it", await write(bob, MONTH, goodFields()), "DENY");
	check("another user deletes it", await remove(bob, MONTH), "DENY");
	check("signed-out visitor reads it", await read(null, MONTH), "DENY");
	check("signed-out visitor lists the months", await read(null, "budgets/alice/months"), "DENY");
	check("signed-out visitor writes", await write(null, "budgets/alice/months/2026-10", goodFields()), "DENY");
	check("account from another app (same name, other domain) reads", await read(wrongDomain, MONTH), "DENY");
	check("account from another app writes", await write(wrongDomain, "budgets/alice/months/2026-10", goodFields()), "DENY");
	check("look-alike email domain reads", await read(lookalike, MONTH), "DENY");
	check("look-alike email domain writes", await write(lookalike, "budgets/alice/months/2026-10", goodFields()), "DENY");

	// Bad shapes from the rightful owner
	check("extra field", await write(alice, "budgets/alice/months/2026-11", { ...goodFields(), sneaky: str("x") }), "DENY");
	const noSpending = goodFields(); delete noSpending.spending;
	check("missing field", await write(alice, "budgets/alice/months/2026-11", noSpending), "DENY");
	check("negative savings", await write(alice, "budgets/alice/months/2026-11", { ...goodFields(), savings: int(-1) }), "DENY");
	check("savings as text", await write(alice, "budgets/alice/months/2026-11", { ...goodFields(), savings: str("5") }), "DENY");
	check("savings over 10 million kr", await write(alice, "budgets/alice/months/2026-11", { ...goodFields(), savings: int(1000000001) }), "DENY");
	check("money-I-have-now added (optional field)", await write(alice, "budgets/alice/months/2026-10", { ...goodFields(), startBalance: int(1500000) }), "ALLOW");
	check("money-I-have-now of 0", await write(alice, "budgets/alice/months/2026-10", { ...goodFields(), startBalance: int(0) }), "ALLOW");
	check("money-I-have-now negative", await write(alice, "budgets/alice/months/2026-11", { ...goodFields(), startBalance: int(-1) }), "DENY");
	check("money-I-have-now as text", await write(alice, "budgets/alice/months/2026-11", { ...goodFields(), startBalance: str("5") }), "DENY");
	check("money-I-have-now over 10 million kr", await write(alice, "budgets/alice/months/2026-11", { ...goodFields(), startBalance: int(1000000001) }), "DENY");
	const datedFields = { ...goodFields(), income: list([datedRow("i1", "Dagpenge", 1500000, { to: str("2026-10-11") }), datedRow("i2", "Løn", 3000000, { from: str("2026-10-12") })]), fixed: list([datedRow("f1", "Abonnement", 9900, { from: str("2026-11-01"), to: str("2027-01-31") }), datedRow("f2", "Forsikring", 360000, { every: int(12), from: str("2026-03-15") })]) };
	check("income and fixed rows with from / to dates, and a bill that comes every few months", await write(alice, "budgets/alice/months/2026-10", datedFields), "ALLOW");
	const potEntry = (i) => ({ mapValue: { fields: { id: str("p" + i), date: str("2026-10-05"), person: str("Nathan"), amount: int(i % 2 ? -5000 : 20000), note: str("") } } });
	check("other people's money (pots) added (optional field)", await write(alice, "budgets/alice/months/2026-10", { ...goodFields(), pots: list([potEntry(1), potEntry(2)]) }), "ALLOW");
	check("pots: 500 entries (the most)", await write(alice, "budgets/alice/months/2026-10", { ...goodFields(), pots: list(Array.from({ length: 500 }, (_, i) => potEntry(i))) }), "ALLOW");
	check("pots: 501 entries", await write(alice, "budgets/alice/months/2026-11", { ...goodFields(), pots: list(Array.from({ length: 501 }, (_, i) => potEntry(i))) }), "DENY");
	check("pots: not a list", await write(alice, "budgets/alice/months/2026-11", { ...goodFields(), pots: str("x") }), "DENY");
	// "Money now" (Lønkonto / Opsparing on Fremtid): { account: { amount, at }, savings: { amount, at } }
	const map = (fields) => ({ mapValue: { fields } });
	const typedNumber = (amount, at) => map({ amount: int(amount), at: int(at) });
	const NOW = 1790000000000;   // a moment in milliseconds, around October 2026
	const balancesOf = (fields) => ({ ...goodFields(), balances: map(fields) });
	check("balances: both numbers (optional field)", await write(alice, "budgets/alice/months/2026-10", balancesOf({ account: typedNumber(1200000, NOW), savings: typedNumber(18000000, NOW) })), "ALLOW");
	check("balances: only one of them", await write(alice, "budgets/alice/months/2026-10", balancesOf({ savings: typedNumber(18000000, NOW) })), "ALLOW");
	check("balances: none at all (empty map)", await write(alice, "budgets/alice/months/2026-10", balancesOf({})), "ALLOW");
	check("balances: an overdrawn account (negative)", await write(alice, "budgets/alice/months/2026-10", balancesOf({ account: typedNumber(-30000, NOW) })), "ALLOW");
	check("balances: 0 kr", await write(alice, "budgets/alice/months/2026-10", balancesOf({ account: typedNumber(0, NOW) })), "ALLOW");
	check("balances: exactly 10 million kr", await write(alice, "budgets/alice/months/2026-10", balancesOf({ account: typedNumber(1000000000, NOW) })), "ALLOW");
	check("balances: over 10 million kr", await write(alice, "budgets/alice/months/2026-11", balancesOf({ account: typedNumber(1000000001, NOW) })), "DENY");
	check("balances: below minus 10 million kr", await write(alice, "budgets/alice/months/2026-11", balancesOf({ account: typedNumber(-1000000001, NOW) })), "DENY");
	check("balances: amount as text", await write(alice, "budgets/alice/months/2026-11", balancesOf({ account: map({ amount: str("5"), at: int(NOW) }) })), "DENY");
	check("balances: a decimal amount", await write(alice, "budgets/alice/months/2026-11", balancesOf({ account: map({ amount: { doubleValue: 5.5 }, at: int(NOW) }) })), "DENY");
	check("balances: no moment", await write(alice, "budgets/alice/months/2026-11", balancesOf({ account: map({ amount: int(5) }) })), "DENY");
	check("balances: no amount", await write(alice, "budgets/alice/months/2026-11", balancesOf({ account: map({ at: int(NOW) }) })), "DENY");
	check("balances: moment of 0", await write(alice, "budgets/alice/months/2026-11", balancesOf({ account: typedNumber(5, 0) })), "DENY");
	check("balances: moment far in the future", await write(alice, "budgets/alice/months/2026-11", balancesOf({ account: typedNumber(5, 100000000000001) })), "DENY");
	check("balances: an extra field inside a number", await write(alice, "budgets/alice/months/2026-11", balancesOf({ account: map({ amount: int(5), at: int(NOW), sneaky: str("x") }) })), "DENY");
	check("balances: a third account name", await write(alice, "budgets/alice/months/2026-11", balancesOf({ account: typedNumber(5, NOW), pension: typedNumber(5, NOW) })), "DENY");
	check("balances: a number that is not a map", await write(alice, "budgets/alice/months/2026-11", balancesOf({ account: int(5) })), "DENY");
	check("balances: not a map", await write(alice, "budgets/alice/months/2026-11", { ...goodFields(), balances: str("x") }), "DENY");
	check("balances: a list", await write(alice, "budgets/alice/months/2026-11", { ...goodFields(), balances: list([]) }), "DENY");
	const startEntry = { mapValue: { fields: { id: str("p1"), date: str("2026-10-05"), person: str("Nathan"), amount: int(500000), note: str("Start"), at: int(NOW), start: { booleanValue: true } } } };
	check("pots: an entry with a moment and the start mark", await write(alice, "budgets/alice/months/2026-10", { ...goodFields(), pots: list([startEntry]) }), "ALLOW");
	// A kid's own page: made by the parent, read and added to by whoever holds the link (no sign-in).
	const TOKEN = "k3abcdefghij0123456789xy";   // 24 letters and digits: what the link holds
	const PAGE = "budgets/alice/kidpages/" + TOKEN;
	const kidPage = (extra) => ({ person: str("Nathan"), parentSide: int(500000), ...extra });
	const kidEntry = (extra) => ({ date: str("2026-10-02"), amount: int(-4500), note: str("Is"), at: int(NOW), ...extra });
	const entryPath = (id) => PAGE + "/entries/" + id;
	const anyone = { noTimestamp: true };   // kid entries have no updatedAt
	check("kid page: the owner makes one", await write(alice, PAGE, kidPage()), "ALLOW");
	check("kid page: the owner updates what the parent has written down", await write(alice, PAGE, kidPage({ parentSide: int(480000) })), "ALLOW");
	check("kid page: a negative parent side (kid used more than the start)", await write(alice, PAGE, kidPage({ parentSide: int(-100) })), "ALLOW");
	check("kid page: too short a token", await write(alice, "budgets/alice/kidpages/abc", kidPage()), "DENY");
	check("kid page: a token with capitals", await write(alice, "budgets/alice/kidpages/K3ABCDEFGHIJ0123456789XY", kidPage()), "DENY");
	check("kid page: an extra field", await write(alice, "budgets/alice/kidpages/" + TOKEN.slice(0, -1) + "z", kidPage({ sneaky: str("x") })), "DENY");
	check("kid page: no name", await write(alice, "budgets/alice/kidpages/" + TOKEN.slice(0, -1) + "z", kidPage({ person: str("") })), "DENY");
	check("kid page: a name of 61 letters", await write(alice, "budgets/alice/kidpages/" + TOKEN.slice(0, -1) + "z", kidPage({ person: str("x".repeat(61)) })), "DENY");
	check("kid page: parent side as text", await write(alice, "budgets/alice/kidpages/" + TOKEN.slice(0, -1) + "z", kidPage({ parentSide: str("5") })), "DENY");
	const noSide = kidPage(); delete noSide.parentSide;
	check("kid page: parent side missing", await write(alice, "budgets/alice/kidpages/" + TOKEN.slice(0, -1) + "z", noSide), "DENY");
	check("kid page: a client-made timestamp", await write(alice, "budgets/alice/kidpages/" + TOKEN.slice(0, -1) + "z", kidPage(), { clientTimestamp: true }), "DENY");
	check("kid page: another user makes one in alice's name", await write(bob, "budgets/alice/kidpages/" + TOKEN.slice(0, -1) + "y", kidPage()), "DENY");
	check("kid page: a signed-out visitor makes one", await write(null, "budgets/alice/kidpages/" + TOKEN.slice(0, -1) + "y", kidPage()), "DENY");
	check("kid page: the link holder reads the page (no sign-in)", await read(null, PAGE), "ALLOW");
	check("kid page: the link holder reads the entries (no sign-in)", await read(null, PAGE + "/entries"), "ALLOW");
	check("kid page: a signed-out visitor lists the pages", await read(null, "budgets/alice/kidpages"), "DENY");
	check("kid page: another user lists the pages", await read(bob, "budgets/alice/kidpages"), "DENY");
	check("kid page: the owner lists the pages", await read(alice, "budgets/alice/kidpages"), "ALLOW");
	check("kid page: the link holder cannot change the page", await write(null, PAGE, kidPage({ parentSide: int(99999999) })), "DENY");
	check("kid page: the link holder cannot delete the page", await remove(null, PAGE), "DENY");
	check("kid entry: the kid writes what they used (no sign-in)", await write(null, entryPath("e1abcdef01"), kidEntry(), anyone), "ALLOW");
	check("kid entry: a second one", await write(null, entryPath("e2abcdef02"), kidEntry({ amount: int(-100), note: str("") }), anyone), "ALLOW");
	check("kid entry: an amount of -10 million kr (the most)", await write(null, entryPath("e3abcdef03"), kidEntry({ amount: int(-1000000000) }), anyone), "ALLOW");
	check("kid entry: more than 10 million kr", await write(null, entryPath("e4abcdef04"), kidEntry({ amount: int(-1000000001) }), anyone), "DENY");
	check("kid entry: money ADDED (positive amount)", await write(null, entryPath("e5abcdef05"), kidEntry({ amount: int(4500) }), anyone), "DENY");
	check("kid entry: an amount of 0", await write(null, entryPath("e5abcdef06"), kidEntry({ amount: int(0) }), anyone), "DENY");
	check("kid entry: the amount as text", await write(null, entryPath("e5abcdef07"), kidEntry({ amount: str("-5") }), anyone), "DENY");
	check("kid entry: a decimal amount", await write(null, entryPath("e5abcdef08"), kidEntry({ amount: { doubleValue: -5.5 } }), anyone), "DENY");
	check("kid entry: an extra field", await write(null, entryPath("e5abcdef09"), kidEntry({ sneaky: str("x") }), anyone), "DENY");
	const noNote = kidEntry(); delete noNote.note;
	check("kid entry: a missing field", await write(null, entryPath("e5abcdef10"), noNote, anyone), "DENY");
	check("kid entry: a note of 100 letters (the most)", await write(null, entryPath("e6abcdef11"), kidEntry({ note: str("x".repeat(100)) }), anyone), "ALLOW");
	check("kid entry: a note of 101 letters", await write(null, entryPath("e5abcdef12"), kidEntry({ note: str("x".repeat(101)) }), anyone), "DENY");
	check("kid entry: not a date", await write(null, entryPath("e5abcdef13"), kidEntry({ date: str("i dag") }), anyone), "DENY");
	check("kid entry: a moment of 0", await write(null, entryPath("e5abcdef14"), kidEntry({ at: int(0) }), anyone), "DENY");
	check("kid entry: a name that is too short", await write(null, entryPath("ab"), kidEntry(), anyone), "DENY");
	check("kid entry: a name with capitals", await write(null, entryPath("E1ABCDEF99"), kidEntry(), anyone), "DENY");
	check("kid entry: on a page that does not exist", await write(null, "budgets/alice/kidpages/zzzzzzzzzzzzzzzzzzzzzzzz/entries/e1abcdef01", kidEntry(), anyone), "DENY");
	check("kid entry: written again (changed) by the link holder", await write(null, entryPath("e1abcdef01"), kidEntry({ amount: int(-1) }), anyone), "DENY");
	check("kid entry: deleted by the link holder", await remove(null, entryPath("e1abcdef01")), "DENY");
	check("kid entry: deleted by another user", await remove(bob, entryPath("e1abcdef01")), "DENY");
	check("kid entry: deleted by the owner (a mistake)", await remove(alice, entryPath("e1abcdef01")), "ALLOW");
	check("kid page: the link holder still cannot reach the budget itself", await read(null, "budgets/alice/months/2026-10"), "DENY");
	check("kid page: ... or list it", await read(null, "budgets/alice/months"), "DENY");
	check("kid page: the owner takes the link away", await remove(alice, PAGE), "ALLOW");
	check("kid page: after that the page is gone for the link holder", await read(null, PAGE), "DENY");   // REST gives 404 for a missing document
	check("kid entry: and nothing can be added any more", await write(null, entryPath("e7abcdef15"), kidEntry(), anyone), "DENY");
	check("income is not a list",await write(alice, "budgets/alice/months/2026-11", { ...goodFields(), income: str("x") }), "DENY");
	check("bad month name 2026-13", await write(alice, "budgets/alice/months/2026-13", goodFields()), "DENY");
	check("bad month name abcd", await write(alice, "budgets/alice/months/abcd", goodFields()), "DENY");
	check("bad month name with extra text", await write(alice, "budgets/alice/months/2026-09x", goodFields()), "DENY");
	check("client-made timestamp", await write(alice, "budgets/alice/months/2026-11", goodFields(), { clientTimestamp: true }), "DENY");
	check("no timestamp", await write(alice, "budgets/alice/months/2026-11", goodFields(), { noTimestamp: true }), "DENY");

	// Limits on rows
	const spending = (n) => list(Array.from({ length: n }, (_, i) => purchase(i)));
	check("2000 purchases (the most)", await write(alice, "budgets/alice/months/2026-12", { ...goodFields(), spending: spending(2000) }), "ALLOW");
	check("2001 purchases", await write(alice, "budgets/alice/months/2027-01", { ...goodFields(), spending: spending(2001) }), "DENY");
	const rows = (n) => list(Array.from({ length: n }, (_, i) => row("r" + i, "x", 1)));
	check("50 income rows (the most)", await write(alice, "budgets/alice/months/2027-02", { ...goodFields(), income: rows(50) }), "ALLOW");
	check("51 income rows", await write(alice, "budgets/alice/months/2027-03", { ...goodFields(), income: rows(51) }), "DENY");
	check("101 fixed rows", await write(alice, "budgets/alice/months/2027-03", { ...goodFields(), fixed: rows(101) }), "DENY");
	check("51 categories", await write(alice, "budgets/alice/months/2027-03", { ...goodFields(), categories: rows(51) }), "DENY");

	// Other places in the database are closed
	check("owner writes somewhere else (collections/alice)", await write(alice, "collections/alice", goodFields()), "DENY");
	check("owner writes the username document itself", await write(alice, "budgets/alice", goodFields()), "DENY");
	check("owner writes a deeper path", await write(alice, "budgets/alice/months/2026-09/extra/x", goodFields()), "DENY");
	check("owner reads somewhere else", await read(alice, "collections/alice"), "DENY");

	// Deleting
	check("owner deletes own month", await remove(alice, MONTH), "ALLOW");
	check("owner reads the deleted month (gone)", await read(alice, MONTH), "DENY");   // REST gives 404 for a missing document

	console.log("");
	console.log(count + " checks, " + failures + " failed");
	process.exit(failures ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(2); });
