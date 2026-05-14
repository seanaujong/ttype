import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';

const sampleText = 'The quick brown fox jumps over the lazy dog.';

export default function App() {
	const [keystrokes, setKeystrokes] = useState<string[]>([]);

	useInput((input, key) => {
		if (key.backspace || key.delete) {
			setKeystrokes(prev => prev.slice(0, -1));
		} else if (input && keystrokes.length < sampleText.length) {
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
		</Box>
	);
}
