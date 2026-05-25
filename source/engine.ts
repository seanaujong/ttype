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
