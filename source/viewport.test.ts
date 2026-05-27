import test from 'ava';
import stringWidth from 'string-width';
import {blankLineChunker, diffChunker, type Chunker} from './chunker.js';
import {renderApp} from './ink-harness.js';
import {frameBudget, frameFits, frameViolations} from './viewport.js';

// --- Pure budget + predicate ---

test('frameBudget reserves the last row and column, and the footer', t => {
	t.deepEqual(frameBudget(24, 100, 2), {
		rows: 24,
		columns: 100,
		footerRows: 2,
		usableRows: 23,
		usableColumns: 99,
		contentLineBudget: 21,
	});
});

test('frameBudget clamps to at least one row/column on a tiny terminal', t => {
	const b = frameBudget(1, 1, 2);
	t.is(b.usableRows, 1);
	t.is(b.usableColumns, 1);
	t.is(b.contentLineBudget, 1);
});

test('frameFits: a frame within the budget fits', t => {
	const b = frameBudget(5, 10, 1); // UsableRows 4, usableColumns 9
	t.true(frameFits(['ab', 'cd', 'ef'], b));
	t.true(frameFits(['x'.repeat(9)], b)); // Exactly usableColumns wide
});

test('frameFits: a frame exactly as tall as the terminal is a violation', t => {
	const b = frameBudget(5, 10, 1); // UsableRows 4
	// 5 lines == rows: the subtle scroll-flicker case, must be caught.
	t.false(frameFits(['a', 'b', 'c', 'd', 'e'], b));
	t.true(frameViolations(['a', 'b', 'c', 'd', 'e'], b).tooTall);
});

test('frameFits: an over-wide row is a violation (by display width)', t => {
	const b = frameBudget(5, 10, 1); // UsableColumns 9
	t.false(frameFits(['x'.repeat(10)], b));
	t.deepEqual(frameViolations(['ok', 'x'.repeat(10)], b).overWideRows, [1]);
	// Display width, not code units: a CJK row of 5 glyphs is 10 columns → too wide.
	t.false(frameFits(['中'.repeat(5)], b));
});

// --- The standing guard: real emitted frames must not fill the terminal ---
// renderApp's mock terminal is 24 rows × 100 columns (its defaults — see
// ink-harness.ts). fitsTerminal asserts against those *raw* dims (strictly fewer
// than `rows` lines, each row strictly narrower than `columns`), independent of
// frameBudget, so it also catches a regression in the reservation math itself.
function fitsTerminal(lines: readonly string[], rows: number, columns: number) {
	return (
		lines.length < rows && lines.every(line => stringWidth(line) < columns)
	);
}

// The first frame is painted synchronously by render(), so no tick is needed to
// read it — only the keystroke/resize tests below have to await effects.
function firstFrame(text: string, chunker: Chunker, isSplit: boolean) {
	const app = renderApp({text, chunker, isSplit, isCloze: false});
	const lines = app.frameLines();
	app.unmount();
	return lines;
}

test('frame fits: a chunk taller than the terminal clamps (chunk-19 regression)', t => {
	const tall = Array.from({length: 60}, () => 'the quick brown fox').join('\n');
	t.true(fitsTerminal(firstFrame(tall, blankLineChunker, false), 24, 100));
});

test('frame fits: an over-wide line is truncated, not overflowed', t => {
	t.true(
		fitsTerminal(firstFrame('z'.repeat(150), blankLineChunker, false), 24, 100),
	);
});

test('frame fits: the --split diff view stays within the budget', t => {
	const diff =
		'@@ -1,3 +1,3 @@\n a fairly long context line goes here\n-an old line of content\n+a new line of content';
	t.true(fitsTerminal(firstFrame(diff, diffChunker, true), 24, 100));
});

test.serial(
	'frame fits: the footer does not wrap at a narrow width',
	async t => {
		const text = 'paragraph one here\n\nparagraph two here\n\nparagraph three';
		const app = renderApp({
			text,
			chunker: blankLineChunker,
			isSplit: false,
			isCloze: false,
		});
		// Resize down to 40 columns: the harness fires the 'resize' event
		// useTerminalSize listens for, then waits for the re-render to flush.
		await app.resize({columns: 40});
		const lines = app.frameLines();
		app.unmount();
		t.true(fitsTerminal(lines, app.terminal.rows, app.terminal.columns));
	},
);

test.serial(
	'frame fits: the frame stays within budget while typing',
	async t => {
		const text = 'the quick brown fox jumps over the lazy dog';
		const app = renderApp({
			text,
			chunker: blankLineChunker,
			isSplit: false,
			isCloze: false,
		});
		const before = app.lastFrame();
		// Correct keystrokes drive the engine fold through the harness's input bridge.
		await app.type('the quick');
		const after = app.frameLines();
		app.unmount();
		// The keystrokes registered (the frame advanced from its initial paint) ...
		t.not(after.join('\n'), before);
		// ... and the live-updating frame still fits the terminal as it grows.
		t.true(fitsTerminal(after, app.terminal.rows, app.terminal.columns));
	},
);
