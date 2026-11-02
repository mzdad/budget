// test_sw.js - checks sw.js (the worker that lets the page open without internet), run by test.js.
//
// A real worker needs a browser, so this one is run here with pretend versions of what a worker is
// given: a small `caches`, a `fetch` that can be switched off ("no internet"), and the events.

const fs = require("fs");
const vm = require("vm");

const ORIGIN = "https://budget.example.org";
const SCOPE = ORIGIN + "/app/";

function pretendWorker(version) {
	const source = fs.readFileSync(__dirname + "/sw.js", "utf8");
	const handlers = {};
	const stores = new Map();
	const calls = { network: [] };
	let online = true;

	const keyOf = (request) => (typeof request === "string" ? new URL(request).href : request.url);
	const caches = {
		open: async (name) => {
			if (!stores.has(name)) {
				stores.set(name, new Map());
			}
			const store = stores.get(name);
			return {
				put: async (request, response) => { store.set(keyOf(request), response); },
				addAll: async (requests) => {
					for (const request of requests) {
						const response = await pretendFetch(request);
						if (!response.ok) {
							throw new Error("could not fetch " + keyOf(request));
						}
						store.set(keyOf(request), response);
					}
				},
			};
		},
		keys: async () => [...stores.keys()],
		delete: async (name) => stores.delete(name),
		match: async (request) => {
			for (const store of stores.values()) {
				const found = store.get(keyOf(request));
				if (found) {
					return found.clone();
				}
			}
			return undefined;
		},
	};

	async function pretendFetch(request) {
		const address = keyOf(request);
		calls.network.push(address);
		if (online === "slow") {
			return new Promise(() => {});   // never answers
		}
		if (!online) {
			throw new TypeError("no internet");
		}
		return new Response("from the network: " + address, { status: address.includes("missing") ? 404 : 200 });
	}

	const context = {
		URL, Request, Response, Promise, Error, TypeError, console,
		fetch: pretendFetch,
		caches,
		// The 4 seconds the page waits for the network become 10 milliseconds.
		setTimeout: (action, ms) => setTimeout(action, ms / 400),
		self: {
			location: { href: SCOPE + "sw.js?v=" + version, origin: ORIGIN },
			registration: { scope: SCOPE },
			clients: { claim: async () => {} },
			skipWaiting: async () => {},
			addEventListener: (type, handler) => { handlers[type] = handler; },
		},
	};
	vm.runInNewContext(source, context);

	async function fire(type, event) {
		const waiting = [];
		let answer = null;
		event.waitUntil = (promise) => waiting.push(promise);
		event.respondWith = (promise) => { answer = promise; };
		handlers[type](event);
		await Promise.all(waiting);
		return answer === null ? null : answer;
	}
	const text = async (response) => (response ? response.text() : null);

	return {
		stores, calls,
		goOffline: () => { online = false; },
		goOnline: () => { online = true; },
		goSlow: () => { online = "slow"; },
		install: () => fire("install", {}),
		activate: () => fire("activate", {}),
		// Asks for an address, as the page (mode "navigate") or as a file, and says what came back.
		ask: async (address, options) => {
			const request = { method: (options && options.method) || "GET", url: address, mode: (options && options.mode) || "no-cors" };
			const answer = await fire("fetch", { request });
			return answer === null ? "not handled" : text(await answer);
		},
	};
}

async function run(check, ownFiles) {
	const version = "9.8.7";
	const worker = pretendWorker(version);
	await worker.install();

	const kept = [...worker.stores.get("budget-" + version).keys()].map((address) => address.replace(SCOPE, ""));
	const wanted = ["index.html"].concat(ownFiles.map((file) => file + "?v=" + version));
	check("offline copy: install keeps index.html and every own file index.html loads", wanted.filter((file) => !kept.includes(file)), []);
	check("offline copy: install keeps the manifest and the icons", ["manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"].filter((file) => !kept.includes(file)), []);
	check("offline copy: install asks the server for fresh copies", worker.calls.network.length >= kept.length, true);

	// Old caches of the page go when a new worker takes over; other sites' caches stay.
	worker.stores.set("budget-1.0.0", new Map());
	worker.stores.set("something-else", new Map());
	await worker.activate();
	check("offline copy: activate deletes the old version's cache and nothing else", [...worker.stores.keys()].sort(), ["budget-" + version, "something-else"]);

	// Online: the page comes from the network (so a release shows at once), and the copy is renewed.
	const page = SCOPE + "index.html?kid=abc.def";
	check("offline copy: the page comes from the network when there is internet", await worker.ask(page, { mode: "navigate" }), "from the network: " + page);
	await new Promise((resolve) => setTimeout(resolve, 20));
	// Offline: the page (any address after the ?) comes from the copy.
	worker.goOffline();
	const offlinePage = await worker.ask(SCOPE + "?lang=da", { mode: "navigate" });
	check("offline copy: without internet the page comes from the copy", offlinePage, "from the network: " + page);

	// Own files: the copy first, also without internet; a file with no copy comes from the network and is kept.
	const script = SCOPE + "app.js?v=" + version;
	const before = worker.calls.network.length;
	check("offline copy: an own file comes from the copy without internet", (await worker.ask(script)).startsWith("from the network: " + script), true);
	check("offline copy: ... and without asking the network", worker.calls.network.length, before);
	worker.goOnline();
	const firebase = "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
	check("offline copy: Firebase's files come from the network the first time", await worker.ask(firebase), "from the network: " + firebase);
	await new Promise((resolve) => setTimeout(resolve, 20));
	worker.goOffline();
	check("offline copy: ... and from the copy after that", await worker.ask(firebase), "from the network: " + firebase);

	// What the worker must leave alone.
	check("offline copy: a change (POST) is not touched", await worker.ask(SCOPE + "app.js?v=" + version, { method: "POST" }), "not handled");
	check("offline copy: other sites (the reader of the bank picture, Firestore) are not touched", [
		await worker.ask("https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js"),
		await worker.ask("https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel"),
	], ["not handled", "not handled"]);

	// A missing file (404) is passed on, not kept as a copy.
	worker.goOnline();
	const gone = SCOPE + "missing.js?v=" + version;
	await worker.ask(gone);
	await new Promise((resolve) => setTimeout(resolve, 20));
	check("offline copy: an answer that is not OK is never kept", [...worker.stores.get("budget-" + version).keys()].includes(gone), false);

	// A slow network: after the wait the copy is used, instead of waiting for ever.
	worker.goSlow();
	const slowPage = await worker.ask(SCOPE + "index.html", { mode: "navigate" });
	check("offline copy: a network that does not answer gives the copy after a short wait", slowPage, "from the network: " + page);
}

module.exports = { run };
