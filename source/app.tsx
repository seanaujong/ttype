import React from 'react';
import {Text} from 'ink';

const sampleText = 'The quick brown fox jumps over the lazy dog.';

export default function App() {
	return <SampleText />;
}

function SampleText() {
	return <Text>{sampleText}</Text>;
}
