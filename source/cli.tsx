#!/usr/bin/env node
import {Buffer} from 'node:buffer';
import fs from 'node:fs';
import process from 'node:process';
import tty from 'node:tty';
import {render} from 'ink';
import meow from 'meow';
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
		return readAllStdinSync().trimEnd();
	}

	cli.showHelp(1);
	process.exit(1);
}

function readAllStdinSync(): string {
	const chunks: Buffer[] = [];
	const buffer = Buffer.alloc(65_536);
	let done = false;

	while (!done) {
		let bytesRead = 0;
		try {
			bytesRead = fs.readSync(0, buffer, 0, buffer.length, null);
		} catch (error: unknown) {
			// EAGAIN on macOS: pipe momentarily empty, try again.
			// EOF: end of stream (some Node versions throw instead of returning 0).
			const {code} = error as NodeJS.ErrnoException;
			if (code === 'EAGAIN') continue;
			if (code === 'EOF') {
				done = true;
				break;
			}

			throw error;
		}

		if (bytesRead === 0) {
			done = true;
			break;
		}

		chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
	}

	return Buffer.concat(chunks).toString('utf8');
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
