"use strict";

// The kid's own page. A parent gives a kid a private link (Indstillinger -> Børn), and opened with
// that link the page shows only this: what the kid has, and a box to write what they used.
// Nothing else - no budget, no tabs, and no way to add money.
//
// The link is ...?kid=<account>.<token>. The token is the key: firestore.rules lets whoever has
// it read that one page and add entries to it. There is no password. The page remembers the link
// on this device, so the icon on the home screen opens the kid's page too.
//
// The numbers: the kid's page shows parentSide (what the parent has written down for the kid)
// plus the kid's own entries. See "The kids' own page" in budget.js.

const KID_KEY_STORAGE = "budget.kid";

// The link this page was opened with, or the one remembered on this device. null = a normal start.
function findKidKey() {
	let fromLink = null;
	try {
		fromLink = new URLSearchParams(location.search).get("kid");
	} catch (error) {
		fromLink = null;
	}
	if (fromLink !== null) {
		const key = parseKidKey(fromLink);
		if (key !== null) {
			rememberKidKey(fromLink);
		}
		return key;   // a broken link gives null, and the normal page opens
	}
	try {
		return parseKidKey(localStorage.getItem(KID_KEY_STORAGE));
	} catch (error) {
		return null;
	}
}

function rememberKidKey(text) {
	try {
		localStorage.setItem(KID_KEY_STORAGE, text);
	} catch (error) {
		// Only a convenience (the home-screen icon); the link itself still works.
	}
}

// ---- The home-screen icon, and a link pasted in -------------------------------------
//
// An icon on the home screen starts at the manifest's start_url. manifest.webmanifest has none on
// purpose, so the icon starts at the address it was made from: the kid's link. (It used to say "./",
// which dropped ?kid=... and opened the normal page, with the login, instead of the kid's page.) In
// kid mode we also hand the browser a manifest of our own whose start_url IS the kid's link. And an
// icon on an iPhone has its own storage, apart from Safari's, so it cannot find a link remembered
// there: the page shown when nobody is logged in has a box to paste the link into, once.

// The kid's link as this page would give it out: the address of the page, ?kid=..., the language and the currency.
function kidStartUrl(key) {
	return kidLink(location.origin + location.pathname, key.parent, key.token) + "&lang=" + getLanguage() + "&cur=" + getCurrency();
}

// The manifest of the kid's page, as an object. Every address in it must be a whole address,
// because it is not read from the page's own folder.
function kidManifest(startUrl) {
	const folder = new URL("./", startUrl).href;
	return {
		name: t("Månedsbudget"),
		short_name: t("Budget"),
		lang: getLanguage(),
		start_url: startUrl,
		scope: folder,
		display: "standalone",
		background_color: "#f4f6f4",
		theme_color: "#1f7a5a",
		icons: [
			{ src: new URL("icon-192.png", folder).href, sizes: "192x192", type: "image/png" },
			{ src: new URL("icon-512.png", folder).href, sizes: "512x512", type: "image/png" },
		],
	};
}

// Puts the kid's manifest in place of the page's own, so a shortcut made from here starts at the kid's link.
function useKidManifest(key) {
	try {
		const link = document.querySelector('link[rel="manifest"]');
		if (!link) {
			return;
		}
		const text = JSON.stringify(kidManifest(kidStartUrl(key)));
		link.href = URL.createObjectURL(new Blob([text], { type: "application/manifest+json" }));
	} catch (error) {
		// Only for the home-screen icon; the page works without it.
		console.warn("Could not set the home-screen address:", error);
	}
}

// The link a kid pasted: the whole link (https://.../?kid=mama.abc...&lang=en&cur=DKK), or only
// the part after ?kid= ("mama.abc..."). Returns { key, lang, cur } or null if it is not one.
function readPastedKidLink(pasted) {
	const text = String(pasted || "").trim();
	if (parseKidKey(text) !== null) {
		return { key: text, lang: null, cur: null };
	}
	try {
		const url = new URL(text, "https://example.invalid/");
		const key = url.searchParams.get("kid") || "";
		if (parseKidKey(key) === null) {
			return null;
		}
		return { key: key, lang: url.searchParams.get("lang"), cur: url.searchParams.get("cur") };
	} catch (error) {
		return null;
	}
}

// Opens the kid's page from a pasted link: remembers it on this device (so this icon keeps opening
// it) and goes there. Returns false, doing nothing, if the text is not a kid's link.
function openPastedKidLink(pasted) {
	const found = readPastedKidLink(pasted);
	if (found === null) {
		return false;
	}
	rememberKidKey(found.key);
	if (LANGUAGES.some((language) => language.id === found.lang)) {
		saveLanguage(found.lang);
	}
	if (CURRENCIES.includes(found.cur)) {
		saveCurrency(found.cur);
	}
	location.assign(location.origin + location.pathname + "?kid=" + found.key + (USE_FIREBASE_EMULATOR ? "&emulator" : ""));
	return true;
}

// "Ikke dig?": forget the link on this device and open the normal budget page.
function leaveKidMode() {
	try {
		localStorage.removeItem(KID_KEY_STORAGE);
	} catch (error) {
		// Nothing to forget.
	}
	location.href = location.pathname + (USE_FIREBASE_EMULATOR ? "?emulator" : "");
}


// ---- What is on the kid's screen ---------------------------------------------------

let kidKey = null;          // { parent, token }
let kidStop = null;         // call it to stop listening
const kidState = {
	status: "loading",      // "loading", "ready", "gone" (the link was taken away) or "failed"
	person: "",
	parentSide: 0,
	entries: [],
	message: "",
	messageIsError: false,
};

// What the kid has: what the parent wrote down, plus what the kid used.
function kidTotal() {
	return kidState.parentSide + kidState.entries.reduce((sum, entry) => sum + entry.amount, 0);
}

// The whole kid screen as HTML. Takes the state as it is given, so it can be tested on its own.
function kidScreenHtml(state, total) {
	const leave = '<p class="hint kid-leave"><button type="button" class="link" data-kid-action="leave">' + t("Ikke dig? Åbn budgettet") + "</button></p>";

	if (state.status === "loading") {
		return '<section class="card"><h2>' + t("Henter …") + '</h2><p class="hint">' + t("Et øjeblik.") + "</p></section>";
	}
	if (state.status === "gone") {
		return '<section class="card"><h2>' + t("Linket virker ikke mere") + '</h2><p class="hint">' + t("Bed om et nyt link.") + "</p></section>" + leave;
	}
	if (state.status === "failed") {
		return '<section class="card"><h2>' + t("Kunne ikke hente") + '</h2><p class="hint">' + t("Tjek, at du har internet, og prøv igen.") + '</p><button class="primary" data-kid-action="retry">' + t("Prøv igen") + "</button></section>" + leave;
	}

	const name = esc(state.person);
	return `
		<section class="card">
			<div class="label">${t("{name} har", { name: name })}</div>
			<div class="big-number ${total < 0 ? "bad" : ""}" id="kid-total">${formatKr(total)}</div>
		</section>
		<form id="kid-form" class="card" autocomplete="off">
			<h2>${t("Brugte du penge?")}</h2>
			<label>${howManyLabel()}
				<input name="amount" inputmode="decimal" placeholder="${t("fx 25")}" required>
			</label>
			<label>${t("Hvad købte du? (hvis du vil)")}
				<input name="note" maxlength="${MAX_NOTE_LENGTH}">
			</label>
			<button type="submit" class="primary">${t("Skriv ind")}</button>
			<p class="message ${state.messageIsError ? "bad" : ""}" role="status">${esc(state.message)}</p>
		</form>
		${leave}`;
}

function renderKid() {
	document.getElementById("view").innerHTML = kidScreenHtml(kidState, kidTotal());
}

// News arrived while the kid may be typing: redrawing would wipe the box, so only the number moves.
function kidNews() {
	const element = document.activeElement;
	const typing = !!element && element.matches("#view input");
	const total = document.getElementById("kid-total");
	if (typing && total && kidState.status === "ready") {
		total.textContent = formatKr(kidTotal());
		total.classList.toggle("bad", kidTotal() < 0);
		return;
	}
	renderKid();
}


// ---- Starting, and writing an entry ---------------------------------------------------

async function startKidMode(key) {
	kidKey = key;
	document.body.classList.add("kid-mode");
	useKidManifest(key);
	if (kidStop) {
		kidStop();
		kidStop = null;
	}
	kidState.status = "loading";
	renderKid();
	try {
		await startKidFirebase();
		kidStop = watchKidOwnPage(key.parent, key.token, onKidPage, onKidEntries, onKidProblem);
	} catch (error) {
		onKidProblem(error);
	}
}

function onKidPage(page) {
	if (page === null) {
		kidState.status = "gone";
	} else {
		kidState.status = "ready";
		kidState.person = page.person;
		kidState.parentSide = page.parentSide;
	}
	kidNews();
}

function onKidEntries(entries) {
	kidState.entries = entries;
	kidNews();
}

function onKidProblem(error) {
	console.error(error);
	kidState.status = "failed";
	renderKid();
}

function kidProblemText(error) {
	const code = (error && error.code) || "";
	if (code === "permission-denied") {
		return t("Det virkede ikke. Måske er linket fjernet. Bed om et nyt.");
	}
	return t("Det virkede ikke. Prøv igen om lidt.");
}

// The kid presses "Skriv ind": one new entry, with a negative amount. The kid's own entries are
// shown at once (Firebase tells this page about its own writes before they have even arrived).
function kidSubmit(form) {
	const ore = parseAmount(form.elements.amount.value);
	if (ore === null || ore <= 0) {
		kidState.message = t("Skriv et beløb, fx 25.");
		kidState.messageIsError = true;
		renderKid();
		return;
	}
	const note = form.elements.note.value.trim().slice(0, MAX_NOTE_LENGTH);
	const entry = { date: dateKeyOf(new Date()), amount: -ore, note: note, at: Date.now() };
	const left = kidTotal() - ore;

	addKidEntry(kidKey.parent, kidKey.token, newId(), entry).catch((error) => {
		console.error(error);
		kidState.message = kidProblemText(error);
		kidState.messageIsError = true;
		renderKid();
	});
	kidState.message = t("Skrevet: {amount} Nu har du {left} tilbage.", { amount: formatKr(ore), left: formatKr(left) });
	kidState.messageIsError = false;
	renderKid();
}

document.addEventListener("submit", (event) => {
	if (event.target.id === "kid-form") {
		event.preventDefault();
		kidSubmit(event.target);
	}
});

document.addEventListener("click", (event) => {
	const button = event.target.closest("[data-kid-action]");
	if (!button) {
		return;
	}
	if (button.dataset.kidAction === "leave") {
		leaveKidMode();
	} else if (button.dataset.kidAction === "retry") {
		startKidMode(kidKey);
	}
});
