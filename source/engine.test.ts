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
