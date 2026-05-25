import {Box, Text, useInput} from 'ink';
import React, {useMemo, useReducer} from 'react';
import {computeTypeableIndices, type Chunk, type Chunker} from './chunker.js';
import {initialState, matchesExpected, reducer} from './engine.js';

type Props = {
	readonly text: string;
	readonly chunker: Chunker;
	readonly viewportLineBudget: number;
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

// Per-character display decisions: what color to paint each text position,
// and whether the cursor sits there.
function useCharacterStyling({
	text,
	keystrokes,
	typeableIndices,
	cursorPos,
}: {
	readonly text: string;
	readonly keystrokes: string[];
	readonly typeableIndices: readonly number[];
	readonly cursorPos: number | undefined;
}) {
	// Recomputed only when typeableIndices changes.
	const positionToKeystrokeIndex = useMemo(() => {
		const map = new Map<number, number>();
		for (const [i, pos] of typeableIndices.entries()) {
			map.set(pos, i);
		}

		return map;
	}, [typeableIndices]);

	const colorFor = (textPos: number) => {
		const ki = positionToKeystrokeIndex.get(textPos);
		if (ki === undefined) return 'gray';
		if (ki >= keystrokes.length) return undefined;
		return matchesExpected(keystrokes[ki], text[textPos]) ? 'green' : 'red';
	};

	const isCursor = (textPos: number) => textPos === cursorPos;

	return {colorFor, isCursor};
}

// Diff line decoration. Returns per-line dim hint (for metadata) and an
// optional color for the leading prefix char only — leaving the rest of the
// line to per-character typing feedback (green = correct, red = wrong)
// without competing for the same visual channel.
function diffLineStyle(line: string): {
	dimColor?: boolean;
	prefixColor?: string;
} {
	// Hunk header
	if (line.startsWith('@@')) return {dimColor: true};

	// File-level metadata (must come before '+'/'-' matches,
	// since `--- ` and `+++ ` start with - / +)
	if (line.startsWith('diff --git')) return {dimColor: true};
	if (line.startsWith('index ')) return {dimColor: true};
	if (line.startsWith('--- ')) return {dimColor: true};
	if (line.startsWith('+++ ')) return {dimColor: true};

	// Added / removed content — color only the prefix marker
	if (line.startsWith('+')) return {prefixColor: 'green'};
	if (line.startsWith('-')) return {prefixColor: 'red'};

	// Context line - default
	return {};
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

	const {colorFor, isCursor} = useCharacterStyling({
		text,
		keystrokes,
		typeableIndices,
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

	return (
		<Box flexDirection="column">
			{lineRows.slice(chunkStartLine, chunkEndLine).map(({line, start}, i) => {
				const lineIndex = chunkStartLine + i;
				const lineInFocus = isInFocus(start);
				const containingChunk = chunks.find(
					chunk => chunk.start <= start && start < chunk.end,
				);
				const diffStyle =
					containingChunk?.kind === 'diff-hunk' ? diffLineStyle(line) : {};

				return (
					<Text key={lineIndex} dimColor={!lineInFocus || diffStyle.dimColor}>
						{[...line].map((char, col) => (
							<Text
								// eslint-disable-next-line react/no-array-index-key -- per-character list within a stable line; column is the natural identity
								key={col}
								color={
									col === 0 && diffStyle.prefixColor
										? diffStyle.prefixColor
										: colorFor(start + col)
								}
								inverse={isCursor(start + col)}
							>
								{char}
							</Text>
						))}
						{isCursor(start + line.length) && <Text inverse>↵ENTER</Text>}
					</Text>
				);
			})}
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
