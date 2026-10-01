"use strict";

// Deciding whether a new password is strong enough. The rules:
// - at least MIN_PASSWORD_LENGTH characters,
// - not containing the username,
// - hard to guess, as scored by zxcvbn - a password checker made by Dropbox that knows the
//   tricks people use ("Budget123!", "password2026", keyboard rows, dates, l33t speak).
// Firebase also refuses passwords shorter than MIN_PASSWORD_LENGTH on its own side
// (set in the Firebase console, see SETUP-ACCOUNTS.md), so the length rule can't be skipped.

const MIN_PASSWORD_LENGTH = 10;
// zxcvbn scores 0 to 4. 3 means "safely unguessable": it would take an attacker
// with a stolen copy of the scrambled passwords a very long time.
const MIN_PASSWORD_SCORE = 3;
// Only downloaded when someone creates an account: it is big (800 KB) and rarely needed.
const ZXCVBN_URL = "https://cdnjs.cloudflare.com/ajax/libs/zxcvbn/4.4.2/zxcvbn.js";
// Words that make a password easy to guess for this page in particular.
const APP_WORDS = ["budget", "maanedsbudget", "månedsbudget", "penge", "kroner", "kr"];

let checkerPromise = null;

function loadPasswordChecker() {
	if (!checkerPromise) {
		checkerPromise = new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.src = ZXCVBN_URL;
			script.onload = () => resolve();
			script.onerror = () => {
				checkerPromise = null;   // allow a fresh try
				reject(new Error("The password checker could not be downloaded"));
			};
			document.head.append(script);
		});
	}
	return checkerPromise;
}

// Returns { ok, message }. message is what to tell the user (in the page's language), or "" when the
// password is fine. Needs loadPasswordChecker() to have finished.
function checkNewPassword(password, username) {
	if (password.length < MIN_PASSWORD_LENGTH) {
		const missing = MIN_PASSWORD_LENGTH - password.length;
		return { ok: false, message: t("Adgangskoden skal være mindst {min} tegn. Der mangler {missing}.", { min: MIN_PASSWORD_LENGTH, missing: missing }) };
	}
	if (username && password.toLowerCase().includes(username.toLowerCase())) {
		return { ok: false, message: t("Adgangskoden må ikke indeholde dit brugernavn.") };
	}
	if (typeof zxcvbn !== "function") {
		return { ok: false, message: t("Adgangskode-tjekket er ved at blive hentet. Prøv igen om et øjeblik.") };
	}
	const score = zxcvbn(password, [username, ...APP_WORDS].filter(Boolean)).score;
	if (score < MIN_PASSWORD_SCORE) {
		return { ok: false, message: t("Adgangskoden er for nem at gætte. Brug fx tre almindelige ord og et tal, som \"Lilla-tiger-raket-47\".") };
	}
	return { ok: true, message: "" };
}
