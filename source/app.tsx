import React, {useReducer} from 'react';
import {Box, Text, useInput} from 'ink';

const sampleText = 'The quick brown fox jumps over the lazy dog.';

type State = {
	keystrokes: string[];
	startedAt: number | undefined;
	endedAt: number | undefined;
};

type Action = {type: 'TYPE_CHAR'; char: string} | {type: 'BACKSPACE'};

const initialState: State = {
	keystrokes: [],
	startedAt: undefined,
	endedAt: undefined,
};

function reducer(state: State, action: Action): State {
	switch (action.type) {
		case 'TYPE_CHAR': {
			if (state.keystrokes.length >= sampleText.length) {
				// Cap reached; no-op, return same state
				return state;
			}

			const nextKeystrokes = [...state.keystrokes, action.char];
			return {
				keystrokes: nextKeystrokes,
				startedAt: state.startedAt ?? Date.now(),
				endedAt:
					nextKeystrokes.length === sampleText.length
						? Date.now()
						: state.endedAt,
			};
		}

		case 'BACKSPACE': {
			return {
				...state,
				keystrokes: state.keystrokes.slice(0, -1),
			};
		}

		default: {
			const _exhaustive: never = action;
			return state;
		}
	}
}

export default function App() {
	const [state, dispatch] = useReducer(reducer, initialState);
	const {keystrokes, startedAt, endedAt} = state;

	const isDone = keystrokes.length === sampleText.length;

	const elapsedMinutes =
		startedAt !== undefined && endedAt !== undefined
			? (endedAt - startedAt) / 1000 / 60
			: 0;

	// Standard WPM convention: "word" = 5 chars (used by every type racer)
	const wpm =
		elapsedMinutes > 0 ? Math.round(sampleText.length / 5 / elapsedMinutes) : 0;

	// Lenient accuracy (per docs/typing-feel.md): compare final state, not history
	const correctChars = keystrokes.filter(
		(char, i) => char === sampleText[i],
	).length;
	const accuracy = Math.round((correctChars / sampleText.length) * 100);

	useInput((input, key) => {
		if (key.backspace || key.delete) {
			dispatch({type: 'BACKSPACE'});
		} else if (input) {
			dispatch({type: 'TYPE_CHAR', char: input});
		}
	});

	const colorFor = (i: number) =>
		i >= keystrokes.length
			? undefined
			: keystrokes[i] === sampleText[i]
			? 'green'
			: 'red';

	return (
		<Box flexDirection="column">
			<Text>
				{[...sampleText].map((char, i) => (
					// eslint-disable-next-line react/no-array-index-key
					<Text key={i} color={colorFor(i)}>
						{char}
					</Text>
				))}
			</Text>
			<Text>
				Typed: {keystrokes.length} / {sampleText.length}
			</Text>
			{isDone && (
				<Text>
					WPM: {wpm} Accuracy: {accuracy}%
				</Text>
			)}
		</Box>
	);
}
