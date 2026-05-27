import test from 'ava';
import {clusterAt, segmentGraphemes} from './grapheme.js';

test('clusterAt: ASCII returns the single character at the offset', t => {
	t.is(clusterAt('abc', 0), 'a');
	t.is(clusterAt('abc', 1), 'b');
	t.is(clusterAt('abc', 2), 'c');
});

test('clusterAt: a decomposed accent is one cluster', t => {
	// E + combining acute (two code units) is a single grapheme cluster, returned
	// whole. Derived via normalize() so the test is independent of how the source
	// file stores the literal.
	const decomposed = 'é'.normalize('NFD');
	t.is(decomposed.length, 2); // Genuinely decomposed
	t.is(clusterAt(`x${decomposed}`, 1), decomposed);
});

test('clusterAt: an emoji cluster spans its surrogate pair', t => {
	t.is(clusterAt('a😀b', 1), '😀');
	t.is(clusterAt('a😀b', 3), 'b'); // 😀 is two code units, so b sits at index 3
});

test('clusterAt: CJK is one cluster', t => {
	t.is(clusterAt('中a', 0), '中');
});

test('clusterAt: an offset at or past the end is empty', t => {
	t.is(clusterAt('hi', 2), '');
	t.is(clusterAt('', 0), '');
});

test('segmentGraphemes: yields clusters with their UTF-16 offsets', t => {
	const segs = [...segmentGraphemes('a😀b')].map(s => [s.segment, s.index]);
	t.deepEqual(segs, [
		['a', 0],
		['😀', 1],
		['b', 3],
	]);
});
