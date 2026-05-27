import test from 'ava';
import {
	horizontalOffset,
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
