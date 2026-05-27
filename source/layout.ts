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
