"use strict";

// Accounts: a username and password per person, with that person's budget kept online,
// so it is the same on every phone and computer they sign in on. Built on Google's Firebase:
// - Firebase Authentication checks passwords. It stores them scrambled, never readable,
//   and slows down anyone trying lots of guesses.
// - Firestore stores the budget. firestore.rules decides who may read it.
//
// This file only talks to Firebase. It draws nothing; app.js does the screens.

// Firebase's official web files, fetched only when accounts are switched on.
const FIREBASE_SDK_BASE = "https://www.gstatic.com/firebasejs/12.19.0/";
// Firebase accounts need an email address, but a username is easier. So every username gets
// a made-up address at a domain reserved for examples, where no mail is ever delivered.
// firestore.rules must use the same domain.
const USERNAME_EMAIL_DOMAIN = "budget.example.com";
// Firestore: each account's months are the documents budgets/<username>/months/<2026-09>.
// One document per month, so a long history never gets one giant document.
const BUDGET_FOLDER = "budgets";
const MONTHS_FOLDER = "months";
// Lowercase letters a-z, digits, - and _. Letters like æ, ø and å can't be in an email address.
const USERNAME_PATTERN = /^[a-z0-9_-]{3,20}$/;

let firebase = null;   // { auth, db, authModule, firestoreModule } once started

function accountsAvailable() {
	return FIREBASE_CONFIG !== null || USE_FIREBASE_EMULATOR;
}

// Starts Firebase and calls onAccountChange(username) whenever someone signs in,
// and onAccountChange(null) when nobody is signed in. Firebase remembers who was signed in
// on this device, so the first call can already have a username.
async function startAccounts(onAccountChange) {
	const [appModule, authModule, firestoreModule] = await Promise.all([
		import(FIREBASE_SDK_BASE + "firebase-app.js"),
		import(FIREBASE_SDK_BASE + "firebase-auth.js"),
		import(FIREBASE_SDK_BASE + "firebase-firestore.js"),
	]);
	const app = appModule.initializeApp(firebaseSettings());
	const auth = authModule.getAuth(app);
	const db = firestoreModule.initializeFirestore(app, { localCache: deviceCopy(firestoreModule) });
	if (USE_FIREBASE_EMULATOR) {
		authModule.connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
		firestoreModule.connectFirestoreEmulator(db, "localhost", 8080);
	}
	firebase = { auth, db, authModule, firestoreModule };
	authModule.onAuthStateChanged(auth, (user) => onAccountChange(user ? usernameOf(user) : null));
}

function firebaseSettings() {
	return USE_FIREBASE_EMULATOR ? EMULATOR_CONFIG : FIREBASE_CONFIG;
}

// A kid's own page needs no sign-in (the link is the key), so this starts only the database.
async function startKidFirebase() {
	const [appModule, firestoreModule] = await Promise.all([
		import(FIREBASE_SDK_BASE + "firebase-app.js"),
		import(FIREBASE_SDK_BASE + "firebase-firestore.js"),
	]);
	const app = appModule.initializeApp(firebaseSettings());
	const db = firestoreModule.initializeFirestore(app, { localCache: deviceCopy(firestoreModule) });
	if (USE_FIREBASE_EMULATOR) {
		firestoreModule.connectFirestoreEmulator(db, "localhost", 8080);
	}
	firebase = { auth: null, db, authModule: null, firestoreModule };
}

// Firestore keeps a copy of the account's months in the device's own database (IndexedDB),
// so they show up fast, and changes made while offline are sent when the device is online
// again. Where the device won't keep one (some private browsing), the copy lives in memory only.
function deviceCopy(firestoreModule) {
	const { persistentLocalCache, persistentMultipleTabManager, memoryLocalCache } = firestoreModule;
	try {
		// "Multiple tab": the page open in two tabs shares the one copy.
		return persistentLocalCache({ tabManager: persistentMultipleTabManager() });
	} catch (error) {
		console.error(error);
		return memoryLocalCache();
	}
}

function cleanUsername(text) {
	return text.trim().toLowerCase();
}

function isValidUsername(username) {
	return USERNAME_PATTERN.test(username);
}

function emailFor(username) {
	return username + "@" + USERNAME_EMAIL_DOMAIN;
}

function usernameOf(user) {
	return (user.email || "").split("@")[0];
}

async function createAccount(username, password) {
	await firebase.authModule.createUserWithEmailAndPassword(firebase.auth, emailFor(username), password);
}

async function signIn(username, password) {
	await firebase.authModule.signInWithEmailAndPassword(firebase.auth, emailFor(username), password);
}

async function signOutOfAccount() {
	await firebase.authModule.signOut(firebase.auth);
}

// Calls onMonths(months, confirmed, hasPendingWrites) now and every time the account's months
// change - on this device or on another one. months is { "2026-09": {...}, ... }.
// - confirmed is true once Firebase itself has answered. Offline, the device's own copy is
//   used first, and "no months" from that copy means only "nothing kept here yet".
// - hasPendingWrites is true while changes made here haven't reached Firebase yet.
// Returns a function that stops listening.
function watchAccountMonths(username, onMonths, onProblem) {
	const { collection, onSnapshot } = firebase.firestoreModule;
	return onSnapshot(
		collection(firebase.db, BUDGET_FOLDER, username, MONTHS_FOLDER),
		// Told also when only where the news came from changes (device copy -> Firebase).
		{ includeMetadataChanges: true },
		(snapshot) => {
			const months = {};
			snapshot.forEach((document) => {
				months[document.id] = document.data();
			});
			onMonths(months, !snapshot.metadata.fromCache, snapshot.metadata.hasPendingWrites);
		},
		(error) => onProblem(error),
	);
}

// Saves one whole month. The promise finishes when Firebase has it; offline, that is later.
async function saveAccountMonth(username, key, month) {
	const { doc, setDoc, serverTimestamp } = firebase.firestoreModule;
	const fields = {
		income: month.income,
		fixed: month.fixed,
		savings: month.savings,
		categories: month.categories,
		spending: month.spending,
		updatedAt: serverTimestamp(),
	};
	// "Money I have now" (Fremtid) was added later. It is only sent when it is set, so a month
	// without one still passes the rules published before it existed.
	if (month.startBalance > 0) {
		fields.startBalance = month.startBalance;
	}
	// Same for the kids' money (Børn): only sent when there are entries, so a month without any
	// passes the rules published before they existed.
	if (month.pots && month.pots.length > 0) {
		fields.pots = month.pots;
	}
	// And for the typed account numbers (Lønkonto, Opsparing on Fremtid).
	if (month.balances && Object.keys(month.balances).length > 0) {
		fields.balances = month.balances;
	}
	await setDoc(doc(firebase.db, BUDGET_FOLDER, username, MONTHS_FOLDER, key), fields);
}

// ---- The kids' own pages ----------------------------------------------------------
//
// budgets/<username>/kidpages/<token>           { person, parentSide, updatedAt }  (the parent writes it)
// budgets/<username>/kidpages/<token>/entries/<id>  { date, amount, note, at }     (the kid adds these)
// The token is the secret in the kid's link. See "The kids' own page" in budget.js for how the
// numbers fit together, and firestore.rules for who may do what.

const KIDPAGES_FOLDER = "kidpages";
const KIDENTRIES_FOLDER = "entries";

// The parent: calls onPages({ <token>: { person, parentSide } }, confirmed) now and whenever a kid
// page is added, changed or removed. Returns a function that stops listening.
function watchKidPages(username, onPages, onProblem) {
	const { collection, onSnapshot } = firebase.firestoreModule;
	return onSnapshot(
		collection(firebase.db, BUDGET_FOLDER, username, KIDPAGES_FOLDER),
		(snapshot) => {
			const pages = {};
			snapshot.forEach((document) => {
				const data = document.data();
				pages[document.id] = { person: String(data.person || ""), parentSide: Number(data.parentSide) || 0 };
			});
			onPages(pages, !snapshot.metadata.fromCache);
		},
		(error) => onProblem(error),
	);
}

// The parent: calls onEntries([{ id, date, amount, note, at }]) for one kid page's entries.
function watchKidEntries(username, token, onEntries, onProblem) {
	const { collection, onSnapshot } = firebase.firestoreModule;
	return onSnapshot(
		collection(firebase.db, BUDGET_FOLDER, username, KIDPAGES_FOLDER, token, KIDENTRIES_FOLDER),
		(snapshot) => {
			const entries = [];
			snapshot.forEach((document) => {
				const entry = cleanKidEntry(document.id, document.data());
				if (entry !== null) {
					entries.push(entry);
				}
			});
			onEntries(entries);
		},
		(error) => onProblem(error),
	);
}

// The parent: makes a kid page, or updates what the parent has written down for the kid.
// The whole page is written every time, because firestore.rules wants every field.
async function saveKidPage(username, token, person, parentSide) {
	const { doc, setDoc, serverTimestamp } = firebase.firestoreModule;
	await setDoc(doc(firebase.db, BUDGET_FOLDER, username, KIDPAGES_FOLDER, token), {
		person: person,
		parentSide: parentSide,
		updatedAt: serverTimestamp(),
	});
}

// The parent: takes the link away. The entries go first, because they cannot be added any more
// once the page itself is gone, and a page without entries is all that is left to delete.
async function deleteKidPage(username, token) {
	const { collection, doc, getDocs, deleteDoc } = firebase.firestoreModule;
	const entries = await getDocs(collection(firebase.db, BUDGET_FOLDER, username, KIDPAGES_FOLDER, token, KIDENTRIES_FOLDER));
	for (const entry of entries.docs) {
		await deleteDoc(entry.ref);
	}
	await deleteDoc(doc(firebase.db, BUDGET_FOLDER, username, KIDPAGES_FOLDER, token));
}

// The parent: removes one entry the kid wrote (a mistake).
async function deleteKidEntry(username, token, entryId) {
	const { doc, deleteDoc } = firebase.firestoreModule;
	await deleteDoc(doc(firebase.db, BUDGET_FOLDER, username, KIDPAGES_FOLDER, token, KIDENTRIES_FOLDER, entryId));
}

// The kid: calls onPage({ person, parentSide }) (or onPage(null) when the link no longer works) and
// onEntries([...]) now and whenever they change. Returns a function that stops listening.
function watchKidOwnPage(parent, token, onPage, onEntries, onProblem) {
	const { collection, doc, onSnapshot } = firebase.firestoreModule;
	const stopPage = onSnapshot(
		doc(firebase.db, BUDGET_FOLDER, parent, KIDPAGES_FOLDER, token),
		(snapshot) => {
			const data = snapshot.exists() ? snapshot.data() : null;
			// From the device's own copy, "no page" only means "nothing kept here yet": wait for the answer.
			if (data === null && snapshot.metadata.fromCache) {
				return;
			}
			onPage(data === null ? null : { person: String(data.person || ""), parentSide: Number(data.parentSide) || 0 });
		},
		(error) => onProblem(error),
	);
	const stopEntries = onSnapshot(
		collection(firebase.db, BUDGET_FOLDER, parent, KIDPAGES_FOLDER, token, KIDENTRIES_FOLDER),
		(snapshot) => {
			const entries = [];
			snapshot.forEach((document) => {
				const entry = cleanKidEntry(document.id, document.data());
				if (entry !== null) {
					entries.push(entry);
				}
			});
			onEntries(entries);
		},
		(error) => onProblem(error),
	);
	return () => {
		stopPage();
		stopEntries();
	};
}

// The kid: writes down what they used (amount is negative). One new document, never changed after.
async function addKidEntry(parent, token, entryId, entry) {
	const { doc, setDoc } = firebase.firestoreModule;
	await setDoc(doc(firebase.db, BUDGET_FOLDER, parent, KIDPAGES_FOLDER, token, KIDENTRIES_FOLDER, entryId), {
		date: entry.date,
		amount: entry.amount,
		note: entry.note,
		at: entry.at,
	});
}


// Turns a Firebase error into a message for the user, in the page's language.
function accountProblemText(error) {
	const code = (error && error.code) || "";
	switch (code) {
		case "auth/email-already-in-use":
			return t("Det brugernavn er optaget. Vælg et andet.");
		case "auth/invalid-credential":
		case "auth/invalid-login-credentials":
		case "auth/wrong-password":
		case "auth/user-not-found":
			return t("Brugernavn eller adgangskode passer ikke.");
		case "auth/too-many-requests":
			return t("For mange forsøg. Vent lidt og prøv igen.");
		case "auth/weak-password":
		case "auth/password-does-not-meet-requirements":
			// Firebase can also require a capital letter, a small letter and a digit, depending on
			// what is ticked in its console (see SETUP-ACCOUNTS.md, step 4).
			return t("Firebase afviste adgangskoden. Den skal være mindst 10 tegn, og Firebase kan også kræve store og små bogstaver og tal. Brug fx \"Lilla-tiger-raket-47\".");
		case "auth/operation-not-allowed":
		case "auth/admin-restricted-operation":
			return t("Det er lukket for nye konti lige nu.");
		case "auth/configuration-not-found":
			return t("Konti er ikke sat op endnu (se SETUP-ACCOUNTS.md).");
		case "auth/network-request-failed":
		case "unavailable":
			return t("Ingen forbindelse til internettet.");
		case "permission-denied":
			return t("Kontoen måtte ikke gemme det. Er reglerne i Firebase lagt ind? (se SETUP-ACCOUNTS.md, trin 6)");
		default:
			return t("Noget gik galt ({code}).", { code: code || String(error) });
	}
}
