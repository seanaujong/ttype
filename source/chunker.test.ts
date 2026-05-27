import test from 'ava';
import {
	blankLineChunker,
	computeTypeableIndices,
	diffChunker,
	markdownChunker,
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

test('markdownChunker: heading produces its own chunk with cosmetic prefix', t => {
	const chunks = markdownChunker('# Hello');
	t.is(chunks.length, 1);
	t.is(chunks[0]!.kind, 'heading');
	// '# ' is the cosmetic prefix; 'Hello' is typeable
	t.deepEqual(chunks[0]!.spans, [
		{start: 0, end: 2, style: 'md-heading-prefix'},
	]);
});

test('markdownChunker: prose paragraph between headings', t => {
	const text = '# Title\n\nA prose paragraph.\n\n## Sub';
	const chunks = markdownChunker(text);
	t.is(chunks.length, 3);
	t.is(chunks[0]!.kind, 'heading');
	t.is(chunks[1]!.kind, 'prose');
	t.is(chunks[2]!.kind, 'heading');
});

test('markdownChunker: bold markers are cosmetic, content typeable', t => {
	const text = 'This is **bold** here.';
	const chunks = markdownChunker(text);
	// Two emphasis-marker spans, one for each `**`
	const emphasisSpans = chunks[0]!.spans!.filter(
		s => s.style === 'md-emphasis-marker',
	);
	t.is(emphasisSpans.length, 2);
	// Each span covers exactly the 2-char marker
	t.true(emphasisSpans.every(s => s.end - s.start === 2));
});

test('markdownChunker: italic with underscore, ignoring word-internal _', t => {
	const text = 'A _real_ italic plus var_name not italic.';
	const chunks = markdownChunker(text);
	// Two spans — the opening `_` and closing `_` of "_real_". `var_name` not matched.
	const emphasisSpans = chunks[0]!.spans!.filter(
		s => s.style === 'md-emphasis-marker',
	);
	t.is(emphasisSpans.length, 2);
});

test('markdownChunker: link syntax cosmetic; link text typeable', t => {
	const text = 'See [the docs](https://example.com) for more.';
	const chunks = markdownChunker(text);
	const linkSpans = chunks[0]!.spans!.filter(s => s.style === 'md-link-syntax');
	// One for `[`, one for `](url)`
	t.is(linkSpans.length, 2);
});

test('markdownChunker: inline code backticks cosmetic; content typeable', t => {
	const text = 'Call `applyEvent` to advance.';
	const chunks = markdownChunker(text);
	const codeSpans = chunks[0]!.spans!.filter(s => s.style === 'md-code-span');
	// One span for the opening backtick, one for the closing — each 1 char.
	t.is(codeSpans.length, 2);
	t.true(codeSpans.every(s => s.end - s.start === 1));
	// The code text between the backticks stays in the typing path.
	const indices = computeTypeableIndices(text, chunks);
	const contentStart = text.indexOf('applyEvent');
	for (let i = 0; i < 'applyEvent'.length; i++) {
		t.true(indices.includes(contentStart + i), `expected ${contentStart + i}`);
	}
});

test('markdownChunker: list markers cosmetic; item text typeable', t => {
	const text = '- first item\n- second item';
	const chunks = markdownChunker(text);
	const markerSpans = chunks[0]!.spans!.filter(
		s => s.style === 'md-list-marker',
	);
	// One span per bullet, each covering '- ' (marker + trailing space).
	t.is(markerSpans.length, 2);
	t.true(markerSpans.every(s => s.end - s.start === 2));
	// Item text is typed; the '-' markers are not.
	const indices = computeTypeableIndices(text, chunks);
	t.false(indices.some(i => text[i] === '-'));
	const firstItem = text.indexOf('first');
	t.true(indices.includes(firstItem));
});

test('markdownChunker: ordered list marker cosmetic', t => {
	const text = '1. do this\n2. then this';
	const chunks = markdownChunker(text);
	const markerSpans = chunks[0]!.spans!.filter(
		s => s.style === 'md-list-marker',
	);
	t.is(markerSpans.length, 2);
	// '1. ' and '2. ' are three chars each.
	t.true(markerSpans.every(s => s.end - s.start === 3));
});

test('markdownChunker: bold/rule at line start is not a list marker', t => {
	// `**bold**` and `---` both start with list-marker chars but lack the
	// marker-then-space shape, so neither should match.
	const text = '**bold** lead-in\n---';
	const chunks = markdownChunker(text);
	const markerSpans = chunks.flatMap(c =>
		(c.spans ?? []).filter(s => s.style === 'md-list-marker'),
	);
	t.is(markerSpans.length, 0);
});

test('markdownChunker: block-quote prefix cosmetic; quoted text typeable', t => {
	const text = '> quoted line\n> more quote';
	const chunks = markdownChunker(text);
	const quoteSpans = chunks[0]!.spans!.filter(
		s => s.style === 'md-quote-prefix',
	);
	t.is(quoteSpans.length, 2);
	t.true(quoteSpans.every(s => s.end - s.start === 2)); // '> '
	const indices = computeTypeableIndices(text, chunks);
	t.false(indices.some(i => text[i] === '>'));
	const quoted = text.indexOf('quoted');
	t.true(indices.includes(quoted));
});

test('markdownChunker: fenced code block becomes its own chunk', t => {
	const text = '```ts\nconst x = 1;\nconst y = 2;\n```';
	const chunks = markdownChunker(text);
	t.is(chunks.length, 1);
	t.is(chunks[0]!.kind, 'fenced-code');
	// Two fence spans (open and close)
	const fenceSpans = chunks[0]!.spans!.filter(s => s.style === 'md-fence');
	t.is(fenceSpans.length, 2);
});

test('markdownChunker: fence content stays typeable (verbatim code)', t => {
	const text = '```\nhello\n```';
	const chunks = markdownChunker(text);
	const indices = computeTypeableIndices(text, chunks);
	// The 'hello' chars should all be typeable; the fence lines should not be.
	const helloStart = text.indexOf('hello');
	for (let i = 0; i < 'hello'.length; i++) {
		t.true(
			indices.includes(helloStart + i),
			`expected ${helloStart + i} typeable`,
		);
	}
});

test('computeTypeableIndices skips unmappable typographic chars (ellipsis)', t => {
	// 'a…b' — the ellipsis has no 1:1 ASCII keystroke, so it's skipped.
	// Positions: a=0, …=1, b=2. Typeable: a, b.
	t.deepEqual(computeTypeableIndices('a…b'), [0, 2]);
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
