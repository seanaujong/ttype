import test from 'ava';
import React from 'react';
import {render} from 'ink-testing-library';
import stringWidth from 'string-width';
import App from './app.js';
import {blankLineChunker, diffChunker, type Chunker} from './chunker.js';
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
// The harness stdout is columns 100 (fixed) and rows undefined → useTerminalSize
// falls back to 24, so a synchronously-read first frame is rendered for 24x100.
// Asserted against the *raw* terminal dims (strictly fewer than `rows` lines, each
// row strictly narrower than `cols`) — independent of frameBudget, so this also
// catches a regression in the reservation itself.
function fitsTerminal(lines: readonly string[], rows: number, columns: number) {
	return (
		lines.length < rows && lines.every(line => stringWidth(line) < columns)
	);
}

function firstFrame(text: string, chunker: Chunker, isSplit: boolean) {
	const {lastFrame, unmount} = render(
		React.createElement(App, {text, chunker, isSplit}),
	);
	const lines = (lastFrame() ?? '').split('\n');
	unmount();
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
		const {lastFrame, stdin, stdout, unmount} = render(
			React.createElement(App, {
				text,
				chunker: blankLineChunker,
				isSplit: false,
			}),
		);
		// Shim the ink@4 ↔ ink-testing-library@3 stdin gap so useInput's effect
		// survives, then drive a resize down to 40 columns (see ink-testing-harness).
		const anyStdin = stdin as unknown as Record<string, unknown>;
		anyStdin['ref'] = () => undefined;
		anyStdin['unref'] = () => undefined;
		const anyStdout = stdout as unknown as {
			emit: (event: string) => void;
		};
		const tick = async () =>
			new Promise(resolve => {
				setTimeout(resolve, 60);
			});
		// Let useTerminalSize's 'resize' listener attach (the shim keeps useInput's
		// effect from throwing) before we emit, then re-render at the new width.
		await tick();
		Object.defineProperty(stdout, 'columns', {
			configurable: true,
			get: () => 40,
		});
		anyStdout.emit('resize');
		await tick();
		const lines = (lastFrame() ?? '').split('\n');
		unmount();
		t.true(fitsTerminal(lines, 24, 40));
	},
);
