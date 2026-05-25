import fs from 'node:fs';
import test from 'ava';
import {initialState, reducer, replay, type Fixture} from './engine.js';

test('First TYPE_CHAR appends char, sets startedAt, leaves endedAt unset', t => {
	const state = initialState('hello');

	const next = reducer(state, {kind: 'TYPE_CHAR', char: 'h', at: 1000});

	t.deepEqual(next.keystrokes, ['h']);
	t.is(next.startedAt, 1000);
	t.is(next.endedAt, undefined);
});

test('second TYPE_CHAR does not overwrite startedAt', t => {
	const first = reducer(initialState('hello'), {
		kind: 'TYPE_CHAR',
		char: 'h',
		at: 1000,
	});
	const second = reducer(first, {kind: 'TYPE_CHAR', char: 'e', at: 2000});
	t.is(second.startedAt, 1000);
});

test('TYPE_CHAR that completes the text sets endedAt', t => {
	const first = reducer(initialState('hi'), {
		kind: 'TYPE_CHAR',
		char: 'h',
		at: 1000,
	});
	const second = reducer(first, {kind: 'TYPE_CHAR', char: 'i', at: 2000});
	t.is(second.endedAt, 2000);
});

test('BACKSPACE removes keystroke', t => {
	const state = initialState('hello');

	const first = reducer(state, {kind: 'TYPE_CHAR', char: 'h', at: 1000});
	const second = reducer(first, {kind: 'TYPE_CHAR', char: 'q', at: 1000});
	const third = reducer(second, {kind: 'BACKSPACE'});

	t.deepEqual(third.keystrokes, ['h']);
});

test('TYPE_CHAR past text length is a no-op (same reference returned)', t => {
	const first = reducer(initialState('hi'), {
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
	const next = reducer(initialState('hi'), {kind: 'BACKSPACE'});

	t.deepEqual(next.keystrokes, []);
});

test('BACKSPACE preserves text, startedAt, and endedAt', t => {
	const first = reducer(initialState('hi'), {
		kind: 'TYPE_CHAR',
		char: 'h',
		at: 1000,
	});
	const next = reducer(first, {kind: 'BACKSPACE'});

	t.is(next.text, 'hi');
	t.is(next.startedAt, 1000);
	t.is(next.endedAt, undefined);
});

test('RESET clears keystrokes and timestamps, preserves text', t => {
	const first = reducer(initialState('hello'), {
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

const fixturesDir = new URL('fixtures/', import.meta.url);

for (const file of fs
	.readdirSync(fixturesDir)
	.filter(name => name.endsWith('.json'))) {
	const raw = fs.readFileSync(new URL(file, fixturesDir), 'utf8');
	const fixture = JSON.parse(raw) as Fixture;

	test(`fixture: ${fixture.name}`, t => {
		const result = replay(fixture.text, fixture.events);

		for (const [field, value] of Object.entries(fixture.expected)) {
			t.deepEqual(
				result[field as keyof typeof result],
				value,
				`${fixture.name}: ${field}`,
			);
		}
	});
}

test('computeTypeableIndices skips leading whitespace at start', t => {
	const state = initialState('  hello');
	t.deepEqual(state.typeableIndices, [2, 3, 4, 5, 6]);
});

test('computeTypeableIndices skips leading whitespace per line', t => {
	const state = initialState('a\n  b');
	t.deepEqual(state.typeableIndices, [0, 1, 4]);
});

test('computeTypeableIndices skips blank lines entirely', t => {
	const state = initialState('a\n\nb');
	// Positions: a=0, \n=1, ''=(blank, no pos), \n=2, b=3
	// Typeable: a (0), \n after 'a' (1), b (3). The blank's \n (2) is not.
	t.deepEqual(state.typeableIndices, [0, 1, 3]);
});

test('computeTypeableIndices collapses multiple blank lines to one Enter', t => {
	const state = initialState('a\n\n\n\nb');
	// Three blank lines between a and b. Only one \n is typeable.
	t.deepEqual(state.typeableIndices, [0, 1, 5]);
});

test('computeTypeableIndices does not produce a trailing newline after the last non-blank line', t => {
	const state = initialState('a\n\n');
	// 'a', then two blank-ish lines. No \n typeable after 'a'.
	t.deepEqual(state.typeableIndices, [0]);
});

test('computeTypeableIndices skips mid-line tabs', t => {
	const state = initialState('a\tb');
	// Positions: a=0, \t=1, b=2. Tab not typeable.
	t.deepEqual(state.typeableIndices, [0, 2]);
});

test('computeTypeableIndices skips both leading and mid-line tabs', t => {
	const state = initialState('\ta\tb');
	// Positions: \t=0 (leading, skipped), a=1, \t=2 (mid-line, skipped), b=3.
	t.deepEqual(state.typeableIndices, [1, 3]);
});
