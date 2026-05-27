import test from 'ava';
import React from 'react';
import {blankLineChunker, computeTypeableIndices} from './chunker.js';
import {Racer} from './app.js';
import {renderApp, renderComponent, type RenderedApp} from './ink-harness.js';

// "alpha beta gamma". A cloze re-drill of "beta" re-scopes the run to just its
// positions — you fill in only the blank; "alpha"/"gamma" are shown as context.
const text = 'alpha beta gamma';
const chunks = blankLineChunker(text);
const fullTypeable = computeTypeableIndices(text, chunks);
const betaStart = text.indexOf('beta');
const betaPositions = [betaStart, betaStart + 1, betaStart + 2, betaStart + 3];

// Mount Racer over a given typeable scope. isClozeRun masks the untyped positions
// in that scope (a cloze re-drill); false is a normal run over the whole passage.
const renderRacer = (
	typeableIndices: readonly number[],
	isClozeRun: boolean,
): RenderedApp =>
	renderComponent(
		React.createElement(Racer, {
			text,
			chunks,
			typeableIndices,
			viewportLineBudget: 24,
			viewportColumns: 80,
			isSplit: false,
			isClozeRun,
			onSkipForward() {
				/* No-op: skipping is App's job and irrelevant to masking. */
			},
			onSkipBack() {
				/* No-op. */
			},
		}),
	);

// Each masked cell draws a single ▁; ANSI styling never contains that glyph, so
// counting it is a stable read of "how many positions are currently hidden"
// without stripping the escape codes the per-char <Text>s interleave.
const maskedCount = (frame: string): number => (frame.match(/▁/g) ?? []).length;

test('cloze render: a cloze run hides its blanks, context stays visible', t => {
	// Scoped to "beta" only: its four positions are masked, while "alpha"/"gamma"
	// are non-typeable context and render normally.
	const app = renderRacer(betaPositions, true);
	t.is(maskedCount(app.lastFrame()), 4);
	app.unmount();
});

test('cloze render: a normal run masks nothing', t => {
	const app = renderRacer(fullTypeable, false);
	t.is(maskedCount(app.lastFrame()), 0);
	app.unmount();
});

test.serial('cloze render: filling a blank reveals it', async t => {
	const app = renderRacer(betaPositions, true);
	t.is(maskedCount(app.lastFrame()), 4);
	// You type only the blank — the cursor starts on it. Once "beta" is in, the
	// engine's cursor is past all four positions, so styleFor reveals them.
	await app.type('beta');
	t.is(maskedCount(app.lastFrame()), 0);
	app.unmount();
});

// --- The flow (step 3), driven through App via the harness ---

test.serial(
	'cloze flow: finishing a run, then "c" re-drills with blanks',
	async t => {
		const app = renderApp({
			text,
			chunker: blankLineChunker,
			isSplit: false,
			isCloze: false,
		});
		// Type the whole passage to completion — the results screen shows, nothing masked.
		await app.type('alpha beta gamma');
		t.is(maskedCount(app.lastFrame()), 0);
		// "c" re-drills: App remounts a fresh run with the fumbled words blanked.
		await app.press('c');
		t.true(maskedCount(app.lastFrame()) > 0);
		app.unmount();
	},
);

test.serial('cloze flow: --cloze auto-advances into the re-drill', async t => {
	const app = renderApp({
		text,
		chunker: blankLineChunker,
		isSplit: false,
		isCloze: true,
	});
	// No "c" needed: completing the warm-up run drops straight into the masked re-drill.
	await app.type('alpha beta gamma');
	await app.tick(); // Let the auto-advance effect → remount flush.
	t.true(maskedCount(app.lastFrame()) > 0);
	app.unmount();
});
