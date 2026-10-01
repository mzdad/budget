// scan.js - turns a picture (a screenshot of the bank's list of purchases) into text, on the
// phone itself. The picture is never sent anywhere.
//
// The reading is done by Tesseract.js, a free reader that runs inside the page. It is big (a few
// megabytes), so it is only fetched the first time you use "Læs fra skærmbillede", from a public
// download service (jsdelivr), and the browser keeps it afterwards. Nothing else on the page needs
// it. The text it finds is turned into purchases by planBankImport() in budget.js.
//
// One block of text is the first reading: the whole picture, to find the names. When the list is
// laid out in columns (the amounts in a column at the right, the dates in a column at the left), the
// two columns are then read again on their own, enlarged and for digits only, which reads small and
// coloured numbers far better; assembleBankText() in budget.js puts the three readings back together.
//
// This file only holds functions; app.js uses them.

const TESSERACT_VERSION = "7.0.0";
const TESSERACT_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@" + TESSERACT_VERSION + "/dist/tesseract.min.js";
const TESSERACT_WORKER_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@" + TESSERACT_VERSION + "/dist/worker.min.js";
const TESSERACT_CORE_URL = "https://cdn.jsdelivr.net/npm/tesseract.js-core@" + TESSERACT_VERSION;
const TESSERACT_LANGUAGE_URL = "https://cdn.jsdelivr.net/npm/@tesseract.js-data/dan@1.0.0/4.0.0_best_int";

// The whole picture is read at this width (a narrower picture is enlarged, a wider one made smaller):
// the reader does better with letters that are not tiny, and a bigger picture is only slower.
const PAGE_READ_WIDTH = 1600;
// A very long picture (a bank list scrolled and stitched together) is also made smaller: phones
// cannot draw a canvas of more than about 16 million pixels.
const PICTURE_MOST_PIXELS = 12000000;
// The columns are read with letters about this tall (in pixels), however small they are in the picture.
const COLUMN_LETTER_HEIGHT = 45;
const COLUMN_MOST_ZOOM = 4;
// The amount column is read a second time, this much smaller, when the first zoom was at least this big.
const SECOND_READING_FROM_ZOOM = 1.5;
const SECOND_READING_SIZE = 0.7;
// Under this average brightness (0 black ... 255 white) the picture counts as "dark mode" and is
// turned the other way round: the reader wants dark letters on a light background.
const DARK_PICTURE_BELOW = 128;
// A little white edge around what is read: the reader does better with some room.
const READ_EDGE = 20;

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

// The picture drawn in its own colours, at its own size (smaller when it is huge). The colours
// are kept: a red number is a cost, and that is only seen in the colours.
async function pictureToSource(file) {
	const url = URL.createObjectURL(file);
	try {
		const picture = new Image();
		picture.src = url;
		await picture.decode();

		const scale = Math.min(1, Math.sqrt(PICTURE_MOST_PIXELS / (picture.naturalWidth * picture.naturalHeight)));
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(picture.naturalWidth * scale);
		canvas.height = Math.round(picture.naturalHeight * scale);
		const pen = canvas.getContext("2d", { willReadFrequently: true });
		pen.drawImage(picture, 0, 0, canvas.width, canvas.height);
		return canvas;
	} finally {
		URL.revokeObjectURL(url);
	}
}

// Is it a dark-mode picture (light letters on a dark background)? Looks at every few pixels.
function isDarkPicture(source) {
	const colours = source.getContext("2d").getImageData(0, 0, source.width, source.height).data;
	let total = 0;
	let count = 0;
	for (let i = 0; i < colours.length; i += 4 * 7) {
		total += 0.299 * colours[i] + 0.587 * colours[i + 1] + 0.114 * colours[i + 2];
		count += 1;
	}
	return total / count < DARK_PICTURE_BELOW;
}

// The part of the picture between x0 and x1 (the whole height), enlarged by `zoom`, in grey with
// a white edge, ready for the reader. The grey is the DARKEST of the three colours of a pixel:
// coloured letters (a red number) then come out as dark as black ones. A dark picture is turned
// the other way round, so it also has dark letters on a light background.
function readyForReading(source, x0, x1, zoom, dark) {
	const canvas = document.createElement("canvas");
	canvas.width = Math.round((x1 - x0) * zoom) + 2 * READ_EDGE;
	canvas.height = Math.round(source.height * zoom) + 2 * READ_EDGE;
	const pen = canvas.getContext("2d", { willReadFrequently: true });
	pen.fillStyle = dark ? "#000" : "#fff";
	pen.fillRect(0, 0, canvas.width, canvas.height);
	pen.imageSmoothingQuality = "high";
	pen.drawImage(source, x0, 0, x1 - x0, source.height, READ_EDGE, READ_EDGE, canvas.width - 2 * READ_EDGE, canvas.height - 2 * READ_EDGE);

	const pixels = pen.getImageData(0, 0, canvas.width, canvas.height);
	const colours = pixels.data;
	for (let i = 0; i < colours.length; i += 4) {
		const grey = dark ? 255 - Math.max(colours[i], colours[i + 1], colours[i + 2]) : Math.min(colours[i], colours[i + 1], colours[i + 2]);
		colours[i] = grey;
		colours[i + 1] = grey;
		colours[i + 2] = grey;
	}
	pen.putImageData(pixels, 0, 0);
	return { canvas: canvas, x0: x0, zoom: zoom };
}

// The words the reader found, with their places in the PICTURE's own pixels (not the enlarged copy's).
function wordsFound(blocks, ready) {
	const words = [];
	for (const block of blocks || []) {
		for (const paragraph of block.paragraphs) {
			for (const line of paragraph.lines) {
				for (const word of line.words) {
					const text = word.text.trim();
					if (text !== "") {
						words.push({
							text: text,
							x0: ready.x0 + (word.bbox.x0 - READ_EDGE) / ready.zoom,
							y0: (word.bbox.y0 - READ_EDGE) / ready.zoom,
							x1: ready.x0 + (word.bbox.x1 - READ_EDGE) / ready.zoom,
							y1: (word.bbox.y1 - READ_EDGE) / ready.zoom,
						});
					}
				}
			}
		}
	}
	return words;
}

// Is the writing in this box red? Looks at the pixels that differ from the background (the box's
// corners): red letters have a lot more red than green and blue in them. Works on dark pictures too.
function isRedWriting(source, word) {
	const x0 = Math.max(0, Math.floor(word.x0));
	const y0 = Math.max(0, Math.floor(word.y0));
	const width = Math.min(source.width - x0, Math.ceil(word.x1 - word.x0) + 1);
	const height = Math.min(source.height - y0, Math.ceil(word.y1 - word.y0) + 1);
	if (width < 2 || height < 2) {
		return false;
	}
	const colours = source.getContext("2d").getImageData(x0, y0, width, height).data;
	const at = (x, y) => (y * width + x) * 4;
	const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
	const back = [0, 1, 2].map((channel) => corners.reduce((sum, place) => sum + colours[place + channel], 0) / 4);

	let red = 0;
	let green = 0;
	let blue = 0;
	let ink = 0;
	for (let i = 0; i < colours.length; i += 4) {
		const distance = Math.abs(colours[i] - back[0]) + Math.abs(colours[i + 1] - back[1]) + Math.abs(colours[i + 2] - back[2]);
		if (distance > 150) {
			red += colours[i];
			green += colours[i + 1];
			blue += colours[i + 2];
			ink += 1;
		}
	}
	if (ink === 0) {
		return false;
	}
	return red / ink > 120 && (red - green) / ink > 50 && (red - blue) / ink > 50;
}

// Reads the text in a picture file. `onProgress(stage, share)` is called while it works: stage is
// "loading" (fetching the reader, first time only) or "reading", and share goes from 0 to 1.
// Resolves with the text, one line of text per line in the picture. `trace`, when given, is filled
// with what each reading found (for tests and for finding out why a picture reads badly).
async function readPicture(file, onProgress, trace) {
	onProgress("loading", 0);
	await loadReader();
	const source = await pictureToSource(file);
	const dark = isDarkPicture(source);

	// The reader reports each reading's progress from 0 to 1; `part` places it inside the whole.
	let part = { from: 0, size: 1 };
	const worker = await Tesseract.createWorker("dan", 1, {
		workerPath: TESSERACT_WORKER_URL,
		corePath: TESSERACT_CORE_URL,
		langPath: TESSERACT_LANGUAGE_URL,
		logger: (message) => {
			if (message.status === "recognizing text") {
				onProgress("reading", part.from + part.size * (message.progress || 0));
			} else {
				onProgress("loading", 0);
			}
		},
	});
	readerWorker = worker;
	try {
		// 1. The whole picture as "one block of text": rows stay together, so the name and the
		// amount on the same row of the bank's list end up on the same line of text.
		part = { from: 0, size: 0.6 };
		await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK, tessedit_char_whitelist: "", preserve_interword_spaces: "1" });
		const whole = readyForReading(source, 0, source.width, PAGE_READ_WIDTH / source.width, dark);
		const first = await worker.recognize(whole.canvas, {}, { text: true, blocks: true });
		const mainWords = wordsFound(first.data.blocks, whole);
		const columns = bankColumns(mainWords, source.width);
		if (trace) {
			trace.main = mainWords;
			trace.columns = columns;
			trace.dark = dark;
		}
		if (columns.amounts === null && columns.left === null) {
			return first.data.text;   // an ordinary list: the amount is on the same line as its name
		}

		// How much to enlarge the columns: the letters should be about COLUMN_LETTER_HEIGHT tall.
		const letterHeight = middleOf(mainWords.map((word) => word.y1 - word.y0));
		const zoom = trace && trace.forceZoom ? trace.forceZoom : Math.max(1, Math.min(COLUMN_MOST_ZOOM, COLUMN_LETTER_HEIGHT / Math.max(letterHeight, 1)));   // (trace.forceZoom: to try other sizes)

		// 2. The amount column on its own: digits only. Red numbers are costs. It is read at two
		// sizes (when it is enlarged at all): where the two readings of a number disagree, the page
		// says "tjek beløbet" for that line (reconcileAmountReadings in budget.js).
		let amountWords = [];
		if (columns.amounts !== null) {
			await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK, tessedit_char_whitelist: "0123456789,.-+", preserve_interword_spaces: "1" });
			const readAmounts = async (size) => {
				const ready = readyForReading(source, columns.amounts.x0, columns.amounts.x1, size, dark);
				const result = await worker.recognize(ready.canvas, {}, { text: true, blocks: true });
				return wordsFound(result.data.blocks, ready).map((word) => ({ ...word, red: isRedWriting(source, word) }));
			};
			part = { from: 0.6, size: 0.12 };
			amountWords = await readAmounts(zoom);
			if (zoom >= SECOND_READING_FROM_ZOOM) {
				part = { from: 0.72, size: 0.12 };
				amountWords = reconcileAmountReadings(amountWords, await readAmounts(zoom * SECOND_READING_SIZE));
			}
		}

		// 3. The date column on its own: day numbers and month names.
		let dateWords = [];
		if (columns.left !== null) {
			part = { from: 0.85, size: 0.15 };
			await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK, tessedit_char_whitelist: "", preserve_interword_spaces: "1" });
			const ready = readyForReading(source, columns.left.x0, columns.left.x1, zoom, dark);
			const result = await worker.recognize(ready.canvas, {}, { text: true, blocks: true });
			dateWords = wordsFound(result.data.blocks, ready);
		}
		if (trace) {
			trace.amounts = amountWords;
			trace.dates = dateWords;
			trace.zoom = zoom;
		}
		return assembleBankText(mainWords, columns, amountWords, dateWords);
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
