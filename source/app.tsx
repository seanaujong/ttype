import {Box, Text, useInput, useStdout} from 'ink';
import React, {useEffect, useMemo, useReducer, useState} from 'react';
import {
	computeTypeableIndices,
	typeableIndicesFromChunk,
	type Chunk,
	type Chunker,
	type SpanKind,
} from './chunker.js';
import {initialState, matchesExpected, reducer} from './engine.js';
import {clusterAt} from './grapheme.js';
import {
	cellWindow,
	columnForSource,
	expandTabs,
	horizontalOffset,
	measureLine,
	splitDiffRows,
	visibleLineWindow,
	type DiffLine,
	type DiffLineKind,
} from './layout.js';
import {analyzeByWord, mostMistypedWords, slowestWords} from './review.js';

// Lines kept below the cursor when a chunk is taller than the viewport, so you
// can read a little ahead. Small on purpose: anything below the cursor wraps
// downward in --split, and we want the cursor itself to stay on screen.
const cursorLookahead = 3;

// Columns kept to the right of the cursor when a line is wider than its column —
// enough read-ahead, and room for the ↵ marker (≥ "↵ENTER".length) so it never
// pushes the row past the edge and forces a wrap.
const cursorColumnLookahead = 8;

// Fraction of the width the typed (`+`) column gets in --split; the reference
// (`-`) column takes the rest. The typed side is the protagonist, so it's wider.
const splitTypedFraction = 0.65;

// Display columns reserved for the ↵ marker ("↵ENTER", which string-width
// measures as 6) so a full-width line plus the marker still fits on one row.
const newlineMarkerWidth = 6;

// Rows the status footer occupies (a 1-row top border + 1 row of text). Reserved
// out of the line budget so content + footer never exceeds the terminal height —
// an overflowing frame can't be cleared by Ink, which then stacks each new frame
// below the last (a "trail" of the cursor line).
const statusFooterRows = 2;

type Props = {
	readonly text: string;
	readonly chunker: Chunker;
	readonly isSplit: boolean; // Two-column diff view; default is the unified view
};

// What Racer needs once App has done the source-level work (chunking, scoping).
// typeableIndices is already scoped to the start chunk; onSkip* ask App to move
// that start, which remounts Racer (see the App/Racer split below).
type RacerProps = {
	readonly text: string;
	readonly chunks: Chunk[];
	readonly typeableIndices: readonly number[];
	readonly viewportLineBudget: number;
	readonly viewportColumns: number;
	readonly isSplit: boolean;
	readonly onSkipForward: (fromChunkIdx: number) => void;
	readonly onSkipBack: (fromChunkIdx: number) => void;
};

// Lines + lookup. lineForPos closes over lineRows.
function useLineLayout(text: string) {
	const lineRows = useMemo(() => {
		const rows: Array<{line: string; start: number}> = [];
		let pos = 0;
		for (const line of text.split('\n')) {
			rows.push({line, start: pos});
			pos += line.length + 1;
		}

		return rows;
	}, [text]);

	const lineForPos = (pos: number) =>
		Math.max(
			0,
			lineRows.findLastIndex(row => row.start <= pos),
		);

	return {lineRows, lineForPos};
}

// Focused chunk and the line range to render. The viewport
// expands greedily outward from the focused chunk, taking the smaller
// neighbor first until viewportLineBudget is reached.
function useChunkViewport({
	chunks,
	focusPos,
	lineRows,
	lineForPos,
	viewportLineBudget,
}: {
	readonly chunks: Chunk[];
	readonly focusPos: number;
	readonly lineRows: ReadonlyArray<{line: string; start: number}>;
	readonly lineForPos: (pos: number) => number;
	readonly viewportLineBudget: number;
}) {
	const focusedChunk = chunks.findLast(chunk => chunk.start <= focusPos);

	const chunkLines = (chunk: Chunk): number =>
		lineForPos(chunk.end - 1) - lineForPos(chunk.start) + 1;

	let firstChunkIdx = focusedChunk ? chunks.indexOf(focusedChunk) : -1;
	let lastChunkIdx = firstChunkIdx;
	let totalLines = focusedChunk ? chunkLines(focusedChunk) : 0;

	if (focusedChunk) {
		while (totalLines < viewportLineBudget) {
			const prev = firstChunkIdx > 0 ? chunks[firstChunkIdx - 1] : undefined;
			const next =
				lastChunkIdx + 1 < chunks.length ? chunks[lastChunkIdx + 1] : undefined;

			// Pick the smaller of the two neighbors that fits; if only one fits, take it.
			const prevSize = prev ? chunkLines(prev) : Number.POSITIVE_INFINITY;
			const nextSize = next ? chunkLines(next) : Number.POSITIVE_INFINITY;

			if (
				prev &&
				totalLines + prevSize <= viewportLineBudget &&
				prevSize <= nextSize
			) {
				firstChunkIdx--;
				totalLines += prevSize;
			} else if (next && totalLines + nextSize <= viewportLineBudget) {
				lastChunkIdx++;
				totalLines += nextSize;
			} else {
				break;
			}
		}
	}

	// Computed after the loop so they reflect the expanded range, not the
	// initial focused-chunk-only snapshot.
	const firstVisibleChunk = chunks[firstChunkIdx];
	const lastVisibleChunk = chunks[lastChunkIdx];

	const rangeStartLine = firstVisibleChunk
		? lineForPos(firstVisibleChunk.start)
		: 0;
	const rangeEndLine = lastVisibleChunk
		? lineForPos(lastVisibleChunk.end - 1) + 1
		: lineRows.length;

	// The expansion above fills the budget with whole chunks, but a single chunk
	// can still be taller than the viewport. Clamp to a budget-sized window that
	// follows the cursor so the line being typed never scrolls off-screen.
	const {start: visibleStartLine, end: visibleEndLine} = visibleLineWindow({
		focusLine: lineForPos(focusPos),
		rangeStart: rangeStartLine,
		rangeEnd: rangeEndLine,
		budget: viewportLineBudget,
		lookahead: cursorLookahead,
	});

	// True if this text position is inside the focused chunk (for dimming logic).
	const isInFocus = (pos: number) =>
		focusedChunk !== undefined &&
		pos >= focusedChunk.start &&
		pos < focusedChunk.end;

	return {focusedChunk, visibleStartLine, visibleEndLine, isInFocus};
}

// How each cosmetic SpanKind renders — the single source of truth for span
// decoration. The renderer looks up a position's span here, so what's drawn is
// driven by the spans the chunker emits. Because it's a Record over the SpanKind
// union, adding a kind won't compile until it has a visual — the compiler
// enforces that every span a chunker can emit is drawable.
type SpanVisual = {
	color?: string;
	backgroundColor?: string;
	dimColor?: boolean;
};

const spanVisuals: Record<SpanKind, SpanVisual> = {
	'diff-add': {color: 'green'}, // Leading '+' marker; the added content is typed
	'diff-remove': {color: 'red', dimColor: true}, // Whole removed line — display only
	'diff-header': {dimColor: true}, // @@ hunk header
	'diff-metadata': {dimColor: true}, // Diff --git, index, ---/+++ paths
	'diff-context': {color: 'gray'}, // Leading space on unchanged lines
	'md-heading-prefix': {color: 'gray'}, // '#+ '
	'md-list-marker': {color: 'gray'}, // '- ', '* ', '+ ', '1. '
	'md-quote-prefix': {color: 'gray'}, // '> '
	'md-emphasis-marker': {color: 'gray'}, // ** Or _
	'md-link-syntax': {color: 'gray'}, // [ and ](url)
	'md-code-span': {color: 'gray'}, // The `backtick` pair around inline code
	'md-fence': {color: 'gray'}, // ``` lines
};

// Per-character display decisions: what color/dim to paint each text position,
// and whether the cursor sits there.
function useCharacterStyling({
	text,
	keystrokes,
	typeableIndices,
	chunks,
	cursorPos,
}: {
	readonly text: string;
	readonly keystrokes: string[];
	readonly typeableIndices: readonly number[];
	readonly chunks: Chunk[];
	readonly cursorPos: number | undefined;
}) {
	// Typeable text position → its keystroke index (inverse of the parallel array).
	const positionToKeystrokeIndex = useMemo(() => {
		const map = new Map<number, number>();
		for (const [i, pos] of typeableIndices.entries()) {
			map.set(pos, i);
		}

		return map;
	}, [typeableIndices]);

	// Cosmetic text position → the SpanKind covering it. Built once per chunk set;
	// this is what lets styleFor decorate from span data instead of re-parsing
	// lines. (Spans don't overlap in practice; on overlap, last write wins.)
	const positionToSpanKind = useMemo(() => {
		const map = new Map<number, SpanKind>();
		for (const chunk of chunks) {
			for (const span of chunk.spans ?? []) {
				for (let i = span.start; i < span.end; i++) {
					map.set(i, span.style);
				}
			}
		}

		return map;
	}, [chunks]);

	// Mutually exclusive by construction: computeTypeableIndices subtracts all
	// span ranges from the typeable set, so a position is either typeable (gets
	// green/red typing feedback) or cosmetic (gets a span visual, or default
	// gray) — never both.
	const styleFor = (textPos: number): SpanVisual => {
		const ki = positionToKeystrokeIndex.get(textPos);
		if (ki !== undefined) {
			if (ki >= keystrokes.length) return {}; // Not yet typed
			if (matchesExpected(keystrokes[ki], clusterAt(text, textPos)))
				return {color: 'green'};
			// Wrong. A red foreground is invisible on whitespace (a space has no
			// glyph to color), so flag a mistyped space with a red background block
			// instead — otherwise an error there silently nicks accuracy.
			return /\s/.test(text[textPos]!)
				? {backgroundColor: 'red'}
				: {color: 'red'};
		}

		const kind = positionToSpanKind.get(textPos);
		return kind ? spanVisuals[kind] : {color: 'gray'};
	};

	const spanKindAt = (textPos: number) => positionToSpanKind.get(textPos);

	const isCursor = (textPos: number) => textPos === cursorPos;

	return {styleFor, isCursor, spanKindAt};
}

// Session-meta derivations for the status row.
function useStats({
	text,
	keystrokes,
	typeableIndices,
	startedAt,
	endedAt,
	focusedChunk,
	chunks,
}: {
	readonly text: string;
	readonly keystrokes: string[];
	readonly typeableIndices: readonly number[];
	readonly startedAt: number | undefined;
	readonly endedAt: number | undefined;
	readonly focusedChunk: Chunk | undefined;
	readonly chunks: Chunk[];
}) {
	// What character was the user supposed to type at keystroke index `i`?
	// Translates from keystroke-space to text-space — the canonical lookup
	// any time keystrokes and typeableIndices need to be related, so callers
	// don't repeat the parallel-array dance.
	const expectedAt = (keystrokeIndex: number): string | undefined => {
		const pos = typeableIndices[keystrokeIndex];
		return pos === undefined ? undefined : clusterAt(text, pos);
	};

	const elapsedMinutes =
		startedAt !== undefined && endedAt !== undefined
			? (endedAt - startedAt) / 1000 / 60
			: 0;

	// Standard WPM convention: "word" = 5 chars (used by every type racer).
	// Denominator is typeableIndices.length (chars actually typed), not
	// text.length (which includes whitespace/structure the user skipped).
	const wpm =
		elapsedMinutes > 0
			? Math.round(typeableIndices.length / 5 / elapsedMinutes)
			: 0;

	const correctChars = keystrokes.filter((char, i) =>
		matchesExpected(char, expectedAt(i)),
	).length;
	// "Of what's been typed, how much is correct?" — converges to final-state
	// accuracy when typing completes.
	const accuracy =
		keystrokes.length > 0
			? Math.round((correctChars / keystrokes.length) * 100)
			: 100;

	// Typeable keystrokes done / total
	const progress = `${keystrokes.length} / ${typeableIndices.length}`;

	// Keystrokes-so-far / 5 / minutes-elapsed-so-far
	const liveWpm =
		startedAt !== undefined && endedAt === undefined
			? Math.round(
					keystrokes.length / 5 / ((Date.now() - startedAt) / 1000 / 60),
			  )
			: wpm;

	const chunkPos = focusedChunk
		? `chunk ${chunks.indexOf(focusedChunk) + 1} / ${chunks.length}`
		: '';

	return {progress, liveWpm, accuracy, chunkPos};
}

// The typing session over one scope (start chunk → end of text). App owns the
// scope; Racer owns everything downstream of it — the engine fold, the viewport,
// the styling, the render. App remounts Racer (via a changing `key`) whenever the
// scope changes, so the lazy initializer below re-runs and the engine starts
// fresh over the new typeableIndices. That remount IS the "reset on skip".
function Racer({
	text: initialText,
	chunks,
	typeableIndices,
	viewportLineBudget,
	viewportColumns,
	isSplit,
	onSkipForward,
	onSkipBack,
}: RacerProps) {
	// UseReducer's three-arg form: lazy initializer runs once per mount with the
	// (already scoped) typeable indices App passed in. Two-arg form can't see props.
	const [state, dispatch] = useReducer(reducer, undefined, () =>
		initialState(initialText, typeableIndices),
	);
	const {text, keystrokes, startedAt, endedAt} = state;

	const cursorPos = typeableIndices[keystrokes.length];
	const focusPos =
		cursorPos ?? typeableIndices[typeableIndices.length - 1] ?? 0;

	const {lineRows, lineForPos} = useLineLayout(text);

	// Reserve the footer's rows AND the terminal's last row — the vertical twin of
	// usableColumns reserving the last column. A frame that fills the final row
	// makes the terminal scroll, so Ink repaints the whole frame each keystroke
	// (flicker) instead of updating in place; one spare row keeps it smooth.
	const usableRows = Math.max(1, viewportLineBudget - 1);
	const contentLineBudget = Math.max(1, usableRows - statusFooterRows);

	const {focusedChunk, visibleStartLine, visibleEndLine, isInFocus} =
		useChunkViewport({
			chunks,
			focusPos,
			lineRows,
			lineForPos,
			viewportLineBudget: contentLineBudget,
		});

	// Which chunk the cursor is in right now — skips move relative to this, not to
	// the last skip anchor, so Tab advances from where you are after typing ahead.
	const focusedChunkIdx = focusedChunk ? chunks.indexOf(focusedChunk) : 0;

	const {styleFor, isCursor, spanKindAt} = useCharacterStyling({
		text,
		keystrokes,
		typeableIndices,
		chunks,
		cursorPos,
	});

	const {progress, liveWpm, accuracy, chunkPos} = useStats({
		text,
		keystrokes,
		typeableIndices,
		startedAt,
		endedAt,
		focusedChunk,
		chunks,
	});

	useInput((input, key) => {
		// Skip is scope selection, not typing — it asks App to move the start chunk
		// (which remounts us and resets the run), so it returns before the engine
		// fold sees anything. Shift+Tab and Tab both arrive as key.tab; the shift
		// flag disambiguates. Tab carries no `input`, so it can't fall through to
		// TYPE_CHAR below.
		if (key.tab) {
			if (key.shift) {
				onSkipBack(focusedChunkIdx);
			} else {
				onSkipForward(focusedChunkIdx);
			}
		} else if (key.backspace || key.delete) {
			dispatch({kind: 'BACKSPACE'});
		} else if (key.escape) {
			dispatch({kind: 'RESET'});
		} else if (key.return) {
			dispatch({kind: 'TYPE_CHAR', char: '\n', at: Date.now()});
		} else if (input) {
			dispatch({kind: 'TYPE_CHAR', char: input, at: Date.now()});
		}
	});

	const visibleLines = lineRows.slice(visibleStartLine, visibleEndLine);

	// Reserve the terminal's last column. A row that fills the final cell makes
	// the terminal auto-wrap it onto a second line, which inflates height and
	// re-triggers the frame-stacking overflow. Keeping everything (content rows
	// *and* the footer border) within `usableColumns` leaves that cell empty.
	const usableColumns = Math.max(1, viewportColumns - 1);

	// Horizontal scrolling. Rather than soft-wrap a line wider than its column
	// (which inflates height and desyncs the split columns), each line renders on
	// one row, truncated to a window that follows the cursor. The typed column is
	// the full width in the unified view, a fraction of it in --split; colOffset
	// tracks the cursor against whichever column it currently sits in.
	const typedColumnWidth = isSplit
		? Math.floor(usableColumns * splitTypedFraction)
		: usableColumns;
	const referenceColumnWidth = usableColumns - typedColumnWidth;
	const cursorLineIdx = lineForPos(focusPos);
	const cursorLineStart = lineRows[cursorLineIdx]?.start ?? 0;
	// Display column of the cursor — measured, not focusPos − cursorLineStart,
	// because a tab or wide glyph earlier on the line occupies more than one column.
	const cursorColumn = columnForSource(
		measureLine(lineRows[cursorLineIdx]?.line ?? '', cursorLineStart),
		focusPos,
	);
	const cursorInAddedColumn =
		isSplit && spanKindAt(cursorLineStart) === 'diff-add';
	const colOffset = horizontalOffset(
		cursorColumn,
		cursorInAddedColumn ? typedColumnWidth : usableColumns,
		cursorColumnLookahead,
	);

	// One source line's characters, shared by both views. Each char is its own
	// <Text> so color/cursor apply per position; focus-dimming folds into dimColor.
	// Only the [offset, offset + width) slice is drawn — the rest is scrolled off.
	const renderChars = (
		line: string,
		lineStart: number,
		offset: number, // Leftmost display column to draw (horizontal scroll position)
		width: number, // Display columns available
		lineInFocus: boolean,
	) => {
		// Decompose into display cells (grapheme clusters + expanded tabs, each with
		// its display column), then keep only the cells inside the column window.
		// Slicing by column — not by character count — is what lets a tab or a wide
		// glyph (CJK/emoji) take its true width without overflowing the row.
		const {cells, leftPad} = cellWindow(
			measureLine(line, lineStart),
			offset,
			width,
		);
		return (
			<>
				{leftPad > 0 && <Text>{' '.repeat(leftPad)}</Text>}
				{cells.map(cell => {
					// Style and cursor are keyed on the cell's source index — the same
					// UTF-16 position the engine uses — so a multi-column cell is drawn and
					// highlighted as one unit. A tab's cell text is already its spaces.
					const {color, backgroundColor, dimColor} = styleFor(cell.sourceStart);
					return (
						<Text
							key={cell.sourceStart}
							color={color}
							backgroundColor={backgroundColor}
							dimColor={!lineInFocus || dimColor}
							inverse={isCursor(cell.sourceStart)}
						>
							{cell.text}
						</Text>
					);
				})}
			</>
		);
	};

	// A typeable line: its visible characters plus a ↵ marker at the line's
	// terminating newline. Shown when the cursor sits there (a prompt to press
	// Enter) or when a wrong key was pressed there (an error) — a newline is
	// whitespace, so styleFor flags a mistyped one with a red background, just like
	// a space. A correctly-typed line break shows nothing. This is the only place
	// the cursor can land besides a visible char, so it's the only place the marker
	// appears. When it shows, the content reserves room for it so the row never
	// overflows its width (which would force the wrap we're avoiding).
	const renderTypeableLine = (
		line: string,
		lineStart: number,
		offset: number,
		width: number,
	) => {
		const newlinePos = lineStart + line.length;
		const atCursor = isCursor(newlinePos);
		const {backgroundColor} = styleFor(newlinePos);
		const showMarker = atCursor || backgroundColor !== undefined;
		const contentWidth = showMarker
			? Math.max(0, width - newlineMarkerWidth)
			: width;
		return (
			<>
				{renderChars(
					line,
					lineStart,
					offset,
					contentWidth,
					isInFocus(lineStart),
				)}
				{showMarker && (
					<Text inverse={atCursor} backgroundColor={backgroundColor}>
						{atCursor ? '↵ENTER' : '↵'}
					</Text>
				)}
			</>
		);
	};

	// Default view: one source line per row, top to bottom. wrap="truncate" is a
	// belt-and-suspenders guard — renderTypeableLine already slices to width.
	const renderUnifiedView = () =>
		visibleLines.map(({line, start}) => (
			<Text key={start} wrap="truncate">
				{renderTypeableLine(line, start, colOffset, usableColumns)}
			</Text>
		));

	// Classify a visible line for the split view from the chunker's span at its
	// start (not a prefix re-sniff). Non-diff lines fall back to full-width.
	const classifyLine = (lineStart: number): DiffLineKind => {
		switch (spanKindAt(lineStart)) {
			case 'diff-remove': {
				return 'removed';
			}

			case 'diff-add': {
				return 'added';
			}

			case 'diff-context': {
				return 'context';
			}

			case 'diff-header':
			case 'diff-metadata': {
				return 'meta';
			}

			default: {
				return 'context';
			}
		}
	};

	// Split view. The typeable side (added `+`) goes on the LEFT so it stays in
	// the same column as full-width rows and non-split chunks — the cursor never
	// hops sideways. Both sides truncate to their column (no wrap), so each diff
	// row is exactly one terminal row and the columns stay aligned. The typed
	// column scrolls with the cursor; the reference column shows from its start
	// (you don't type it, so there's no cursor to follow).
	const renderSplitView = () => {
		const diffLines: DiffLine[] = visibleLines.map(({line, start}) => ({
			text: line,
			start,
			kind: classifyLine(start),
		}));

		return splitDiffRows(diffLines).map(row => {
			if (row.kind === 'full') {
				return (
					<Text key={row.line.start} wrap="truncate">
						{renderTypeableLine(
							row.line.text,
							row.line.start,
							colOffset,
							usableColumns,
						)}
					</Text>
				);
			}

			const {added, removed} = row;
			// A split row always has at least one side (splitDiffRows pads, never
			// emits an empty row), so the present line's start is a stable key.
			return (
				<Box key={(added ?? removed)!.start} flexDirection="row">
					{/* Typed column gets the larger share — it's the protagonist and
					    suffers the most from a half-width column; reference truncates. */}
					<Box width={typedColumnWidth}>
						<Text wrap="truncate">
							{added
								? renderTypeableLine(
										added.text,
										added.start,
										colOffset,
										typedColumnWidth,
								  )
								: ' '}
						</Text>
					</Box>
					{/* Reference is display-only (uniformly dim red, never the cursor), so
					    it's one truncating <Text> rather than per-char — Ink adds the `…`.
					    Tabs are expanded to spaces (expandTabs) so Ink's truncate, which
					    measures with string-width, doesn't undercount a tab and overflow the
					    column; CJK/emoji pass through and string-width measures them right. */}
					<Box width={referenceColumnWidth}>
						<Text dimColor color="red" wrap="truncate">
							{removed ? expandTabs(removed.text) : ' '}
						</Text>
					</Box>
				</Box>
			);
		});
	};

	// Only hint at the keys while there's somewhere to skip to and the run hasn't
	// begun — skipping resets, so it's a before-you-start move. It then steps out
	// of the way once typing is underway.
	const showSkipHint = keystrokes.length === 0 && chunks.length > 1;
	const done = endedAt !== undefined;

	// On completion, swap the racer for a results panel: slowest and most-mistyped
	// words from a second fold over the keystroke log (review.ts).
	const renderResults = () => {
		const stats = analyzeByWord(text, typeableIndices, state.events);
		const slow = slowestWords(stats, 3);
		const missed = mostMistypedWords(stats, 3);
		return (
			<Box flexDirection="column">
				<Text>
					<Text bold color="green">
						Done!
					</Text>
					{`  ${liveWpm} WPM · ${accuracy}% accuracy`}
				</Text>
				{slow.length > 0 && (
					<Box flexDirection="column" marginTop={1}>
						<Text dimColor>Slowest</Text>
						{slow.map(stat => (
							<Text key={stat.start} wrap="truncate">
								{`  ${stat.word} — ${Math.round(
									stat.totalMs / stat.typeableCount,
								)}ms/char`}
							</Text>
						))}
					</Box>
				)}
				{missed.length > 0 && (
					<Box flexDirection="column" marginTop={1}>
						<Text dimColor>Mistyped most</Text>
						{missed.map(stat => (
							<Text key={stat.start} wrap="truncate">
								{`  ${stat.word} — ${stat.wrong} wrong`}
							</Text>
						))}
					</Box>
				)}
				{slow.length === 0 && missed.length === 0 && (
					<Text dimColor>Clean run.</Text>
				)}
			</Box>
		);
	};

	const renderBody = () => {
		if (done) return renderResults();
		return isSplit ? renderSplitView() : renderUnifiedView();
	};

	return (
		// Width={usableColumns} keeps the whole frame — including the full-width
		// footer border — one column short of the terminal, so nothing lands in the
		// last cell and auto-wraps.
		<Box flexDirection="column" width={usableColumns}>
			{renderBody()}
			<Box
				borderTop
				borderStyle="single"
				borderBottom={false}
				borderLeft={false}
				borderRight={false}
			>
				{/* truncate so the footer is always one line: if it wraps, the frame
				    grows past the rows we reserved for it and overflows the terminal. */}
				<Text dimColor wrap="truncate">
					{done ? (
						'Esc retype · Ctrl+C quit'
					) : (
						<>
							{chunkPos && `${chunkPos}  ·  `}
							{progress} keystrokes · {liveWpm} WPM · {accuracy}% accuracy
							{showSkipHint && '  ·  ⇥/⇧⇥ skip chunk'}
						</>
					)}
				</Text>
			</Box>
		</Box>
	);
}

// Live terminal size. Ink reads the dimensions once at startup, but the window
// can be resized mid-session; without tracking that, the layout keeps drawing at
// the old size and rows wrap past the (now narrower) edge — which makes Ink
// stack frames and flicker. useStdout hands us the output stream; we read its
// columns/rows and re-read on every 'resize' event so the viewport follows the
// window. useEffect's cleanup removes the listener when App unmounts.
function useTerminalSize() {
	const {stdout} = useStdout();
	const [size, setSize] = useState({
		columns: stdout.columns ?? 80,
		rows: stdout.rows ?? 24,
	});
	useEffect(() => {
		const onResize = () => {
			setSize({columns: stdout.columns ?? 80, rows: stdout.rows ?? 24});
		};

		stdout.on('resize', onResize);
		return () => {
			stdout.off('resize', onResize);
		};
	}, [stdout]);
	return size;
}

export default function App({text, chunker, isSplit}: Props) {
	// The viewport follows the live terminal so a resize never leaves rows drawn
	// wider or taller than the window (which would wrap and flicker).
	const {columns: viewportColumns, rows: viewportLineBudget} =
		useTerminalSize();

	// Source-level work, done once (text/chunker are stable for a session): split
	// into chunks, then derive every typeable position over the whole text.
	const chunks = useMemo(() => chunker(text), [text, chunker]);
	const allTypeableIndices = useMemo(
		() => computeTypeableIndices(text, chunks),
		[text, chunks],
	);

	// The scope: which chunk the run starts on. Tab/Shift+Tab move it; the run
	// always covers that chunk through end-of-text. useState gives us a value that
	// survives re-renders and, when set, triggers one — unlike a plain variable.
	const [startChunkIdx, setStartChunkIdx] = useState(0);

	// Skip relative to the chunk the cursor is currently in (passed up from Racer),
	// not the last skip anchor — so after typing forward into later chunks, Tab
	// advances from where you are instead of jumping back. Clamped to a real chunk
	// (and an unchanged value bails out of the re-render / remount).
	const skipForward = (fromChunkIdx: number) => {
		setStartChunkIdx(Math.min(fromChunkIdx + 1, chunks.length - 1));
	};

	const skipBack = (fromChunkIdx: number) => {
		setStartChunkIdx(Math.max(fromChunkIdx - 1, 0));
	};

	// Re-scoped to the start chunk; Racer types over exactly this set.
	const typeableIndices = useMemo(
		() => typeableIndicesFromChunk(allTypeableIndices, chunks, startChunkIdx),
		[allTypeableIndices, chunks, startChunkIdx],
	);

	// Key={startChunkIdx}: changing the key tells React this is a *different*
	// Racer, so it unmounts the old one and mounts a fresh instance — the engine's
	// lazy initializer re-runs over the new scope, clearing keystrokes and timing.
	// This is the idiomatic React way to reset all of a child's state on identity
	// change, and it keeps the engine itself free of any "rescope" action.
	return (
		<Racer
			key={startChunkIdx}
			text={text}
			chunks={chunks}
			typeableIndices={typeableIndices}
			viewportLineBudget={viewportLineBudget}
			viewportColumns={viewportColumns}
			isSplit={isSplit}
			onSkipForward={skipForward}
			onSkipBack={skipBack}
		/>
	);
}
