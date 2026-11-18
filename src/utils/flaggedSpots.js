import { createContext } from "react";
import { checkRangeConsistency } from "./checkRange";
import { parseRange } from "./parseRange";

export const SPOT_SEPARATOR = " > ";

// Holds the ids of every spot with a problem, e.g. "RFI > EP". Buttons read it.
export const FlaggedContext = createContext(new Set());

export function isRangeLeaf(node) {
	return Object.values(node).every((value) => typeof value === "string");
}

// Scan every spot in ranges.json. Returns the ids of the ones with a problem.
export function findFlaggedSpots(node, path = [], found = new Set()) {
	if (isRangeLeaf(node)) {
		const { over, under } = checkRangeConsistency({ freq: parseRange(node) });
		if (over.length || under.length) found.add(path.join(SPOT_SEPARATOR));
		return found;
	}

	for (const [key, child] of Object.entries(node)) {
		findFlaggedSpots(child, [...path, key], found);
	}
	return found;
}
