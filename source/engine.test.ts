import test from 'ava';
import {reducer, initialState} from './engine.js';

test('TYPE_CHAR appends char to keystrokes', t => {
	const state = initialState('hello');

	const next = reducer(state, {kind: 'TYPE_CHAR', char: 'h'});

	t.deepEqual(next.keystrokes, ['h']);
});

test('BACKSPACE removes keystroke', t => {
	const state = initialState('hello');

	const first = reducer(state, {kind: 'TYPE_CHAR', char: 'h'});
	const second = reducer(first, {kind: 'TYPE_CHAR', char: 'q'});
	const third = reducer(second, {kind: 'BACKSPACE'});

	t.deepEqual(third.keystrokes, ['h']);
});
