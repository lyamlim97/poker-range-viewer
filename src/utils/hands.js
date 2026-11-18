export const RANKS = "AKQJT98765432";

// Hand shown at a grid position: pairs on the diagonal, suited above, offsuit below.
export function handAt(row, col) {
	if (row === col) return RANKS[row] + RANKS[col];
	if (col > row) return RANKS[row] + RANKS[col] + "s";
	return RANKS[col] + RANKS[row] + "o";
}

export function getHandType(hand) {
	if (hand.length === 2) return "pair";
	return hand.endsWith("s") ? "suited" : "offsuit";
}

const COMBO_COUNTS = { pair: 6, suited: 4, offsuit: 12 };

export function comboCount(hand) {
	return COMBO_COUNTS[getHandType(hand)];
}
