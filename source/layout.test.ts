import test from 'ava';
import {
	cellWindow,
	columnForSource,
	expandTabs,
	horizontalOffset,
	measureLine,
	spacesPerTab,
	splitDiffRows,
	visibleLineWindow,
	type DiffLine,
	type SplitRow,
} from './layout.js';

// Build a DiffLine without caring about real offsets (the grouping logic
// doesn't read `start` — that's only for the renderer's per-char styling).
const line = (kind: DiffLine['kind'], text: string = kind): DiffLine => ({
	text,
	start: 0,
	kind,
});

const kinds = (rows: readonly SplitRow[]) => rows.map(row => row.kind);

test('splitDiffRows: empty input produces no rows', t => {
	t.deepEqual(splitDiffRows([]), []);
});

test('splitDiffRows: context and metadata span the full width', t => {
	t.deepEqual(kinds(splitDiffRows([line('meta'), line('context')])), [
		'full',
		'full',
	]);
});

test('splitDiffRows: a change block pairs a removed line with an added line', t => {
	const removed = line('removed', 'old');
	const added = line('added', 'new');
	t.deepEqual(splitDiffRows([removed, added]), [
		{kind: 'split', removed, added},
	]);
});

test('splitDiffRows: an uneven block pads the shorter side with undefined', t => {
	const r0 = line('removed', 'r0');
	const a = [line('added', 'a0'), line('added', 'a1'), line('added', 'a2')];
	t.deepEqual(splitDiffRows([r0, ...a]), [
		{kind: 'split', removed: r0, added: a[0]},
		{kind: 'split', removed: undefined, added: a[1]},
		{kind: 'split', removed: undefined, added: a[2]},
	]);
});

test('splitDiffRows: a pure addition leaves the removed slot empty', t => {
	const rows = splitDiffRows([line('added', 'x'), line('added', 'y')]);
	t.true(rows.every(row => row.kind === 'split' && row.removed === undefined));
});

test('splitDiffRows: a pure deletion leaves the added slot empty', t => {
	const removed = line('removed', 'x');
	t.deepEqual(splitDiffRows([removed]), [
		{kind: 'split', removed, added: undefined},
	]);
});

test('splitDiffRows: context separates two change blocks', t => {
	const rows = splitDiffRows([
		line('context', 'c1'),
		line('removed', 'r'),
		line('added', 'a'),
		line('context', 'c2'),
		line('added', 'a2'),
	]);
	t.deepEqual(kinds(rows), ['full', 'split', 'full', 'split']);
});

// VisibleLineWindow — the cursor-following viewport clamp. `lookahead` is fixed
// at 3 here so the bottom-anchoring is easy to read in the expected values.
const window_ = (
	focusLine: number,
	rangeStart: number,
	rangeEnd: number,
	budget: number,
) => visibleLineWindow({focusLine, rangeStart, rangeEnd, budget, lookahead: 3});

test('visibleLineWindow: a range within budget is returned unchanged', t => {
	t.deepEqual(window_(5, 0, 10, 24), {start: 0, end: 10});
});

test('visibleLineWindow: a focus line near the top still shows from the top', t => {
	// Cursor at line 2 of a 45-line range, budget 24: lookahead would put the
	// window bottom at 6, but that's below the budget floor, so it shows [0, 24).
	t.deepEqual(window_(2, 0, 45, 24), {start: 0, end: 24});
});

test('visibleLineWindow: a mid-range focus line sits lookahead rows from the bottom', t => {
	// Cursor at 30: window ends at 30 + 3 + 1 = 34, sized to the budget back to 10.
	t.deepEqual(window_(30, 0, 45, 24), {start: 10, end: 34});
});

test('visibleLineWindow: the window never spills past the range end', t => {
	// Cursor at the last line (44): window clamps its end to 45, not 48.
	t.deepEqual(window_(44, 0, 45, 24), {start: 21, end: 45});
});

test('visibleLineWindow: the focus line is always inside the returned window', t => {
	// Sweep every focus line of an oversized range; the cursor must stay visible.
	for (let focus = 0; focus < 45; focus++) {
		const {start, end} = window_(focus, 0, 45, 24);
		t.true(
			focus >= start && focus < end,
			`focus ${focus} fell outside [${start}, ${end})`,
		);
		t.is(
			end - start,
			24,
			'window stays exactly the budget when the range is bigger',
		);
	}
});

// HorizontalOffset — the column twin of visibleLineWindow. lookahead 8 here.
const offset = (cursorColumn: number, width: number) =>
	horizontalOffset(cursorColumn, width, 8);

test('horizontalOffset: a cursor within the width needs no scroll', t => {
	t.is(offset(0, 65), 0);
	t.is(offset(40, 65), 0);
	// At the right edge minus lookahead, still no scroll (cursor at column 56).
	t.is(offset(56, 65), 0);
});

test('horizontalOffset: past the right edge, the offset tracks the cursor', t => {
	// Width 65, lookahead 8 -> cursor pinned 56 columns from the left once scrolling.
	t.is(offset(57, 65), 1);
	t.is(offset(100, 65), 44);
});

test('horizontalOffset: the cursor stays visible and lookahead columns from the edge', t => {
	for (let cursor = 0; cursor < 200; cursor++) {
		const off = offset(cursor, 65);
		const screenColumn = cursor - off;
		t.true(
			screenColumn >= 0 && screenColumn < 65,
			`cursor ${cursor} off-screen`,
		);
		// Once scrolled, the cursor holds at width-1-lookahead so there's read-ahead.
		if (off > 0) t.is(screenColumn, 56);
	}
});

test('horizontalOffset: a width at or below the lookahead degrades to tracking from column 0', t => {
	// RightEdge clamps to 0, so the cursor just sits at the left and stays visible.
	t.is(offset(5, 6), 5);
});

// MeasureLine — the source-index ↔ display-column bridge. Each case pins how a
// kind of character maps: its display width and where its cluster starts in the
// source string (which can differ from its column once tabs/wide glyphs appear).
test('measureLine: ASCII is one column per character', t => {
	t.deepEqual(measureLine('abc', 0), [
		{text: 'a', sourceStart: 0, col: 0, width: 1},
		{text: 'b', sourceStart: 1, col: 1, width: 1},
		{text: 'c', sourceStart: 2, col: 2, width: 1},
	]);
});

test('measureLine: a tab expands to spacesPerTab columns wherever it sits', t => {
	t.is(spacesPerTab, 2);
	// Tab at column 1 → 2 spaces, so the next char starts at column 3 (its source
	// index is 2, since the tab is one code unit — column ≠ index from here on).
	t.deepEqual(measureLine('a\tb', 0), [
		{text: 'a', sourceStart: 0, col: 0, width: 1},
		{text: '  ', sourceStart: 1, col: 1, width: 2},
		{text: 'b', sourceStart: 2, col: 3, width: 1},
	]);
	// Fixed width (not a moving tab stop): a tab at column 2 is still 2 wide.
	t.deepEqual(measureLine('ab\tc', 0), [
		{text: 'a', sourceStart: 0, col: 0, width: 1},
		{text: 'b', sourceStart: 1, col: 1, width: 1},
		{text: '  ', sourceStart: 2, col: 2, width: 2},
		{text: 'c', sourceStart: 3, col: 4, width: 1},
	]);
});

test('measureLine: a CJK glyph is two columns, one code unit', t => {
	t.deepEqual(measureLine('中a', 0), [
		{text: '中', sourceStart: 0, col: 0, width: 2},
		{text: 'a', sourceStart: 1, col: 2, width: 1},
	]);
});

test('measureLine: an emoji is one cluster two columns, but two code units', t => {
	// The follow-up `x` starts at source index 2 (the emoji is two UTF-16 units)
	// yet column 2 — the clearest illustration that index, column, and keystroke
	// are three different counts.
	t.deepEqual(measureLine('😀x', 0), [
		{text: '😀', sourceStart: 0, col: 0, width: 2},
		{text: 'x', sourceStart: 2, col: 2, width: 1},
	]);
});

test('measureLine: a combining mark folds into its base (width 1), a lone one is width 0', t => {
	const combined = measureLine('é', 0); // E + combining acute → é
	t.is(combined.length, 1);
	t.is(combined[0]!.width, 1);
	t.is(combined[0]!.sourceStart, 0);

	const lone = measureLine('́', 0);
	t.deepEqual(lone, [{text: '́', sourceStart: 0, col: 0, width: 0}]);
});

test('measureLine: lineStart offsets every cell into the full-text coordinate', t => {
	t.deepEqual(measureLine('ab', 10), [
		{text: 'a', sourceStart: 10, col: 0, width: 1},
		{text: 'b', sourceStart: 11, col: 1, width: 1},
	]);
});

// CellWindow — slice cells to a column window, dropping (never half-drawing) a
// wide cell that straddles an edge.
test('cellWindow: a window covering the line keeps every cell', t => {
	const cells = measureLine('abc', 0);
	t.deepEqual(cellWindow(cells, 0, 3), {cells, leftPad: 0});
});

test('cellWindow: a wide glyph straddling the right edge is dropped, not split', t => {
	// 'a中': a at col 0 (w1), 中 at col 1 (w2). A width-2 window holds `a` but the
	// 中 would spill to column 3, so it's dropped — no half-glyph.
	const cells = measureLine('a中', 0);
	t.deepEqual(cellWindow(cells, 0, 2), {cells: [cells[0]!], leftPad: 0});
});

test('cellWindow: a wide glyph straddling the left edge is dropped and padded', t => {
	// '中a': 中 spans columns 0–1, a at col 2. Scrolling to colOffset 1 cuts into
	// 中, so it's dropped; `a` survives one column in, hence leftPad 1.
	const cells = measureLine('中a', 0);
	t.deepEqual(cellWindow(cells, 1, 2), {cells: [cells[1]!], leftPad: 1});
});

// ColumnForSource — a source position → its display column (the cursor).
test('columnForSource: a cluster start maps to its own column', t => {
	const cells = measureLine('中a', 0); // A is index 1, column 2
	t.is(columnForSource(cells, 0), 0);
	t.is(columnForSource(cells, 1), 2);
});

test('columnForSource: a position inside a cluster maps to the cluster left column', t => {
	const cells = measureLine('😀x', 0); // Emoji occupies source 0–1, column 0
	t.is(columnForSource(cells, 1), 0); // Mid-emoji → emoji's left column
});

test('columnForSource: the end-of-line slot maps to the line width', t => {
	t.is(columnForSource(measureLine('中', 0), 1), 2); // Newline after a 2-col glyph
	t.is(columnForSource(measureLine('', 0), 0), 0); // Empty line
});

// ExpandTabs — display-only tab expansion for the split reference column.
test('expandTabs: tabs become spacesPerTab spaces; other glyphs pass through', t => {
	t.is(expandTabs('a\tb'), 'a  b');
	t.is(expandTabs('\t'), '  ');
	t.is(expandTabs('中\tx'), '中  x');
});
