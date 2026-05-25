import test from 'ava';
import {blankLineChunker} from './chunker.js';

test('blankLineChunker: text without blank lines is one chunk', t => {
	const chunks = blankLineChunker('hello world');
	t.deepEqual(chunks, [{start: 0, end: 11}]);
});

test('blankLineChunker: blank-line-separated text splits into chunks', t => {
	const chunks = blankLineChunker('para one\n\npara two');
	// Positions: "para one" is [0, 8); "\n\n" is the separator [8, 10);
	// "para two" is [10, 18).
	t.deepEqual(chunks, [
		{start: 0, end: 8},
		{start: 10, end: 18},
	]);
});

test('blankLineChunker: multiple blank lines collapse into one separator', t => {
	const chunks = blankLineChunker('a\n\n\n\nb');
	t.deepEqual(chunks, [
		{start: 0, end: 1},
		{start: 5, end: 6},
	]);
});

test('blankLineChunker: empty text produces no chunks', t => {
	t.deepEqual(blankLineChunker(''), []);
});

test('blankLineChunker: leading blank lines are skipped', t => {
	const chunks = blankLineChunker('\n\nhello');
	// The leading "\n\n" is matched as a separator; no chunk before it
	// because chunkEnd === lastEnd === 0. Only "hello" remains.
	t.deepEqual(chunks, [{start: 2, end: 7}]);
});
