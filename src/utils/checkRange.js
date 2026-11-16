import { createContext } from "react";
import { parseRange } from "./parseRange";

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

// All the wrong hands in one spot: { over: [{ hand, total }], under: [...] }
export function checkSpot(freq) {
	const result = { over: [], under: [] };
	for (const [hand, actions] of Object.entries(freq)) {
		const { total, status } = checkHand(actions);
		if (status) result[status].push({ hand, total });
	}
	return result;
}

// Scan every spot in ranges.json. Returns the ids of the ones with a problem.
export function findFlaggedSpots(node, path = [], found = new Set()) {
	const isLeaf = Object.values(node).every((v) => typeof v === "string");

	if (isLeaf) {
		const { over, under } = checkSpot(parseRange(node));
		if (over.length || under.length) found.add(path.join(" > "));
		return found;
	}

	for (const [key, child] of Object.entries(node)) {
		findFlaggedSpots(child, [...path, key], found);
	}
	return found;
}
