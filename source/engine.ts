export type State = {
	text: string;
	keystrokes: string[];
	startedAt: number | undefined;
	endedAt: number | undefined;
};

export type Action = {kind: 'TYPE_CHAR'; char: string} | {kind: 'BACKSPACE'};

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
				startedAt: state.startedAt ?? Date.now(),
				endedAt:
					nextKeystrokes.length === state.text.length
						? Date.now()
						: state.endedAt,
			};
		}

		case 'BACKSPACE': {
			return {
				...state,
				keystrokes: state.keystrokes.slice(0, -1),
			};
		}

		default: {
			const _exhaustive: never = action;
			return state;
		}
	}
}
