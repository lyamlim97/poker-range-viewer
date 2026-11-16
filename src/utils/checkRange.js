import { createContext } from "react";
import { getCombosForHand, parseRange } from "./parseRange";

// A hand can be off by this much (1%) before it counts as wrong,
// so splits like 33.3 + 33.3 + 33.3 still pass.
const TOLERANCE = 0.01;

// Holds the ids of every spot with a problem, e.g. "RFI > EP". Buttons read it.
export const FlaggedContext = createContext(new Set());

// Add up one hand's actions. Over 100% or under 100% is wrong.
// A hand in no action at all (0%) is just "not in range", so it is not flagged.
export function checkHand(actions) {
	const total = Object.values(actions).reduce((sum, f) => sum + f, 0);
	let status = null;
	if (total > 1 + TOLERANCE) status = "over";
	else if (total > 0 && total < 1 - TOLERANCE) status = "under";
	return { total, status };
}

export function checkHandAgainstRange(hand, actionsByCombo, referenceByCombo) {
	const combos = getCombosForHand(hand);
	let total = 0;
	let expected = 0;
	let hasOver = false;
	let hasUnder = false;

	for (const { id } of combos) {
		const comboTotal = Object.values(actionsByCombo[id] || {}).reduce(
			(sum, frequency) => sum + frequency,
			0
		);
		const referenceTotal = Object.values(referenceByCombo[id] || {}).reduce(
			(sum, frequency) => sum + frequency,
			0
		);

		total += comboTotal;
		expected += referenceTotal;
		if (comboTotal > referenceTotal + TOLERANCE) hasOver = true;
		else if (comboTotal < referenceTotal - TOLERANCE) hasUnder = true;
	}

	const comboCount = combos.length || 1;
	return {
		total: total / comboCount,
		expected: expected / comboCount,
		status: hasOver && hasUnder ? "mismatch" : hasOver ? "over" : hasUnder ? "under" : null,
	};
}

// All the wrong hands in one spot: { over: [{ hand, total }], under: [...] }
export function checkSpot(freq) {
	const result = { over: [], under: [] };
	for (const [hand, actions] of Object.entries(freq)) {
		const { total, status } = checkHand(actions);
		if (status) result[status].push({ hand, total });
	}
	return result;
}

export function isRangeLeaf(node) {
	return Object.values(node).every((value) => typeof value === "string");
}

// Scan every spot in ranges.json. Returns the ids of the ones with a problem.
export function findFlaggedSpots(node, path = [], found = new Set()) {
	if (isRangeLeaf(node)) {
		const { over, under } = checkSpot(parseRange(node));
		if (over.length || under.length) found.add(path.join(" > "));
		return found;
	}

	for (const [key, child] of Object.entries(node)) {
		findFlaggedSpots(child, [...path, key], found);
	}
	return found;
}
