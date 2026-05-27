// Review — the "second fold." The engine folds the keystroke log into live
// state; this folds the same log into per-word stats (timing + accuracy) for the
// end-of-run results. Pure: no Ink, no React. The engine never learns what a
// "word" is — that lives here, derived from the text + the log (see
// docs/word-aware-engine.md, "review = second fold").

import {matchesExpected, type Action} from './engine.js';
import {clusterAt} from './grapheme.js';

export type WordStat = Readonly<{
	word: string; // The whitespace-delimited token
	start: number; // Its first UTF-16 offset (for display / future cloze)
	typeableCount: number; // Typeable positions inside it
	correct: number;
	wrong: number;
	totalMs: number; // Time attributed to typing this word
}>;

type WordRange = {word: string; start: number; end: number};

// Maximal runs of non-whitespace characters, with their source offsets.
function wordRanges(text: string): WordRange[] {
	const ranges: WordRange[] = [];
	let i = 0;
	while (i < text.length) {
		if (/\s/.test(text[i]!)) {
			i++;
			continue;
		}

		const start = i;
		while (i < text.length && !/\s/.test(text[i]!)) i++;
		ranges.push({word: text.slice(start, i), start, end: i});
	}

	return ranges;
}

export function analyzeByWord(
	text: string,
	typeableIndices: readonly number[],
	events: readonly Action[],
): readonly WordStat[] {
	const words = wordRanges(text);

	// Each cursor index → the word it belongs to (−1 for a typeable space between
	// words). Both arrays are ascending, so one forward walk maps them.
	const wordOfCursor: number[] = [];
	const typeableCount: number[] = Array.from({length: words.length}, () => 0);
	let w = 0;
	for (const pos of typeableIndices) {
		while (w < words.length && words[w]!.end <= pos) w++;
		const inWord = w < words.length && pos >= words[w]!.start;
		wordOfCursor.push(inWord ? w : -1);
		if (inWord) typeableCount[w]!++;
	}

	const totalMs: number[] = Array.from({length: words.length}, () => 0);
	const typedChar: Array<string | undefined> = Array.from(
		{length: typeableIndices.length},
		() => undefined,
	);

	// Fold the log, mirroring the engine's cursor. The gap between consecutive
	// keystrokes is charged to the word being typed (so think- and correction-time
	// both land on the word that earned them); record the last char typed at each
	// position for accuracy.
	let cursor = 0;
	let lastAt: number | undefined;
	for (const action of events) {
		switch (action.kind) {
			case 'TYPE_CHAR': {
				if (cursor < typeableIndices.length) {
					const wi = wordOfCursor[cursor]!;
					if (wi >= 0) {
						totalMs[wi]! += lastAt === undefined ? 0 : action.at - lastAt;
					}

					typedChar[cursor] = action.char;
					cursor++;
				}

				lastAt = action.at;
				break;
			}

			case 'BACKSPACE': {
				cursor = Math.max(0, cursor - 1);
				break;
			}

			case 'RESET': {
				// The engine clears RESET from the log, so this is effectively dead;
				// handle it defensively for a raw log fed straight in.
				cursor = 0;
				lastAt = undefined;
				break;
			}

			default: {
				action satisfies never;
			}
		}
	}

	// Score each typed position and bucket it into its word.
	const correct: number[] = Array.from({length: words.length}, () => 0);
	const wrong: number[] = Array.from({length: words.length}, () => 0);
	for (const [c, char] of typedChar.entries()) {
		if (char === undefined) continue;
		const wi = wordOfCursor[c]!;
		if (wi < 0) continue;
		if (matchesExpected(char, clusterAt(text, typeableIndices[c]!))) {
			correct[wi]!++;
		} else {
			wrong[wi]!++;
		}
	}

	const stats: WordStat[] = [];
	for (const [i, range] of words.entries()) {
		if (typeableCount[i]! === 0) continue; // No typeable content to score
		stats.push({
			word: range.word,
			start: range.start,
			typeableCount: typeableCount[i]!,
			correct: correct[i]!,
			wrong: wrong[i]!,
			totalMs: totalMs[i]!,
		});
	}

	return stats;
}

// Slowest first, by time-per-typeable-char (so a long word isn't "slow" merely
// for being long). Single-char tokens are excluded — their per-char time is
// noisy and they're rarely worth drilling.
export function slowestWords(
	stats: readonly WordStat[],
	n: number,
): readonly WordStat[] {
	return [...stats]
		.filter(stat => stat.typeableCount >= 2 && stat.totalMs > 0)
		.sort((a, b) => b.totalMs / b.typeableCount - a.totalMs / a.typeableCount)
		.slice(0, n);
}

// Most wrong keystrokes first, ties broken by lower accuracy.
export function mostMistypedWords(
	stats: readonly WordStat[],
	n: number,
): readonly WordStat[] {
	return [...stats]
		.filter(stat => stat.wrong > 0)
		.sort(
			(a, b) =>
				b.wrong - a.wrong ||
				a.correct / a.typeableCount - b.correct / b.typeableCount,
		)
		.slice(0, n);
}
