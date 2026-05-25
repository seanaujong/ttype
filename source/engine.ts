// Typographic Unicode chars that have a sensible 1:1 ASCII partner on a
// standard keyboard. Keyed by the displayed char; value is the keystroke we
// accept as equivalent. The exact char is always accepted too (via the OR in
// matchesExpected), so users with a configured keyboard aren't penalized.
//
// Variable-length substitutions (e.g. `...` → `…`) intentionally don't live
// here — those would need a wider engine change. Chars with no clean 1:1
// (e.g. ellipsis) are skipped at the chunker layer via untypeableChars.
//
// A Map (not a Record) because xo's strictCamelCase rule rejects Unicode
// property names on object literals.
const keystrokeEquivalents = new Map<string, string>([
	['—', '-'], // Em dash → hyphen
	['–', '-'], // En dash → hyphen
	['“', '"'], // Left double quote → straight
	['”', '"'], // Right double quote → straight
	['‘', "'"], // Left single quote → straight
	['’', "'"], // Right single quote → straight
	[' ', ' '], // Non-breaking space → regular space
]);

// Does `typed` count as a correct keystroke for `expected`? Identity, or
// the registered ASCII partner from keystrokeEquivalents.
export function matchesExpected(
	typed: string | undefined,
	expected: string | undefined,
): boolean {
	if (typed === undefined || expected === undefined) return false;
	if (typed === expected) return true;
	return keystrokeEquivalents.get(expected) === typed;
}

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

export function initialState(
	text: string,
	typeableIndices: readonly number[],
): State {
	return {
		text,
		typeableIndices,
		keystrokes: [],
		startedAt: undefined,
		endedAt: undefined,
	};
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
			// Preserve text and typeableIndices (both functions of the source,
			// unchanged by RESET); clear keystroke/timing state.
			return {
				...state,
				keystrokes: [],
				startedAt: undefined,
				endedAt: undefined,
			};
		}

		default: {
			action satisfies never;
			return state;
		}
	}
}

export function replay(
	text: string,
	events: Action[],
	typeableIndices: readonly number[],
): State {
	return events.reduce(reducer, initialState(text, typeableIndices));
}
