// scan.js - turns a picture (a screenshot of the bank's list of purchases) into text, on the
// phone itself. The picture is never sent anywhere.
//
// The reading is done by Tesseract.js, a free reader that runs inside the page. It is big (a few
// megabytes), so it is only fetched the first time you use "Læs fra skærmbillede", from a public
// download service (jsdelivr), and the browser keeps it afterwards. Nothing else on the page needs
// it. The text it finds is turned into purchases by planBankImport() in budget.js.
//
// This file only holds functions; app.js uses them.

const TESSERACT_VERSION = "7.0.0";
const TESSERACT_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@" + TESSERACT_VERSION + "/dist/tesseract.min.js";
const TESSERACT_WORKER_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@" + TESSERACT_VERSION + "/dist/worker.min.js";
const TESSERACT_CORE_URL = "https://cdn.jsdelivr.net/npm/tesseract.js-core@" + TESSERACT_VERSION;
const TESSERACT_LANGUAGE_URL = "https://cdn.jsdelivr.net/npm/@tesseract.js-data/dan@1.0.0/4.0.0_best_int";

// A picture wider than this is made smaller (faster, and no better to read); a narrower one is made
// wider, because the reader does better with letters that are not tiny.
const PICTURE_MOST_WIDTH = 2000;
const PICTURE_LEAST_WIDTH = 1000;
// A very long picture (a bank list scrolled and stitched together) is also made smaller: phones
// cannot draw a canvas of more than about 16 million pixels.
const PICTURE_MOST_PIXELS = 12000000;
// Under this average brightness (0 black ... 255 white) the picture counts as "dark mode" and is
// turned the other way round: the reader wants dark letters on a light background.
const DARK_PICTURE_BELOW = 128;

let readerScript = null;      // the promise of the reader's script, once asked for
let readerWorker = null;      // the reader that is busy right now, so it can be stopped

// Fetches the reader's script (once). Rejects if it cannot be fetched, e.g. with no internet.
function loadReader() {
	if (typeof Tesseract !== "undefined") {
		return Promise.resolve();
	}
	if (readerScript === null) {
		readerScript = new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.src = TESSERACT_SCRIPT_URL;
			script.onload = () => resolve();
			script.onerror = () => {
				readerScript = null;   // so the next try fetches it again
				reject(new Error("The reader could not be downloaded."));
			};
			document.head.appendChild(script);
		});
	}
	return readerScript;
}

// The picture as a canvas (a drawing area), made ready for reading: the right size, in grey, and
// light with dark letters.
async function pictureToCanvas(file) {
	const url = URL.createObjectURL(file);
	try {
		const picture = new Image();
		picture.src = url;
		await picture.decode();

		let scale = 1;
		if (picture.naturalWidth > PICTURE_MOST_WIDTH) {
			scale = PICTURE_MOST_WIDTH / picture.naturalWidth;
		} else if (picture.naturalWidth < PICTURE_LEAST_WIDTH) {
			scale = PICTURE_LEAST_WIDTH / picture.naturalWidth;
		}
		scale = Math.min(scale, Math.sqrt(PICTURE_MOST_PIXELS / (picture.naturalWidth * picture.naturalHeight)));
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(picture.naturalWidth * scale);
		canvas.height = Math.round(picture.naturalHeight * scale);
		const pen = canvas.getContext("2d", { willReadFrequently: true });
		pen.drawImage(picture, 0, 0, canvas.width, canvas.height);

		const pixels = pen.getImageData(0, 0, canvas.width, canvas.height);
		const colours = pixels.data;
		let total = 0;
		for (let i = 0; i < colours.length; i += 4) {
			const grey = 0.299 * colours[i] + 0.587 * colours[i + 1] + 0.114 * colours[i + 2];
			colours[i] = grey;
			colours[i + 1] = grey;
			colours[i + 2] = grey;
			total += grey;
		}
		if (total / (colours.length / 4) < DARK_PICTURE_BELOW) {
			for (let i = 0; i < colours.length; i += 4) {
				colours[i] = 255 - colours[i];
				colours[i + 1] = 255 - colours[i + 1];
				colours[i + 2] = 255 - colours[i + 2];
			}
		}
		pen.putImageData(pixels, 0, 0);
		return canvas;
	} finally {
		URL.revokeObjectURL(url);
	}
}

// Reads the text in a picture file. `onProgress(stage, share)` is called while it works: stage is
// "loading" (fetching the reader, first time only) or "reading", and share goes from 0 to 1.
// Resolves with the text, one line of text per line in the picture.
async function readPicture(file, onProgress) {
	onProgress("loading", 0);
	await loadReader();
	const canvas = await pictureToCanvas(file);

	const worker = await Tesseract.createWorker("dan", 1, {
		workerPath: TESSERACT_WORKER_URL,
		corePath: TESSERACT_CORE_URL,
		langPath: TESSERACT_LANGUAGE_URL,
		logger: (message) => {
			const reading = message.status === "recognizing text";
			onProgress(reading ? "reading" : "loading", message.progress || 0);
		},
	});
	readerWorker = worker;
	try {
		// "One block of text": rows stay together, so the name and the amount on the same row of
		// the bank's list end up on the same line of text.
		await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK, preserve_interword_spaces: "1" });
		const result = await worker.recognize(canvas);
		return result.data.text;
	} finally {
		readerWorker = null;
		await worker.terminate();
	}
}

// Stops a reading that is going on (the Annullér button). Its readPicture() then fails, which the
// page ignores because it has already moved on.
function stopReadingPicture() {
	if (readerWorker !== null) {
		const worker = readerWorker;
		readerWorker = null;
		worker.terminate();
	}
}
