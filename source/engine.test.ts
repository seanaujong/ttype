import test from 'ava';
import {reducer, initialState} from './engine.js';

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
