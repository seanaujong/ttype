import test from 'ava';
import {
	blankLineChunker,
	computeTypeableIndices,
	diffChunker,
} from './chunker.js';

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

test('diffChunker: single-hunk diff is one chunk', t => {
	const diff = '@@ -1,3 +1,3 @@\n foo\n-bar\n+baz';
	const chunks = diffChunker(diff);
	t.is(chunks.length, 1);
	t.is(chunks[0]!.kind, 'diff-hunk');
	t.is(chunks[0]!.start, 0);
});

test('diffChunker: multi-hunk diff splits by @@', t => {
	const diff =
		'@@ -1,3 +1,3 @@\n unchanged\n-old\n+new\n@@ -10,2 +10,2 @@\n line\n+added';
	const chunks = diffChunker(diff);
	t.is(chunks.length, 2);
});

test('diffChunker: metadata before first @@ is its own chunk', t => {
	const diff =
		'diff --git a/foo b/foo\nindex abc..def\n--- a/foo\n+++ b/foo\n@@ -1 +1 @@\n+added';
	const chunks = diffChunker(diff);
	t.is(chunks.length, 2);
	t.true(
		chunks[0]!.end < chunks[1]!.start || chunks[0]!.end === chunks[1]!.start,
	);
});

// ComputeTypeableIndices tests — exercise the global skip rules (leading
// whitespace, blank lines, tabs) by calling it directly with no chunks.

test('computeTypeableIndices skips leading whitespace at start', t => {
	t.deepEqual(computeTypeableIndices('  hello'), [2, 3, 4, 5, 6]);
});

test('computeTypeableIndices skips leading whitespace per line', t => {
	t.deepEqual(computeTypeableIndices('a\n  b'), [0, 1, 4]);
});

test('computeTypeableIndices skips blank lines entirely', t => {
	// Positions: a=0, \n=1, ''=(blank, no pos), \n=2, b=3
	// Typeable: a (0), \n after 'a' (1), b (3). The blank's \n (2) is not.
	t.deepEqual(computeTypeableIndices('a\n\nb'), [0, 1, 3]);
});

test('computeTypeableIndices collapses multiple blank lines to one Enter', t => {
	// Three blank lines between a and b. Only one \n is typeable.
	t.deepEqual(computeTypeableIndices('a\n\n\n\nb'), [0, 1, 5]);
});

test('computeTypeableIndices does not produce a trailing newline after the last non-blank line', t => {
	// 'a', then two blank-ish lines. No \n typeable after 'a'.
	t.deepEqual(computeTypeableIndices('a\n\n'), [0]);
});

test('computeTypeableIndices skips mid-line tabs', t => {
	// Positions: a=0, \t=1, b=2. Tab not typeable.
	t.deepEqual(computeTypeableIndices('a\tb'), [0, 2]);
});

test('computeTypeableIndices skips both leading and mid-line tabs', t => {
	// Positions: \t=0 (leading, skipped), a=1, \t=2 (mid-line, skipped), b=3.
	t.deepEqual(computeTypeableIndices('\ta\tb'), [1, 3]);
});

test('computeTypeableIndices subtracts cosmetic spans from chunks', t => {
	// Diff chunker output marks +/- prefix as cosmetic; user shouldn't type them.
	const text = '@@ -1 +1 @@\n-old\n+new';
	const chunks = diffChunker(text);
	const indices = computeTypeableIndices(text, chunks);

	// The @@ header line is entirely cosmetic; the '-' and '+' prefix chars are
	// cosmetic. The 'old' and 'new' content remain typeable, plus the \n separators
	// between non-blank lines.
	t.false(indices.some(i => text[i] === '@')); // No hunk header positions
	t.false(indices.some(i => text[i] === '+' && i > 0)); // No '+' content prefix
	t.false(indices.some(i => text[i] === '-' && i > 0)); // No '-' content prefix
});
