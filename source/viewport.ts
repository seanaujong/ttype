// Owns the "frame fits the terminal" invariant — the one rendering rule that has
// bitten repeatedly: a frame that reaches the terminal's edge makes it scroll or
// wrap, which forces Ink to repaint the whole frame (a flicker / cursor "trail")
// instead of updating in place. `frameBudget` is the single home for the
// reservation arithmetic the renderer used to inline; `frameFits` / `frameViolations`
// are that invariant as a predicate the standing test checks against real emitted
// frames. Pure: the only dependency is string-width, to measure a row's display
// width. See docs/architecture.md and memory ink-frame-overflow.

import stringWidth from 'string-width';

export type FrameBudget = Readonly<{
	rows: number; // Live terminal rows
	columns: number; // Live terminal columns
	footerRows: number; // Rows the status footer occupies
	usableRows: number; // Rows − 1: reserve the last row (a frame filling it scrolls)
	usableColumns: number; // Columns − 1: reserve the last column (a row filling it wraps)
	contentLineBudget: number; // UsableRows − footerRows: rows left for content
}>;

// How much of the terminal the renderer may use. Reserves the last row and the
// last column: a frame that reaches either edge makes the terminal scroll/wrap,
// which forces Ink to repaint instead of updating in place (the flicker). Clamps
// to at least 1 so a tiny terminal still yields a usable (if cramped) budget.
export function frameBudget(
	rows: number,
	columns: number,
	footerRows: number,
): FrameBudget {
	const usableRows = Math.max(1, rows - 1);
	const usableColumns = Math.max(1, columns - 1);
	const contentLineBudget = Math.max(1, usableRows - footerRows);
	return {
		rows,
		columns,
		footerRows,
		usableRows,
		usableColumns,
		contentLineBudget,
	};
}

// Where a rendered frame breaks the budget: too many rows, and/or rows wider than
// usableColumns (by display width). Checked against the *reserved* budget, so a
// frame exactly as tall as the terminal is a violation — that's the subtle
// scroll-flicker case, not just strict overflow.
export function frameViolations(
	frameLines: readonly string[],
	budget: FrameBudget,
): {tooTall: boolean; overWideRows: readonly number[]} {
	const overWideRows: number[] = [];
	for (const [i, line] of frameLines.entries()) {
		if (stringWidth(line) > budget.usableColumns) overWideRows.push(i);
	}

	return {tooTall: frameLines.length > budget.usableRows, overWideRows};
}

// The "frame fits the terminal" invariant, in code.
export function frameFits(
	frameLines: readonly string[],
	budget: FrameBudget,
): boolean {
	const {tooTall, overWideRows} = frameViolations(frameLines, budget);
	return !tooTall && overWideRows.length === 0;
}
