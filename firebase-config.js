"use strict";

// Which Firebase project holds the accounts. Copied from the Firebase console
// (see SETUP-ACCOUNTS.md). null means accounts aren't set up yet, and the page hides them:
// it then works as before, saving on this device only.
//
// These values are not secret: every visitor's browser needs them to find the project.
// What keeps each account's numbers private is firestore.rules, which runs on Firebase's side.
const FIREBASE_CONFIG = {
	apiKey: "AIzaSyAycW0Neo4hlTuXZhvE6Tf3i4xQBOV3NGA",
	authDomain: "maanedsbudget.firebaseapp.com",
	projectId: "maanedsbudget",
	storageBucket: "maanedsbudget.firebasestorage.app",
	messagingSenderId: "329993781979",
	appId: "1:329993781979:web:d3925979e22556c41502fe",
};

// For testing on this computer only. http://localhost:8767/?emulator talks to Firebase's local
// test copy (started with "firebase emulators:start") instead of any real project, using a
// "demo-" project name that Firebase keeps entirely offline.
// http://127.0.0.1:8767/?emulator works too. To the browser it is a different website from
// localhost, with its own saved data, so the two can play "my phone" and "my computer".
const USE_FIREBASE_EMULATOR = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
	&& new URLSearchParams(location.search).has("emulator");
const EMULATOR_CONFIG = {
	apiKey: "demo-key",
	authDomain: "demo-budget.firebaseapp.com",
	projectId: "demo-budget",
};
