import test from 'ava';
import React from 'react';
import {
	blankLineChunker,
	computeTypeableIndices,
	typeableChunkIndices,
} from './chunker.js';
import {Racer} from './app.js';
import {renderComponent, type RenderedApp} from './ink-harness.js';

// Mount Racer over a plain string as a normal (non-cloze) run, so the frame
// reflects exactly what a racer sees on screen.
const renderText = (text: string): RenderedApp => {
	const chunks = blankLineChunker(text);
	const typeableIndices = computeTypeableIndices(text, chunks);
	return renderComponent(
		React.createElement(Racer, {
			text,
			chunks,
			stops: typeableChunkIndices(chunks, typeableIndices),
			typeableIndices,
			viewportLineBudget: 24,
			viewportColumns: 80,
			isSplit: false,
			onSkipForward() {
				/* No-op: skipping is irrelevant here. */
			},
			onSkipBack() {
				/* No-op. */
			},
		}),
	);
};

// A collapsed-space run draws one `·` per skipped column. The glyph never appears
// in ANSI escape codes, so counting it is a stable read of the marker without
// stripping the per-char <Text> escapes (the same trick as cloze's ▁ count). Scope
// the count to the first row — the status footer also uses `·` as a separator.
const middotCount = (frame: string): number =>
	(frame.split('\n')[0]!.match(/·/g) ?? []).length;

test('render: a run of spaces draws middot markers', t => {
	// 'a    b' — the four-space gap collapses to one keystroke and renders as four
	// dim middots so the skippable gap is visible.
	const app = renderText('a    b');
	t.is(middotCount(app.lastFrame()), 4);
	app.unmount();
});

test('render: lone spaces draw no markers', t => {
	// Single spaces are ordinary word spacing — rendered blank, not dotted.
	const app = renderText('a b c');
	t.is(middotCount(app.lastFrame()), 0);
	app.unmount();
});
