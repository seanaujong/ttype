import React, {useReducer} from 'react';
import {Box, Text, useInput} from 'ink';
import {initialState, reducer} from './engine.js';

const sampleText = 'The quick brown fox jumps over the lazy dog.';

export default function App() {
	const [state, dispatch] = useReducer(reducer, initialState(sampleText));
	const {text, keystrokes, startedAt, endedAt} = state;

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
		} else if (input) {
			dispatch({kind: 'TYPE_CHAR', char: input});
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
			<Text>
				{[...text].map((char, i) => (
					// eslint-disable-next-line react/no-array-index-key
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
