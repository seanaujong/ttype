import test from 'ava';
import {type Action} from './engine.js';
import {
	analyzeByWord,
	clozeBlanks,
	mostMistypedWords,
	slowestWords,
} from './review.js';

const typeChar = (char: string, at: number): Action => ({
	kind: 'TYPE_CHAR',
	char,
	at,
});
const backspace: Action = {kind: 'BACKSPACE'};

// "ab cd" with all five positions typeable (the space included). The user
// fumbles "ab" but corrects it (no final error), pauses 600ms before "cd", and
// ends "cd" with an uncorrected wrong char.
const text = 'ab cd';
const typeable = [0, 1, 2, 3, 4];
const events: Action[] = [
	typeChar('a', 100),
	typeChar('x', 200), // Wrong (expected b)
	backspace,
	typeChar('b', 300), // Corrected
	typeChar(' ', 350),
	typeChar('c', 950), // 600ms pause → cd is slow
	typeChar('z', 1000), // Wrong (expected d), left uncorrected
];

test('analyzeByWord: buckets timing and accuracy per word', t => {
	const stats = analyzeByWord(text, typeable, events);
	t.is(stats.length, 2);

	const ab = stats.find(stat => stat.word === 'ab')!;
	const cd = stats.find(stat => stat.word === 'cd')!;

	// "ab": the corrected mistake doesn't count against accuracy (lenient), but the
	// time fumbling it does (100 + 100ms).
	t.is(ab.start, 0);
	t.is(ab.typeableCount, 2);
	t.is(ab.correct, 2);
	t.is(ab.wrong, 0);
	t.is(ab.totalMs, 200);

	// "cd": the 600ms pause and the final keystroke land here; one uncorrected wrong.
	t.is(cd.typeableCount, 2);
	t.is(cd.correct, 1);
	t.is(cd.wrong, 1);
	t.is(cd.totalMs, 650);
});

test('slowestWords ranks by time-per-char; mostMistypedWords by wrong count', t => {
	const stats = analyzeByWord(text, typeable, events);
	t.deepEqual(
		slowestWords(stats, 1).map(stat => stat.word),
		['cd'], // 325 vs 100 ms/char
	);
	t.deepEqual(
		mostMistypedWords(stats, 5).map(stat => stat.word),
		['cd'], // The only word with a final wrong
	);
});

test('analyzeByWord: a clean run has no wrong keystrokes', t => {
	const stats = analyzeByWord(
		'go',
		[0, 1],
		[typeChar('g', 0), typeChar('o', 50)],
	);
	t.is(stats.length, 1);
	t.is(stats[0]!.correct, 2);
	t.is(stats[0]!.wrong, 0);
	t.deepEqual(mostMistypedWords(stats, 3), []);
});

test('clozeBlanks: selects the fumbled word, leaving the rest as context', t => {
	const stats = analyzeByWord(text, typeable, events);
	// "cd" is both the slowest (325 vs 100 ms/char) and the only mistyped word.
	const positions = clozeBlanks(typeable, stats, {slow: 1, mistyped: 1});
	t.deepEqual(positions, [3, 4]); // The two positions inside "cd".
	t.false(positions.includes(2)); // The inter-word space stays context.
});

test('clozeBlanks: unions slow + mistyped, deduped, ascending', t => {
	const stats = analyzeByWord(text, typeable, events);
	// Generous limits: both words qualify as slow; "cd" is also mistyped but is
	// chosen once. The space (pos 2) is in neither word's range.
	const positions = clozeBlanks(typeable, stats);
	t.deepEqual(positions, [0, 1, 3, 4]);
});

test('clozeBlanks: nothing to re-drill yields an empty list', t => {
	// No keystrokes → no timing and no errors → no word qualifies as slow or
	// mistyped, so there is nothing to blank.
	const stats = analyzeByWord('go ahead', [0, 1, 3, 4, 5, 6, 7], []);
	const positions = clozeBlanks([0, 1, 3, 4, 5, 6, 7], stats);
	t.is(positions.length, 0);
});
