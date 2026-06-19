import test, {type ExecutionContext} from 'ava';
import {
	adjacentTypeableChunk,
	blankLineChunker,
	computeTypeableIndices,
	diffChunker,
	markdownChunker,
	typeableChunkIndices,
	typeableIndicesFromChunk,
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

test('diffChunker: the leading metadata preamble folds into the first hunk', t => {
	const diff =
		'diff --git a/foo b/foo\nindex abc..def\n--- a/foo\n+++ b/foo\n@@ -1 +1 @@\n+added';
	const chunks = diffChunker(diff);
	// The preamble has nothing typeable, so it isn't a chunk of its own — it's
	// part of the first hunk's chunk, which starts at 0. (Otherwise the run would
	// open on "chunk 2".)
	t.is(chunks.length, 1);
	t.is(chunks[0]!.start, 0);
	t.is(chunks[0]!.end, diff.length);
	// And the first typeable position lands inside that chunk 1.
	const typeable = computeTypeableIndices(diff, chunks);
	t.true(typeable.length > 0);
	t.true(typeable[0]! >= chunks[0]!.start && typeable[0]! < chunks[0]!.end);
});

test('diffChunker: a preamble before multiple hunks rides with the first hunk', t => {
	const diff =
		'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n+one\n@@ -5 +5 @@\n+two';
	const chunks = diffChunker(diff);
	// Preamble + first hunk = chunk 1; the second hunk = chunk 2.
	t.is(chunks.length, 2);
	t.is(chunks[0]!.start, 0);
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

test('markdownChunker: HTML comment block is one cosmetic chunk', t => {
	// A multi-line comment with a blank line inside it — the readme's shape. The
	// blank line must not split it, so it's one `comment` chunk, fully covered by
	// a single md-comment span.
	const text = '<!--\nfirst note\n\nsecond note\n-->';
	const chunks = markdownChunker(text);
	t.is(chunks.length, 1);
	t.is(chunks[0]!.kind, 'comment');
	t.deepEqual(chunks[0]!.spans, [
		{start: 0, end: text.length, style: 'md-comment'},
	]);
});

test('markdownChunker: comment is skipped, surrounding prose stays typeable', t => {
	const text = '# Title\n\n<!--\neditorial note\n-->\n\nreal content';
	const chunks = markdownChunker(text);
	const indices = computeTypeableIndices(text, chunks);
	// Nothing inside the comment block is typeable.
	const commentStart = text.indexOf('<!--');
	const commentEnd = text.indexOf('-->') + '-->'.length;
	for (let i = commentStart; i < commentEnd; i++) {
		t.false(indices.includes(i), `comment position ${i} should be skipped`);
	}

	// The prose after it still is.
	const contentStart = text.indexOf('real content');
	for (let i = 0; i < 'real content'.length; i++) {
		t.true(
			indices.includes(contentStart + i),
			`expected ${contentStart + i} typeable`,
		);
	}

	// The comment block has nothing typeable, so its trailing newline must not be
	// typeable either — otherwise the block becomes a chunk you can only Enter past.
	const commentNewline = text.indexOf('\n', text.indexOf('-->'));
	t.false(indices.includes(commentNewline));
});

test('computeTypeableIndices drops the Enter on an all-skipped line', t => {
	// 'A\nhttps://x.com/y\nB' — the URL line has no typeable content, so its
	// trailing newline is dropped: you type A, one Enter, then B. (A=0, \n=1, the
	// 15-char URL fills 2..16, its \n at 17 is dropped, B=18.)
	t.deepEqual(computeTypeableIndices('A\nhttps://x.com/y\nB'), [0, 1, 18]);
});

test('markdownChunker: unclosed comment runs to end-of-text', t => {
	const text = 'intro\n\n<!--\ndangling note, no close';
	const chunks = markdownChunker(text);
	const comment = chunks.find(c => c.kind === 'comment');
	t.truthy(comment);
	t.is(comment!.end, text.length);
});

test('computeTypeableIndices skips a bare URL in any text (base layer)', t => {
	// No chunks — the plain-text path. URL skipping lives in the kind-agnostic base
	// layer, so it applies to prose, code, commits, diffs alike, not just markdown.
	const text = 'See https://example.com/a/b for more.';
	const indices = computeTypeableIndices(text);
	const urlStart = text.indexOf('https');
	const urlEnd = text.indexOf(' for');
	for (let i = urlStart; i < urlEnd; i++) {
		t.false(indices.includes(i), `url char ${i} should be skipped`);
	}

	// The surrounding words stay typeable.
	t.true(indices.includes(text.indexOf('See')));
	t.true(indices.includes(text.indexOf('for')));
});

test('computeTypeableIndices collapses a run of spaces to one keystroke', t => {
	// 'a    b' — 'a'=0, four spaces at 1-4, 'b'=5. Only the run's first space (1)
	// is typeable; 2,3,4 are skipped, so one Space advances a -> b.
	t.deepEqual(computeTypeableIndices('a    b'), [0, 1, 5]);
});

test('computeTypeableIndices keeps a lone space typeable', t => {
	// Single spaces are ordinary word spacing — every position stays typeable.
	t.deepEqual(computeTypeableIndices('a b c'), [0, 1, 2, 3, 4]);
});

test('computeTypeableIndices skips unmappable typographic chars (ellipsis)', t => {
	// 'a…b' — the ellipsis has no 1:1 ASCII keystroke, so it's skipped.
	// Positions: a=0, …=1, b=2. Typeable: a, b.
	t.deepEqual(computeTypeableIndices('a…b'), [0, 2]);
});

// TypeableIndicesFromChunk — chunk skipping is range selection, so it's just a
// filter over the typeable set. Tested in isolation with synthetic chunks.

test('typeableIndicesFromChunk: startChunkIdx 0 returns the same set (no copy)', t => {
	const chunks = [
		{start: 0, end: 5},
		{start: 6, end: 10},
	];
	const indices = [0, 1, 2, 6, 7, 8];
	t.is(typeableIndicesFromChunk(indices, chunks, 0), indices);
});

test('typeableIndicesFromChunk: a later start chunk drops earlier positions', t => {
	const chunks = [
		{start: 0, end: 5},
		{start: 6, end: 10},
	];
	const indices = [0, 1, 2, 6, 7, 8];
	// Scope to chunk index 1 (start 6): keep only positions at or after it.
	t.deepEqual(typeableIndicesFromChunk(indices, chunks, 1), [6, 7, 8]);
});

test('typeableIndicesFromChunk: out-of-range index clamps to the last chunk', t => {
	const chunks = [
		{start: 0, end: 5},
		{start: 6, end: 10},
	];
	const indices = [0, 1, 2, 6, 7, 8];
	t.deepEqual(typeableIndicesFromChunk(indices, chunks, 99), [6, 7, 8]);
});

test('typeableIndicesFromChunk: no chunks returns the set unchanged', t => {
	const indices = [0, 1, 2];
	t.is(typeableIndicesFromChunk(indices, [], 2), indices);
});

test('typeableIndicesFromChunk: scoping past a chunk excludes its content', t => {
	const text = 'first para\n\nsecond para';
	const chunks = blankLineChunker(text);
	const all = computeTypeableIndices(text, chunks);
	const scoped = typeableIndicesFromChunk(all, chunks, 1);
	// Chunks[1] = 'second para'; nothing before its start survives.
	t.true(scoped.every(pos => pos >= chunks[1]!.start));
	t.true(scoped.length < all.length);
	// 'first' drops out of the typeable set; 'second' stays in it.
	t.false(scoped.includes(text.indexOf('first')));
	t.true(scoped.includes(text.indexOf('second')));
});

// Stops + skip navigation. Chunk 1 (S) is fully cosmetic (no typeable position
// lands in it); A and B have content. Navigation reads the derived stops list, so
// a cosmetic chunk is simply absent from it.
const skipChunks = [
	{start: 0, end: 5}, // A
	{start: 6, end: 10}, // S — cosmetic
	{start: 11, end: 15}, // B
];
const skipTypeable = [0, 1, 2, 3, 11, 12, 13, 14]; // None in S's [6,10)

test('typeableChunkIndices: a fully-cosmetic chunk is not a stop', t => {
	t.deepEqual(typeableChunkIndices(skipChunks, skipTypeable), [0, 2]);
});

test('adjacentTypeableChunk: back from B steps over cosmetic S to A', t => {
	const stops = typeableChunkIndices(skipChunks, skipTypeable);
	t.is(adjacentTypeableChunk(stops, 2, -1), 0);
});

test('adjacentTypeableChunk: forward from A steps over cosmetic S to B', t => {
	const stops = typeableChunkIndices(skipChunks, skipTypeable);
	t.is(adjacentTypeableChunk(stops, 0, 1), 2);
});

test('adjacentTypeableChunk: no stop that way is a no-op', t => {
	const stops = typeableChunkIndices(skipChunks, skipTypeable);
	t.is(adjacentTypeableChunk(stops, 0, -1), 0); // Nothing before A
	t.is(adjacentTypeableChunk(stops, 2, 1), 2); // Nothing after B
});

// Diff typeable-contract invariant: you type the *content* of a changed line,
// never its indentation — regardless of whether the diff is tab- or space-
// indented. (Space indentation used to leak in: the '+' marker sits at column 0,
// so the indentation after it isn't "leading" whitespace the generic skip drops.)
function assertIndentationNotTypeable(t: ExecutionContext, diff: string) {
	const idx = computeTypeableIndices(diff, diffChunker(diff));
	const markerPos = diff.indexOf('\n') + 1; // The added line's '+' marker
	const contentStart = diff.indexOf('const');
	for (let p = markerPos; p < contentStart; p++) {
		t.false(idx.includes(p), `indentation position ${p} must not be typeable`);
	}

	t.true(idx.includes(contentStart), 'content must be typeable');
}

test('diff added line: tab indentation is not typeable', t => {
	assertIndentationNotTypeable(t, '@@ -1 +1 @@\n+\t\tconst x = 1;');
});

test('diff added line: space indentation is not typeable', t => {
	assertIndentationNotTypeable(t, '@@ -1 +1 @@\n+    const x = 1;');
});

test('diff added line: the content after indentation stays fully typeable', t => {
	const diff = '@@ -1 +1 @@\n+    const x = 1;';
	const idx = computeTypeableIndices(diff, diffChunker(diff));
	const content = 'const x = 1;';
	const start = diff.indexOf(content);
	// Every content character (including the inter-word spaces) is typed.
	for (let i = 0; i < content.length; i++) {
		t.true(idx.includes(start + i), `content position ${start + i} typeable`);
	}
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

// Grapheme-cluster typeable set: one index per cluster (so a multi-code-unit
// accent is one cursor stop), and emoji/flags/symbols are skipped as unkeyable.

test('computeTypeableIndices: an emoji is skipped (cursor jumps past it)', t => {
	// 😀 is pictographic and two code units at index 1, so it's skipped; only a
	// and b are typeable, and b sits at index 3 (after the surrogate pair).
	t.deepEqual(computeTypeableIndices('a😀b'), [0, 3]);
});

test('computeTypeableIndices: a flag (regional indicators) is skipped', t => {
	// The flag is two regional indicators (four code units); only x stays, at 4.
	t.deepEqual(computeTypeableIndices('🇯🇵x'), [4]);
});

test('computeTypeableIndices: an accented letter is a single typeable cluster', t => {
	// Decomposed 'café' (e + combining acute, five code units) → four clusters,
	// so the é is one typeable stop at index 3, not two.
	const cafe = 'café'.normalize('NFD');
	t.is(cafe.length, 5);
	t.deepEqual(computeTypeableIndices(cafe), [0, 1, 2, 3]);
});

test('computeTypeableIndices: CJK stays typeable', t => {
	t.deepEqual(computeTypeableIndices('中a'), [0, 1]);
});
