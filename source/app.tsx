import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';

const sampleText = 'The quick brown fox jumps over the lazy dog.';

export default function App() {
	const [position, setPosition] = useState(0);

	useInput((input, key) => {
		setPosition(p => p + 1);
	});

	return (
		<Box flexDirection="column">
			<Text>{sampleText}</Text>
			<Text>Position: {position}</Text>
		</Box>
	);
}
