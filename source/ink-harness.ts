// A tiny test harness for driving the ttype Ink app the way a real terminal
// would: render <App>, feed it keystrokes, resize the "window", and read back the
// frame Ink painted. It exists because `ink-testing-library@3` and the installed
// `ink@4` disagree about how input and size reach the app, and every rendering
// test was re-inventing the same shim. Centralizing it here makes a new rendering
// test a few lines and keeps the frame-fits guard (viewport.test.ts) extensible.
// Test-only — never imported by the CLI. See memory ink-testing-harness.
//
// Named `ink-harness.ts`, not `test-harness.ts`, on purpose: ava's default test
// glob includes `test-*`, so a `test-*` file would be picked up and run as an
// (empty) test file.

import {render} from 'ink-testing-library';
import React from 'react';
import App from './app.js';

// The app's own prop type, derived from the component so it can never drift from
// what App actually accepts. `React.ComponentProps<typeof App>` reads the props
// straight off App's signature — the React/TS way to say "whatever App takes"
// without re-declaring (and then having to re-maintain) the shape here.
export type AppProps = React.ComponentProps<typeof App>;

// The byte sequences ink@4 decodes into key events (verified against
// node_modules/ink/build/parse-keypress.js). A real terminal sends these in raw
// mode; the mock stdin doesn't, so the harness sends them itself.
const enterBytes = '\r'; // → key.return
const tabBytes = '\t'; // → key.tab
const shiftTabBytes = '\u001B[Z'; // CSI Z → key.tab + key.shift
const escapeBytes = '\u001B'; // → key.escape
const backspaceBytes = '\u007F'; // DEL → key.delete, which App coalesces with backspace

export type RenderedApp = {
	// The current frame split into rows — the unit the frame-fits invariant checks.
	frameLines: () => string[];
	// The raw current frame (rows joined by newlines), or '' before the first paint.
	lastFrame: () => string;
	// The terminal size the app currently sees; updated by resize().
	terminal: {readonly rows: number; readonly columns: number};
	// Send raw input bytes as one keypress.
	press: (bytes: string) => Promise<void>;
	// Type text, one keypress per code point.
	type: (text: string) => Promise<void>;
	pressEnter: () => Promise<void>;
	pressTab: () => Promise<void>;
	pressShiftTab: () => Promise<void>;
	pressBackspace: () => Promise<void>;
	pressEscape: () => Promise<void>;
	// Resize the terminal and notify the app (fires its 'resize' listener).
	resize: (size: {columns?: number; rows?: number}) => Promise<void>;
	// Wait one tick for pending React effects / re-renders to flush.
	tick: () => Promise<void>;
	unmount: () => void;
};

// Just the bits of the mock stdin/stdout the harness touches. The testing library
// ships them loosely typed, so we narrow to the surface we bridge to ink@4. read()
// returns null (not undefined) when empty: ink drains with `while (read() !== null)`,
// so undefined would never terminate the loop.
type MockStdin = {
	emit: (event: string) => boolean;
	ref?: () => void;
	unref?: () => void;
	// eslint-disable-next-line @typescript-eslint/ban-types -- ink's read-drain loop terminates on null, not undefined
	read?: () => string | null;
};

type MockStdout = {
	emit: (event: string) => boolean;
	columns?: number;
	rows?: number;
};

export function renderApp(
	props: AppProps,
	options: {tickMs?: number} = {},
): RenderedApp {
	const tickMs = options.tickMs ?? 60;
	const {lastFrame, stdin, stdout, unmount} = render(
		React.createElement(App, props),
	);

	const inputStdin = stdin as unknown as MockStdin;
	const sizedStdout = stdout as unknown as MockStdout;

	// Shim 1: ref/unref. Ink calls stdin.ref() when it enables raw mode (useInput's
	// first effect); the mock TTY has neither, so that effect would throw. `??=`
	// assigns only when the property is null/undefined, so a real stdin is untouched.
	inputStdin.ref ??= () => undefined;
	inputStdin.unref ??= () => undefined;

	// Shim 2: a read()/'readable' bridge. Ink@4 reads input by attaching a
	// 'readable' listener and draining stdin.read() until it returns null. The mock
	// only emits 'data' (which ink ignores), so we queue bytes and feed them through
	// read() + a 'readable' emit instead.
	const inputQueue: string[] = [];
	inputStdin.read = () => inputQueue.shift() ?? null;
	const sendInput = (bytes: string) => {
		inputQueue.push(bytes);
		inputStdin.emit('readable');
	};

	// The size the app sees. Starts from the mock (columns 100; no rows, so App's
	// useTerminalSize falls back to 24). resize() updates these and re-fires the
	// 'resize' event the hook listens for.
	let columns = sizedStdout.columns ?? 80;
	let rows = sizedStdout.rows ?? 24;

	const delay = async (ms: number) =>
		new Promise<void>(resolve => {
			setTimeout(resolve, ms);
		});

	// Effects — the raw-mode setup, the input listener, the resize listener — run
	// after the first commit, not during render(). So before the first keypress or
	// resize we let one tick pass for those listeners to attach. `ready` is that
	// one-time settle, created lazily so frame-only tests never start a timer;
	// awaiting it again after it resolves is instant.
	let ready: Promise<void> | undefined;
	const settle = async (act: () => void) => {
		ready ??= delay(tickMs); // Listeners attach on the first tick after render
		await ready;
		act();
		await delay(tickMs); // Re-render flushes → the frame is current
	};

	const press = async (bytes: string) =>
		settle(() => {
			sendInput(bytes);
		});

	const type = async (text: string) => {
		for (const char of text) {
			// eslint-disable-next-line no-await-in-loop -- keystrokes must apply in order, each flushed before the next
			await press(char);
		}
	};

	const resize = async (size: {columns?: number; rows?: number}) =>
		settle(() => {
			if (size.columns !== undefined) columns = size.columns;
			if (size.rows !== undefined) rows = size.rows;
			Object.defineProperty(sizedStdout, 'columns', {
				configurable: true,
				get: () => columns,
			});
			Object.defineProperty(sizedStdout, 'rows', {
				configurable: true,
				get: () => rows,
			});
			sizedStdout.emit('resize');
		});

	return {
		frameLines: () => (lastFrame() ?? '').split('\n'),
		lastFrame: () => lastFrame() ?? '',
		get terminal() {
			return {rows, columns};
		},
		press,
		type,
		pressEnter: async () => press(enterBytes),
		pressTab: async () => press(tabBytes),
		pressShiftTab: async () => press(shiftTabBytes),
		pressBackspace: async () => press(backspaceBytes),
		pressEscape: async () => press(escapeBytes),
		resize,
		tick: async () => delay(tickMs),
		unmount,
	};
}
