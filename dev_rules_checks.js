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
	check("income is not a list", await write(alice, "budgets/alice/months/2026-11", { ...goodFields(), income: str("x") }), "DENY");
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
