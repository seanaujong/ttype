export type State = {
	text: string;
	typeableIndices: readonly number[];
	keystrokes: string[];
	startedAt: number | undefined;
	endedAt: number | undefined;
};

export type Action =
	| {kind: 'TYPE_CHAR'; char: string; at: number}
	| {kind: 'BACKSPACE'}
	| {kind: 'RESET'};

export type Fixture = {
	name: string;
	text: string;
	events: Action[];
	expected: Partial<State>;
};

export function initialState(text: string): State {
	return {
		text,
		typeableIndices: computeTypeableIndices(text),
		keystrokes: [],
		startedAt: undefined,
		endedAt: undefined,
	};
}

function computeTypeableIndices(text: string): readonly number[] {
	const indices: number[] = [];
	let pos = 0;
	const lines = text.split('\n');

	// The last line worth advancing to. Used downstream to decide whether a
	// trailing newline is typeable — it only is if non-blank content still
	// follows.
	const lastNonBlankIdx = lines.findLastIndex(line => line.trim() !== '');

	for (const [lineIdx, line] of lines.entries()) {
		// Skip blank lines
		if (line.trim() === '') {
			pos += line.length + 1;
			continue;
		}

		// Skip leading whitespace by
		// finding the first non-leading-whitespace char in this line, if any
		const firstContent = line.search(/[^ \t]/);
		if (firstContent !== -1) {
			for (let i = firstContent; i < line.length; i++) {
				indices.push(pos + i);
			}
		}

		// Push the trailing newline only if a non-blank line still follows.
		// Otherwise the user has nowhere to advance to via Enter.
		if (lineIdx < lastNonBlankIdx) {
			indices.push(pos + line.length);
		}

		pos += line.length + 1; // +1 for the \n that split() consumed
	}

	return indices;
}

export function reducer(state: State, action: Action): State {
	switch (action.kind) {
		case 'TYPE_CHAR': {
			if (state.keystrokes.length >= state.typeableIndices.length) {
				// Cap reached; no-op, return same state
				return state;
			}

			const nextKeystrokes = [...state.keystrokes, action.char];
			return {
				...state,
				keystrokes: nextKeystrokes,
				startedAt: state.startedAt ?? action.at,
				endedAt:
					nextKeystrokes.length === state.typeableIndices.length
						? action.at
						: state.endedAt,
			};
		}

		case 'BACKSPACE': {
			return {
				...state,
				keystrokes: state.keystrokes.slice(0, -1),
			};
		}

		case 'RESET': {
			return initialState(state.text);
		}

		default: {
			action satisfies never;
			return state;
		}
	}
}

export function replay(text: string, events: Action[]): State {
	return events.reduce(reducer, initialState(text));
}
