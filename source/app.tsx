import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';

const sampleText = 'The quick brown fox jumps over the lazy dog.';

export default function App() {
	const [keystrokes, setKeystrokes] = useState<string[]>([]);
	const [startedAt, setStartedAt] = useState<number | undefined>(undefined);
	const [endedAt, setEndedAt] = useState<number | undefined>(undefined);

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
			setKeystrokes(prev => prev.slice(0, -1));
		} else if (input && keystrokes.length < sampleText.length) {
			if (startedAt === undefined) {
				setStartedAt(Date.now());
			}

			if (keystrokes.length + 1 === sampleText.length) {
				setEndedAt(Date.now());
			}

			setKeystrokes(prev => [...prev, input]);
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
