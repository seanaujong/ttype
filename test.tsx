import React from 'react';
import test from 'ava';
import {render} from 'ink-testing-library';
import App from './source/app.js';

test('Show text', t => {
	const {lastFrame} = render(<App />);

	t.is(lastFrame(), `The quick brown fox jumps over the lazy dog.`);
});
