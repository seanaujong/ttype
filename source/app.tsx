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
	const {lines, lineStarts} = useMemo(() => {
		const lines = text.split('\n');

		const lineStarts: number[] = [];
		let pos = 0;
		for (const line of lines) {
			lineStarts.push(pos);
			pos += line.length + 1;
		}

		return {lines, lineStarts};
	}, [text]);

	const cursorLine = text.slice(0, keystrokes.length).split('\n').length - 1;

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

	useInput((input, key) => {
		if (key.backspace || key.delete) {
			dispatch({kind: 'BACKSPACE'});
		} else if (key.escape) {
			dispatch({kind: 'RESET'});
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
			{}
			<Text>
				{[...text].map((char, i) => (
					// eslint-disable-next-line react/no-array-index-key -- list is fixed-length and never reorders; index is the natural identity
					<Text key={i} color={colorFor(i)}>
						{char}
					</Text>
				))}
			</Text>
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
