import fs from 'node:fs';
import test from 'ava';
import {computeTypeableIndices} from './chunker.js';
import {
	initialState,
	matchesExpected,
	reducer,
	replay,
	type Fixture,
} from './engine.js';

// Helper: build an initial state using the default global rules. Engine tests
// don't care about chunk-aware cosmetic spans — they care about reducer
// behavior on whatever typeable positions exist.
function makeInitial(text: string) {
	return initialState(text, computeTypeableIndices(text));
}

test('First TYPE_CHAR appends char, sets startedAt, leaves endedAt unset', t => {
	const state = makeInitial('hello');

	const next = reducer(state, {kind: 'TYPE_CHAR', char: 'h', at: 1000});

	t.deepEqual(next.keystrokes, ['h']);
	t.is(next.startedAt, 1000);
	t.is(next.endedAt, undefined);
});

test('second TYPE_CHAR does not overwrite startedAt', t => {
	const first = reducer(makeInitial('hello'), {
		kind: 'TYPE_CHAR',
		char: 'h',
		at: 1000,
	});
	const second = reducer(first, {kind: 'TYPE_CHAR', char: 'e', at: 2000});
	t.is(second.startedAt, 1000);
});

test('TYPE_CHAR that completes the text sets endedAt', t => {
	const first = reducer(makeInitial('hi'), {
		kind: 'TYPE_CHAR',
		char: 'h',
		at: 1000,
	});
	const second = reducer(first, {kind: 'TYPE_CHAR', char: 'i', at: 2000});
	t.is(second.endedAt, 2000);
});

test('BACKSPACE removes keystroke', t => {
	const state = makeInitial('hello');

	const first = reducer(state, {kind: 'TYPE_CHAR', char: 'h', at: 1000});
	const second = reducer(first, {kind: 'TYPE_CHAR', char: 'q', at: 1000});
	const third = reducer(second, {kind: 'BACKSPACE'});

	t.deepEqual(third.keystrokes, ['h']);
});

test('TYPE_CHAR past text length is a no-op (same reference returned)', t => {
	const first = reducer(makeInitial('hi'), {
		kind: 'TYPE_CHAR',
		char: 'h',
		at: 1000,
	});
	const second = reducer(first, {kind: 'TYPE_CHAR', char: 'i', at: 2000});
	const third = reducer(second, {kind: 'TYPE_CHAR', char: '!', at: 3000});

	// `t.is` is reference equality. Same reference proves the reducer took the
	// early `return state` path — important for React's bail-out optimization.
	t.is(third, second);
});

test('BACKSPACE on empty keystrokes is safe', t => {
	const next = reducer(makeInitial('hi'), {kind: 'BACKSPACE'});

	t.deepEqual(next.keystrokes, []);
});

test('BACKSPACE preserves text, startedAt, and endedAt', t => {
	const first = reducer(makeInitial('hi'), {
		kind: 'TYPE_CHAR',
		char: 'h',
		at: 1000,
	});
	const next = reducer(first, {kind: 'BACKSPACE'});

	t.is(next.text, 'hi');
	t.is(next.startedAt, 1000);
	t.is(next.endedAt, undefined);
});

test('matchesExpected: identity match', t => {
	t.true(matchesExpected('a', 'a'));
	t.false(matchesExpected('a', 'b'));
});

test('matchesExpected: em-dash accepts hyphen', t => {
	t.true(matchesExpected('-', '—'));
	t.true(matchesExpected('—', '—')); // Exact still works
	t.false(matchesExpected('_', '—'));
});

test('matchesExpected: en-dash accepts hyphen', t => {
	t.true(matchesExpected('-', '–'));
});

test('matchesExpected: smart quotes accept ASCII partners', t => {
	t.true(matchesExpected('"', '“'));
	t.true(matchesExpected('"', '”'));
	t.true(matchesExpected("'", '‘'));
	t.true(matchesExpected("'", '’'));
});

test('matchesExpected: non-breaking space accepts regular space', t => {
	t.true(matchesExpected(' ', ' '));
});

test('matchesExpected: NFC-normalizes so a grapheme matches regardless of encoding', t => {
	const precomposed = 'é'.normalize('NFC'); // U+00E9 — one code unit
	const decomposed = 'é'.normalize('NFD'); // E + combining acute — two
	t.not(precomposed, decomposed); // They are different strings...
	t.true(matchesExpected(precomposed, decomposed)); // ...but the same grapheme
	t.true(matchesExpected(decomposed, precomposed));
	// Typing the bare base letter is still wrong — the accent is part of the unit.
	t.false(matchesExpected('e', precomposed));
});

test('matchesExpected: a newline accepts Space (lenient hard-wrapped lines)', t => {
	t.true(matchesExpected(' ', '\n')); // Space where a line wraps
	t.true(matchesExpected('\n', '\n')); // Enter still works
	t.false(matchesExpected('x', '\n')); // A real char does not
	t.false(matchesExpected('\n', ' ')); // ...and Enter isn't accepted for a literal space
});

test('matchesExpected: undefined operands are not a match', t => {
	t.false(matchesExpected(undefined, 'a'));
	t.false(matchesExpected('a', undefined));
	t.false(matchesExpected(undefined, undefined));
});

test('RESET clears keystrokes and timestamps, preserves text', t => {
	const first = reducer(makeInitial('hello'), {
		kind: 'TYPE_CHAR',
		char: 'h',
		at: 1000,
	});
	const reset = reducer(first, {kind: 'RESET'});

	t.deepEqual(reset.keystrokes, []);
	t.is(reset.startedAt, undefined);
	t.is(reset.endedAt, undefined);
	t.is(reset.text, 'hello');
});

test('reducer records every handled action in the event log', t => {
	const a = reducer(makeInitial('hi'), {
		kind: 'TYPE_CHAR',
		char: 'h',
		at: 1000,
	});
	const b = reducer(a, {kind: 'TYPE_CHAR', char: 'x', at: 1100});
	const c = reducer(b, {kind: 'BACKSPACE'});
	t.deepEqual(c.events, [
		{kind: 'TYPE_CHAR', char: 'h', at: 1000},
		{kind: 'TYPE_CHAR', char: 'x', at: 1100},
		{kind: 'BACKSPACE'},
	]);
});

test('RESET clears the event log', t => {
	const typed = reducer(makeInitial('hi'), {
		kind: 'TYPE_CHAR',
		char: 'h',
		at: 1000,
	});
	t.is(typed.events.length, 1);
	t.deepEqual(reducer(typed, {kind: 'RESET'}).events, []);
});

test('a capped TYPE_CHAR does not append to the log', t => {
	const done = reducer(
		reducer(makeInitial('hi'), {kind: 'TYPE_CHAR', char: 'h', at: 1000}),
		{kind: 'TYPE_CHAR', char: 'i', at: 1100},
	);
	const capped = reducer(done, {kind: 'TYPE_CHAR', char: '!', at: 1200});
	t.is(capped, done); // Same reference (no-op path) — and so the same 2-event log
	t.is(capped.events.length, 2);
});

const fixturesDir = new URL('fixtures/', import.meta.url);

for (const file of fs
	.readdirSync(fixturesDir)
	.filter(name => name.endsWith('.json'))) {
	const raw = fs.readFileSync(new URL(file, fixturesDir), 'utf8');
	const fixture = JSON.parse(raw) as Fixture;

	test(`fixture: ${fixture.name}`, t => {
		const result = replay(
			fixture.text,
			fixture.events,
			computeTypeableIndices(fixture.text),
		);

		for (const [field, value] of Object.entries(fixture.expected)) {
			t.deepEqual(
				result[field as keyof typeof result],
				value,
				`${fixture.name}: ${field}`,
			);
		}
	});
}
