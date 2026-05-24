import {Box, Text, useInput} from 'ink';
import React, {useMemo, useReducer} from 'react';
import {initialState, reducer} from './engine.js';

type Props = {
	readonly text: string;
};

export default function App({text: initialText}: Props) {
	const [state, dispatch] = useReducer(reducer, initialState(initialText));
	const {text, keystrokes, startedAt, endedAt} = state;

	// Recomputed only when text changes. Re-running this loop on every keystroke
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

	const cursorLine = text.slice(0, keystrokes.length).split('\n').length - 1;

	const viewportLines = 10;
	const half = Math.floor(viewportLines / 2);

	// The viewport should slide with the cursor.
	// The cursor should mostly be in the middle, except at the beginning and end of the text.
	const startFromCenter = cursorLine - half;
	const startForBottomEdge = lineRows.length - viewportLines;
	const startLine = Math.max(0, Math.min(startFromCenter, startForBottomEdge));
	const endLine = Math.min(lineRows.length, startLine + viewportLines);

	const isDone = keystrokes.length === text.length;

	const elapsedMinutes =
		startedAt !== undefined && endedAt !== undefined
			? (endedAt - startedAt) / 1000 / 60
			: 0;

	// Standard WPM convention: "word" = 5 chars (used by every type racer)
	const wpm =
		elapsedMinutes > 0 ? Math.round(text.length / 5 / elapsedMinutes) : 0;

	// Lenient accuracy (per docs/typing-feel.md): compare final state, not history
	const correctChars = keystrokes.filter((char, i) => char === text[i]).length;
	const accuracy = Math.round((correctChars / text.length) * 100);

	const isCursor = (i: number) => i === keystrokes.length;

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

	const colorFor = (i: number) =>
		i >= keystrokes.length
			? undefined
			: keystrokes[i] === text[i]
			? 'green'
			: 'red';

	return (
		<Box flexDirection="column">
			{lineRows.slice(startLine, endLine).map(({line, start}, i) => {
				const lineIndex = startLine + i;
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
					</Text>
				);
			})}
			<Text>
				Typed: {keystrokes.length} / {text.length}
			</Text>
			{isDone && (
				<Text>
					WPM: {wpm} Accuracy: {accuracy}%
				</Text>
			)}
		</Box>
	);
}
