import test from 'ava';
import React from 'react';
import {blankLineChunker, computeTypeableIndices} from './chunker.js';
import {Racer} from './app.js';
import {renderApp, renderComponent, type RenderedApp} from './ink-harness.js';

// "alpha beta gamma", with "beta" chosen as the cloze blank (its four letters).
// The whole passage is typeable — masking is a render overlay, not a re-scope.
const text = 'alpha beta gamma';
const chunks = blankLineChunker(text);
const typeable = computeTypeableIndices(text, chunks);
const betaStart = text.indexOf('beta');
const blanked = new Set([
	betaStart,
	betaStart + 1,
	betaStart + 2,
	betaStart + 3,
]);

const renderRacer = (blankedSet: ReadonlySet<number>): RenderedApp =>
	renderComponent(
		React.createElement(Racer, {
			text,
			chunks,
			typeableIndices: typeable,
			viewportLineBudget: 24,
			viewportColumns: 80,
			isSplit: false,
			onSkipForward() {
				/* No-op: skipping is App's job and irrelevant to masking. */
			},
			onSkipBack() {
				/* No-op. */
			},
			blanked: blankedSet,
		}),
	);

// Each masked cell draws a single ▁; ANSI styling never contains that glyph, so
// counting it is a stable read of "how many positions are currently hidden"
// without stripping the escape codes the per-char <Text>s interleave.
const maskedCount = (frame: string): number => (frame.match(/▁/g) ?? []).length;

test('cloze render: a blanked word is hidden behind ▁, others are not', t => {
	const app = renderRacer(blanked);
	// Exactly "beta"'s four letters are masked — alpha and gamma render normally.
	t.is(maskedCount(app.lastFrame()), 4);
	app.unmount();
});

test('cloze render: nothing is masked without a blank set', t => {
	const app = renderRacer(new Set());
	t.is(maskedCount(app.lastFrame()), 0);
	app.unmount();
});

test.serial('cloze render: typing a blank reveals it', async t => {
	const app = renderRacer(blanked);
	t.is(maskedCount(app.lastFrame()), 4);
	// Type through "alpha " and into the blank; once "beta" is typed, the engine's
	// cursor is past it, so styleFor reveals the real chars and the ▁s are gone.
	await app.type('alpha beta');
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
