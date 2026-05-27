// Pure layout for the two-column "split" diff view. Given a diff hunk's lines —
// each already classified by the chunker's spans — produce the rows the renderer
// draws: context and metadata span the full width; a change block (a run of
// removed lines followed by a run of added lines) becomes paired rows, blank-
// padded to the taller side.
//
// The pairing is semantic (`removed` with `added`); which screen *column* each
// lands in is the renderer's call, not ours. No Ink and no engine here: a pure
// function so the fiddly alignment can be unit-tested without a terminal. 2-D
// arrangement is a renderer concern, which is why this is layout, not chunking
// (see docs/rendering.md).

import stringWidth from 'string-width';
import {segmentGraphemes} from './grapheme.js';

export type DiffLineKind = 'removed' | 'added' | 'context' | 'meta';

export type DiffLine = Readonly<{
	text: string;
	start: number; // Text offset of the line's first char (for styleFor / cursor)
	kind: DiffLineKind;
}>;

// A row to render. `full` spans both columns (context / @@ / metadata). `split`
// pairs a removed line with an added line; either slot may be undefined (a pure
// addition or pure deletion leaves one side blank). The renderer decides which
// column `removed` vs `added` is drawn in.
export type SplitRow =
	| Readonly<{kind: 'full'; line: DiffLine}>
	| Readonly<{
			kind: 'split';
			removed: DiffLine | undefined;
			added: DiffLine | undefined;
	  }>;

// The slice of lines to actually render, given a candidate line range and a row
// budget. When the range fits the budget, it's returned unchanged. When it's
// taller — a chunk bigger than the terminal — a budget-sized window slides to
// follow the cursor, anchored so the focus line sits `lookahead` lines from the
// bottom. That bottom anchoring is the point: terminals scroll to show their
// last rows, so keeping the focus line near the window's bottom keeps it visible
// even when long lines above it wrap (which the source-line budget can't see).
// Pure and renderer-agnostic, so the scrolling math is unit-testable without Ink.
export function visibleLineWindow({
	focusLine,
	rangeStart,
	rangeEnd,
	budget,
	lookahead,
}: {
	readonly focusLine: number;
	readonly rangeStart: number;
	readonly rangeEnd: number;
	readonly budget: number;
	readonly lookahead: number;
}): {start: number; end: number} {
	if (rangeEnd - rangeStart <= budget) {
		return {start: rangeStart, end: rangeEnd};
	}

	// Put the focus line `lookahead` rows above the bottom, but never spill past
	// the range or shrink the window below the budget when there's room to fill it.
	const end = Math.min(
		rangeEnd,
		Math.max(rangeStart + budget, focusLine + lookahead + 1),
	);
	return {start: end - budget, end};
}

// The leftmost column to start rendering at, so the cursor stays visible when a
// line is wider than the column it's drawn in. The horizontal twin of
// visibleLineWindow: zero until the cursor would pass the right edge, then it
// tracks the cursor, holding it `lookahead` columns from the edge so a few
// characters ahead (and the line's ↵ marker) stay in view. Truncating each line
// to [offset, offset + width) keeps it on one row — no soft-wrap, so rows stay
// equal to source lines and the split columns stay aligned.
export function horizontalOffset(
	cursorColumn: number,
	width: number,
	lookahead: number,
): number {
	const rightEdge = Math.max(0, width - 1 - lookahead);
	return Math.max(0, cursorColumn - rightEdge);
}

export function splitDiffRows(lines: readonly DiffLine[]): SplitRow[] {
	const rows: SplitRow[] = [];
	let i = 0;

	while (i < lines.length) {
		const {kind} = lines[i]!;

		// Context and metadata aren't part of a change — they span both columns.
		if (kind === 'context' || kind === 'meta') {
			rows.push({kind: 'full', line: lines[i]!});
			i++;
			continue;
		}

		// Otherwise we're at the start of a change block: collect the run of removed
		// lines, then the run of added lines (the order a unified diff emits them).
		const removed: DiffLine[] = [];
		while (i < lines.length && lines[i]!.kind === 'removed') {
			removed.push(lines[i]!);
			i++;
		}

		const added: DiffLine[] = [];
		while (i < lines.length && lines[i]!.kind === 'added') {
			added.push(lines[i]!);
			i++;
		}

		// Pair them row by row; the shorter side gets undefined (blank) padding.
		const height = Math.max(removed.length, added.length);
		for (let k = 0; k < height; k++) {
			rows.push({kind: 'split', removed: removed[k], added: added[k]});
		}
	}

	return rows;
}

// --- Display width -----------------------------------------------------------
// A source character and a terminal column are not the same thing: a tab is
// several columns, CJK and emoji are two, a combining mark is zero. The renderer
// used to assume one char == one column, which broke tab indentation and let a
// wide-glyph line overflow the frame. These helpers map between the two
// coordinate systems — source UTF-16 index (what the engine uses) and display
// column — so the renderer can scroll and slice in real columns. Pure: no Ink,
// no engine; the only dependency is string-width for measuring a cluster.

// Each tab renders as this many spaces. Fixed (not a moving tab stop) to keep
// indentation compact and column-independent. Display-only: the engine never
// types indentation (computeTypeableIndices skips tabs), so this changes how a
// line *looks*, never what counts as typed.
export const spacesPerTab = 2;

// One terminal display cell: a single grapheme cluster (or an expanded tab),
// placed in both coordinate systems. `sourceStart` is the cluster's first UTF-16
// index — the same position styleFor / isCursor / the engine key on, so a cell
// maps straight back to a typeable position. `col`/`width` are display columns
// (0 for a combining mark, 1 for ASCII, 2 for CJK/emoji, spacesPerTab for a tab).
export type LineCell = Readonly<{
	text: string; // The glyph(s) to draw, or spaces for a tab
	sourceStart: number; // Absolute UTF-16 index of the cluster's first code unit
	col: number; // Left display column
	width: number; // Display columns occupied
}>;

// Break a source line into display cells: grapheme-segment it (so a wide glyph or
// a multi-code-unit emoji is ONE cell), then measure each cluster's width. The
// order matters — the width of half an emoji is meaningless, so we must segment
// before measuring, which is exactly why a cell can span several source code
// units. `lineStart` is the line's absolute UTF-16 offset in the full text, so
// each cell's sourceStart lines up with cursor / styleFor positions.
export function measureLine(
	line: string,
	lineStart: number,
): readonly LineCell[] {
	const cells: LineCell[] = [];
	let col = 0;
	for (const {segment, index} of segmentGraphemes(line)) {
		const sourceStart = lineStart + index;
		// String-width can't measure a tab (it returns 0, while a terminal expands
		// it), so intercept tabs before measuring and give them a fixed width.
		if (segment === '\t') {
			cells.push({
				text: ' '.repeat(spacesPerTab),
				sourceStart,
				col,
				width: spacesPerTab,
			});
			col += spacesPerTab;
		} else {
			const width = stringWidth(segment);
			cells.push({text: segment, sourceStart, col, width});
			col += width;
		}
	}

	return cells;
}

// The cells fully inside the column window [colOffset, colOffset + width). A wide
// cell (or expanded tab) straddling *either* edge is dropped, not half-drawn — a
// terminal can't paint half a 中, and a sliced surrogate is mojibake. `leftPad`
// is the blank columns to emit before the first survivor when the left edge cut
// into a wide cell, so every column after it still lines up. The right edge needs
// no pad: a dropped straddler just leaves the last column(s) blank, as a terminal
// would.
export function cellWindow(
	cells: readonly LineCell[],
	colOffset: number,
	width: number,
): {cells: readonly LineCell[]; leftPad: number} {
	const windowEnd = colOffset + width;
	const visible = cells.filter(
		cell => cell.col >= colOffset && cell.col + cell.width <= windowEnd,
	);
	const leftPad = visible.length > 0 ? visible[0]!.col - colOffset : 0;
	return {cells: visible, leftPad};
}

// The display column a source position begins at — used to turn the cursor's
// source index into a real column for horizontalOffset. Exact on a cluster's
// start; a position inside a multi-unit cluster (mid-emoji) resolves to that
// cluster's left column; a position at or past the line's end (the newline slot)
// returns the line's full display width, where the ↵ marker sits.
export function columnForSource(
	cells: readonly LineCell[],
	sourcePos: number,
): number {
	let containingCol = 0; // Left column of the last cluster starting at/before sourcePos
	let endColumn = 0; // Column just past everything scanned (the end-of-line slot)
	for (const cell of cells) {
		if (cell.sourceStart === sourcePos) return cell.col;
		if (cell.sourceStart > sourcePos) return containingCol;
		containingCol = cell.col;
		endColumn = cell.col + cell.width;
	}

	return endColumn;
}

// Expand tabs to spaces for a display-only string — the split view's reference
// column, which Ink truncates as a single <Text> (no per-cell styling, no
// cursor). Uses the same fixed width as measureLine so both columns indent
// identically. CJK/emoji pass through untouched; Ink measures their width itself.
export function expandTabs(line: string): string {
	return line.replaceAll('\t', ' '.repeat(spacesPerTab));
}
