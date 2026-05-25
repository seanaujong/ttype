import {Box, Text, useInput} from 'ink';
import React, {useMemo, useReducer} from 'react';
import {type Chunker} from './chunker.js';
import {initialState, reducer} from './engine.js';

type Props = {
	readonly text: string;
	readonly chunker: Chunker;
};

export default function App({text: initialText, chunker}: Props) {
	const [state, dispatch] = useReducer(reducer, initialState(initialText));
	const {text, keystrokes, typeableIndices, startedAt, endedAt} = state;

	// Recomputed only when initialText changes.
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
		return keystrokes[ki] === text[textPos] ? 'green' : 'red';
	};

	// Undefined when at the end
	const cursorPos = typeableIndices[keystrokes.length];
	const isCursor = (textPos: number) => textPos === cursorPos;

	// Recomputed only when initialText changes. Re-running this loop on every keystroke
	// is wasted work — line structure is a property of the source, not of typing
	// progress.
	const lineRows = useMemo(() => {
		const rows: Array<{line: string; start: number}> = [];
		let pos = 0;
		for (const line of text.split('\n')) {
			rows.push({line, start: pos});
			pos += line.length + 1;
		}

		return rows;
	}, [text]);

	const focusPos =
		cursorPos ?? typeableIndices[typeableIndices.length - 1] ?? 0;

	// Recomputed only when text or chunker changes
	const chunks = useMemo(() => chunker(text), [text, chunker]);
	const focusedChunk = chunks.findLast(chunk => chunk.start <= focusPos);

	const lineForPos = (pos: number) =>
		Math.max(
			0,
			lineRows.findLastIndex(row => row.start <= pos),
		);

	const chunkStartLine = focusedChunk ? lineForPos(focusedChunk.start) : 0;
	const chunkEndLine = focusedChunk
		? lineForPos(focusedChunk.end - 1) + 1
		: lineRows.length;

	const elapsedMinutes =
		startedAt !== undefined && endedAt !== undefined
			? (endedAt - startedAt) / 1000 / 60
			: 0;

	// What character was the user supposed to type at keystroke index `i`?
	// Translates from keystroke-space to text-space — the canonical lookup
	// any time keystrokes and typeableIndices need to be related, so callers
	// don't repeat the parallel-array dance.
	const expectedAt = (keystrokeIndex: number): string | undefined => {
		const pos = typeableIndices[keystrokeIndex];
		return pos === undefined ? undefined : text[pos];
	};

	// Standard WPM convention: "word" = 5 chars (used by every type racer).
	// Denominator is typeableIndices.length (chars actually typed), not
	// text.length (which includes whitespace/structure the user skipped).
	const wpm =
		elapsedMinutes > 0
			? Math.round(typeableIndices.length / 5 / elapsedMinutes)
			: 0;

	const correctChars = keystrokes.filter(
		(char, i) => char === expectedAt(i),
	).length;
	// "Of what's been typed, how much is correct?" — converges to final-state
	// accuracy when typing completes.
	const accuracy =
		keystrokes.length > 0
			? Math.round((correctChars / keystrokes.length) * 100)
			: 100;

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

	return (
		<Box flexDirection="column">
			{lineRows.slice(chunkStartLine, chunkEndLine).map(({line, start}, i) => {
				const lineIndex = chunkStartLine + i;
				return (
					<Text key={lineIndex}>
						{[...line].map((char, col) => (
							<Text
								// eslint-disable-next-line react/no-array-index-key -- per-character list within a stable line; column is the natural identity
								key={col}
								color={colorFor(start + col)}
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
