export type State = {
	text: string;
	keystrokes: string[];
	startedAt: number | undefined;
	endedAt: number | undefined;
};

export type Action =
	| {kind: 'TYPE_CHAR'; char: string; at: number}
	| {kind: 'BACKSPACE'}
	| {kind: 'RESET'};

export function initialState(text: string): State {
	return {
		text,
		keystrokes: [],
		startedAt: undefined,
		endedAt: undefined,
	};
}

export function reducer(state: State, action: Action): State {
	switch (action.kind) {
		case 'TYPE_CHAR': {
			if (state.keystrokes.length >= state.text.length) {
				// Cap reached; no-op, return same state
				return state;
			}

			const nextKeystrokes = [...state.keystrokes, action.char];
			return {
				...state,
				keystrokes: nextKeystrokes,
				startedAt: state.startedAt ?? action.at,
				endedAt:
					nextKeystrokes.length === state.text.length
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
