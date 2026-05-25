#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import tty from 'node:tty';
import meow from 'meow';
import {render} from 'ink';
import React from 'react';
import App from './app.js';
import {blankLineChunker, diffChunker, type Chunker} from './chunker.js';

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

function resolveSourceText(path: string | undefined): string {
	if (path) {
		try {
			return fs.readFileSync(path, 'utf8').trimEnd();
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`ttype: ${message}`);
			process.exit(1);
		}
	}

	if (!process.stdin.isTTY) {
		return fs.readFileSync(0, 'utf8').trimEnd();
	}

	cli.showHelp(1);
	process.exit(1);
}

function selectChunker(
	path: string | undefined,
	flags: {diff?: boolean},
): Chunker {
	if (flags.diff) return diffChunker;
	if (path && ['.diff', '.patch'].some(ext => path.endsWith(ext))) {
		return diffChunker;
	}

	return blankLineChunker;
}

const chunker: Chunker = selectChunker(path, cli.flags);

const text = resolveSourceText(path);

const ttyPath = process.platform === 'win32' ? 'CONIN$' : '/dev/tty';

const interactiveStdin = process.stdin.isTTY
	? process.stdin
	: new tty.ReadStream(fs.openSync(ttyPath, 'r'));

const viewportLineBudget = process.stdout.rows;

render(
	<App text={text} chunker={chunker} viewportLineBudget={viewportLineBudget} />,
	{stdin: interactiveStdin},
);
