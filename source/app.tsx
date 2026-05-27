import {Box, Text, useInput} from 'ink';
import React, {useMemo, useReducer} from 'react';
import {
	computeTypeableIndices,
	type Chunk,
	type Chunker,
	type SpanKind,
} from './chunker.js';
import {initialState, matchesExpected, reducer} from './engine.js';
import {splitDiffRows, type DiffLine, type DiffLineKind} from './layout.js';

type Props = {
	readonly text: string;
	readonly chunker: Chunker;
	readonly viewportLineBudget: number;
	readonly isSplit: boolean; // Two-column diff view; default is the unified view
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

	const chunkStartLine = firstVisibleChunk
		? lineForPos(firstVisibleChunk.start)
		: 0;
	const chunkEndLine = lastVisibleChunk
		? lineForPos(lastVisibleChunk.end - 1) + 1
		: lineRows.length;

	// True if this text position is inside the focused chunk (for dimming logic).
	const isInFocus = (pos: number) =>
		focusedChunk !== undefined &&
		pos >= focusedChunk.start &&
		pos < focusedChunk.end;

	return {focusedChunk, chunkStartLine, chunkEndLine, isInFocus};
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
			if (matchesExpected(keystrokes[ki], text[textPos]))
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
		return pos === undefined ? undefined : text[pos];
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

export default function App({
	text: initialText,
	chunker,
	viewportLineBudget,
	isSplit,
}: Props) {
	// Top-level setup — computed once at mount (and on text/chunker change).
	// chunks feed both the engine init (for typeableIndices) and the viewport.
	const chunks = useMemo(() => chunker(initialText), [initialText, chunker]);
	const typeableIndices = useMemo(
		() => computeTypeableIndices(initialText, chunks),
		[initialText, chunks],
	);

	// UseReducer's three-arg form: lazy initializer runs once with the typeable
	// indices we computed above. Two-arg form can't see local derivations.
	const [state, dispatch] = useReducer(reducer, undefined, () =>
		initialState(initialText, typeableIndices),
	);
	const {text, keystrokes, startedAt, endedAt} = state;

	const cursorPos = typeableIndices[keystrokes.length];
	const focusPos =
		cursorPos ?? typeableIndices[typeableIndices.length - 1] ?? 0;

	const {lineRows, lineForPos} = useLineLayout(text);

	const {focusedChunk, chunkStartLine, chunkEndLine, isInFocus} =
		useChunkViewport({
			chunks,
			focusPos,
			lineRows,
			lineForPos,
			viewportLineBudget,
		});

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
		if (key.backspace || key.delete) {
			dispatch({kind: 'BACKSPACE'});
		} else if (key.escape) {
			dispatch({kind: 'RESET'});
		} else if (key.return) {
			dispatch({kind: 'TYPE_CHAR', char: '\n', at: Date.now()});
		} else if (input) {
			dispatch({kind: 'TYPE_CHAR', char: input, at: Date.now()});
		}
	});

	const visibleLines = lineRows.slice(chunkStartLine, chunkEndLine);

	// One source line's characters, shared by both views. Each char is its own
	// <Text> so color/cursor apply per position; focus-dimming folds into dimColor.
	const renderChars = (line: string, lineStart: number, lineInFocus: boolean) =>
		[...line].map((char, col) => {
			const pos = lineStart + col;
			const {color, backgroundColor, dimColor} = styleFor(pos);
			return (
				<Text
					// eslint-disable-next-line react/no-array-index-key -- per-char list within a stable line; column is the natural identity
					key={col}
					color={color}
					backgroundColor={backgroundColor}
					dimColor={!lineInFocus || dimColor}
					inverse={isCursor(pos)}
				>
					{char}
				</Text>
			);
		});

	// A typeable line: its characters plus a ↵ marker at the line's terminating
	// newline. Shown when the cursor sits there (a prompt to press Enter) or when
	// a wrong key was pressed there (an error) — a newline is whitespace, so
	// styleFor flags a mistyped one with a red background, just like a space. A
	// correctly-typed line break shows nothing. This is the only place the cursor
	// can land besides a visible char, so it's the only place the marker appears.
	const renderTypeableLine = (line: string, lineStart: number) => {
		const newlinePos = lineStart + line.length;
		const atCursor = isCursor(newlinePos);
		const {backgroundColor} = styleFor(newlinePos);
		const showMarker = atCursor || backgroundColor !== undefined;
		return (
			<>
				{renderChars(line, lineStart, isInFocus(lineStart))}
				{showMarker && (
					<Text inverse={atCursor} backgroundColor={backgroundColor}>
						{atCursor ? '↵ENTER' : '↵'}
					</Text>
				)}
			</>
		);
	};

	// Default view: one source line per row, top to bottom.
	const renderUnifiedView = () =>
		visibleLines.map(({line, start}) => (
			<Text key={start}>{renderTypeableLine(line, start)}</Text>
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
	// hops sideways. Removed lines are dim reference on the right and truncate
	// (you don't type them); the added column wraps so its content is never cut.
	const renderSplitView = () => {
		const diffLines: DiffLine[] = visibleLines.map(({line, start}) => ({
			text: line,
			start,
			kind: classifyLine(start),
		}));

		return splitDiffRows(diffLines).map(row => {
			if (row.kind === 'full') {
				return (
					<Text key={row.line.start}>
						{renderTypeableLine(row.line.text, row.line.start)}
					</Text>
				);
			}

			const {added, removed} = row;
			// A split row always has at least one side (splitDiffRows pads, never
			// emits an empty row), so the present line's start is a stable key.
			return (
				<Box key={(added ?? removed)!.start} flexDirection="row">
					{/* Typed column gets the larger share — it's the protagonist and
					    suffers the most from half-width wrapping; reference can truncate. */}
					<Box width="65%">
						<Text>
							{added ? renderTypeableLine(added.text, added.start) : ' '}
						</Text>
					</Box>
					<Box width="35%">
						<Text wrap="truncate">
							{removed
								? renderChars(
										removed.text,
										removed.start,
										isInFocus(removed.start),
								  )
								: ' '}
						</Text>
					</Box>
				</Box>
			);
		});
	};

	return (
		<Box flexDirection="column">
			{isSplit ? renderSplitView() : renderUnifiedView()}
			<Box
				borderTop
				borderStyle="single"
				borderBottom={false}
				borderLeft={false}
				borderRight={false}
			>
				<Text dimColor>
					{chunkPos && `${chunkPos}  ·  `}
					{progress} keystrokes · {liveWpm} WPM · {accuracy}% accuracy
				</Text>
			</Box>
		</Box>
	);
}
