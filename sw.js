"use strict";

// sw.js - lets the page open without internet.
//
// A "service worker" sits between the page and the network. It keeps a copy of the page's own files
// (and of Firebase's program files, which the page fetches from Google), and hands them out when the
// network is not there. The numbers themselves were already kept on the phone by Firebase (the
// device copy in account.js); what was missing was the page itself, so it could not even start.
//
// The version comes from the address this file is registered with (sw.js?v=1.23.0, see app.js), so
// every release is a new worker with a new cache, and the old cache is deleted. The page's own files
// end in the same ?v=..., so a copy of an old file is never mixed with a new one.
//
// How each kind of request is answered:
// - the page itself (index.html, also ?kid=...): the network first, so a release shows up at once; the
//   copy only when the network is missing or slow (NETWORK_WAIT_MS).
// - our own files and Firebase's files: the copy first (their addresses carry a version, so a copy never
//   goes stale), the network when there is none, and then a copy is kept.
// - everything else (Firestore's own traffic, the reader of the bank picture, the password checker):
//   not touched at all.

const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE_PREFIX = "budget-";
const CACHE = CACHE_PREFIX + VERSION;

// Our own files that index.html loads with ?v=... (a test checks that this is all of them).
const VERSIONED_FILES = ["style.css", "texts.js", "budget.js", "firebase-config.js", "password.js", "account.js", "kid.js", "scan.js", "app.js"];
// Our own files with no version in their address.
const PLAIN_FILES = ["index.html", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"];
// Firebase's program files, fetched from Google when accounts are on (see FIREBASE_SDK_BASE in account.js).
const FIREBASE_FILES = "https://www.gstatic.com/firebasejs/";

// How long the page waits for the network before it takes the copy.
const NETWORK_WAIT_MS = 4000;

function insideScope(path) {
	return new URL(path, self.registration.scope).href;
}

function filesToKeep() {
	return PLAIN_FILES.map(insideScope).concat(VERSIONED_FILES.map((file) => insideScope(file) + "?v=" + VERSION));
}

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE)
			// "reload": a fresh copy from the server, not one the browser had kept.
			.then((cache) => cache.addAll(filesToKeep().map((address) => new Request(address, { cache: "reload" }))))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches.keys()
			.then((names) => Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE).map((name) => caches.delete(name))))
			.then(() => self.clients.claim()),
	);
});

// The page, whatever its address says after the ? (a kid's link, ?lang=...): one copy, index.html.
function answerPage(request) {
	const key = insideScope("index.html");
	const fromNetwork = fetch(request).then((response) => {
		if (response.ok) {
			const copy = response.clone();
			caches.open(CACHE).then((cache) => cache.put(key, copy));
		}
		return response;
	});
	const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_WAIT_MS));
	return Promise.race([fromNetwork, timeout])
		.then((response) => response || caches.match(key).then((copy) => copy || fromNetwork))
		.catch(() => caches.match(key).then((copy) => copy || Response.error()));
}

// A file with a version in its address: the copy, else the network (and keep what came).
function answerFile(request) {
	return caches.match(request).then((copy) => {
		if (copy) {
			return copy;
		}
		return fetch(request).then((response) => {
			if (response.ok) {
				const keep = response.clone();
				caches.open(CACHE).then((cache) => cache.put(request, keep));
			}
			return response;
		});
	});
}

self.addEventListener("fetch", (event) => {
	const request = event.request;
	if (request.method !== "GET") {
		return;
	}
	const address = new URL(request.url);
	if (request.mode === "navigate" && address.origin === self.location.origin) {
		event.respondWith(answerPage(request));
	} else if (address.origin === self.location.origin || request.url.startsWith(FIREBASE_FILES)) {
		event.respondWith(answerFile(request));
	}
});
