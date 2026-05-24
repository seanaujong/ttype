#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import App from './app.js';

const cli = meow(
	`
	Usage
	  $ ttype

	Examples
	  $ ttype
`,
	{
		importMeta: import.meta,
	},
);
const path = cli.input[0];

if (!path) {
	cli.showHelp(1);
	process.exit(1);
}

let text: string;
try {
	text = fs.readFileSync(path, 'utf8').trimEnd();
} catch (error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`ttype: ${message}`);
	process.exit(1);
}

render(<App text={text} />);
