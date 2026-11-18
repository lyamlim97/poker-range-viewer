import { createContext } from "react";
import {
	getCombosForHand,
	parseDetailedRange,
	parseRange,
	RANKS,
} from "./parseRange";
import { getActionLabel, getOrderedActions } from "./actionHelpers";

// A hand can be off by this much (1%) before it counts as wrong,
// so splits like 33.3 + 33.3 + 33.3 still pass.
const TOLERANCE = 0.01;

// Holds the ids of every spot with a problem, e.g. "RFI > EP". Buttons read it.
export const FlaggedContext = createContext(new Set());

// Add up one hand's actions. Over 100% or under 100% is wrong.
// A hand in no action at all (0%) is just "not in range", so it is not flagged.
function checkHand(actions) {
	const total = Object.values(actions).reduce((sum, f) => sum + f, 0);
	let status = null;
	if (total > 1 + TOLERANCE) status = "over";
	else if (total > 0 && total < 1 - TOLERANCE) status = "under";
	return { total, status };
}

function checkHandAgainstRange(
	hand,
	actionsByCombo,
	referenceByCombo
) {
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
		const referenceActions = referenceByCombo[id] || {};
		const referenceTotal = Object.values(referenceActions).reduce(
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

function handAt(row, col) {
	if (row === col) return RANKS[row] + RANKS[col];
	if (col > row) return RANKS[row] + RANKS[col] + "s";
	return RANKS[col] + RANKS[row] + "o";
}

function getSolutionNodes(solution) {
	const nodes = solution?.nodes || solution?.tree?.nodes;
	if (Array.isArray(nodes)) {
		return Object.fromEntries(
			nodes.filter((node) => node?.nodeId).map((node) => [node.nodeId, node])
		);
	}
	return nodes && typeof nodes === "object" ? nodes : {};
}

function getActionRange(action, node) {
	if (typeof action?.rawRangeText === "string") return action.rawRangeText;
	for (const key of [getActionLabel(action), action?.id]) {
		if (typeof key === "string" && typeof node?.strategy?.[key] === "string") {
			return node.strategy[key];
		}
	}
	return null;
}

function actionMatchesToken(action, token) {
	const label = getActionLabel(action);
	if (token === "F") return /^fold\b/i.test(label);
	if (token === "C") return /^call\b/i.test(label);
	if (token === "X") return /^check\b/i.test(label);
	if (token === "AI") return /^all[\s-]?in\b|^jam\b/i.test(label);
	if (token === "SQZ") return /^squeeze\b/i.test(label);
	if (/^RFI$/i.test(token)) return /^raise\b|^open\b/i.test(label);
	const bet = token.match(/^(\d+)B$/i);
	return bet ? new RegExp(`^${bet[1]}[ -]?bet\\b|^raise\\b`, "i").test(label) : false;
}

function normalizeActionHistory(actionHistory) {
	if (Array.isArray(actionHistory)) {
		return actionHistory
			.filter((event) => event?.position && event?.action)
			.map((event) => ({
				position: event.position,
				action: String(event.action),
			}));
	}
	const positionOrder = ["EP", "MP", "CO", "BU", "SB", "BB"];
	return positionOrder
		.filter((position) => actionHistory?.[position])
		.map((position) => ({
			position,
			action: String(actionHistory[position]),
		}));
}

export function getPositionRangeReference(
	solution,
	{ nodeId = null, actionHistory = null, position = null } = {}
) {
	const nodes = getSolutionNodes(solution);
	if (actionHistory != null) {
		if (!position) return null;
		const rootNodeId = solution?.rootNodeId || solution?.tree?.root;
		let node = rootNodeId ? nodes[rootNodeId] : null;
		let previous = null;
		for (const event of normalizeActionHistory(actionHistory)) {
			if (!node) break;
			const nodePosition =
				node.position || node.nodeId?.split("_").pop();
			if (nodePosition && nodePosition !== event.position) break;
			const action = getOrderedActions(
				Array.isArray(node.actions) ? node.actions : []
			).map(({ action: item }) => item).find((item) =>
				getActionLabel(item) === event.action ||
				(typeof item === "object" && item.id === event.action)
			);
			if (!action) break;
			if (event.position === position) {
				const range = getActionRange(action, node);
				if (typeof range === "string") {
					previous = {
						action: getActionLabel(action),
						range,
					};
				}
			}
			const target =
				typeof action === "object" && typeof action.nextNodeId === "string"
					&& action.nextNodeId.trim()
					? action.nextNodeId
					: node.next?.[getActionLabel(action)] ??
					  node.next?.[action.id] ??
					  node.children?.[getActionLabel(action)] ??
					  node.children?.[action.id];
			node = typeof target === "string" ? nodes[target] : null;
		}
		return previous;
	}
	if (!nodeId) return null;
	const targetNode = nodes[nodeId];
	const targetPosition =
		position || targetNode?.position || nodeId.split("_").pop();

	const parts = nodeId.split("_");
	let previous = null;
	for (let index = 0; index + 2 < parts.length; index += 2) {
		const sourcePosition = parts[index];
		const actionToken = parts[index + 1];
		if (sourcePosition !== targetPosition) continue;

		const sourceNodeId =
			index === 0 ? sourcePosition : parts.slice(0, index + 1).join("_");
		const sourceNode = nodes[sourceNodeId];
		if (!sourceNode) continue;
		const action = getOrderedActions(
			Array.isArray(sourceNode.actions) ? sourceNode.actions : []
		).map(({ action: item }) => item).find((item) =>
			actionMatchesToken(item, actionToken)
		);
		if (!action) continue;
		const range = getActionRange(action, sourceNode);
		if (typeof range === "string") {
			previous = {
				action: getActionLabel(action),
				range,
			};
		}
	}
	return previous;
}

function getNodeRangeData(node) {
	const strategy = {};
	const actions = Array.isArray(node?.actions) ? node.actions : [];
	for (const { action } of getOrderedActions(actions)) {
		const label = getActionLabel(action);
		const range = getActionRange(action, node);
		if (typeof range !== "string" || !range.trim()) continue;
		strategy[label] = range;
	}
	return parseDetailedRange(strategy);
}

export function checkNodeRangeConsistency(solution, nodeId) {
	const nodes = getSolutionNodes(solution);
	const node = nodes[nodeId];
	if (!node || node.terminal === true) return null;
	const actions = Array.isArray(node.actions) ? node.actions : [];
	if (actions.length === 0) return null;

	const rangeData = getNodeRangeData(node);
	const previous = getPositionRangeReference(solution, {
		nodeId,
		position: node.position,
	});
	if (!previous?.range?.trim()) {
		const check = checkRangeConsistency({ freq: rangeData.freq });
		return {
			kind: "100",
			rangeData,
			empty: check.empty,
			over: check.over,
			under: check.under,
		};
	}
	if (Object.keys(rangeData.comboFreq).length === 0) {
		return {
			kind: "unavailable",
			rangeData,
			reason: "No ranges entered for this node",
		};
	}

	const reference = parseDetailedRange(previous.range);
	if (Object.keys(reference.comboFreq).length === 0) {
		return {
			kind: "unavailable",
			rangeData,
			reason: "The previous range is empty",
		};
	}
	const check = checkRangeConsistency({
		comboFreq: rangeData.comboFreq,
		referenceComboFreq: reference.comboFreq,
	});
	return {
		kind: "previous",
		rangeData,
		previous,
		over: check.over,
		under: check.under,
		mismatch: check.mismatch,
	};
}

// The single range-consistency check used by Range Viewer and the DAG.
export function checkRangeConsistency({
	hand = null,
	freq = {},
	comboFreq = {},
	referenceComboFreq = null,
} = {}) {
	if (hand) {
		return referenceComboFreq
			? checkHandAgainstRange(
					hand,
					comboFreq,
					referenceComboFreq
				)
			: checkHand(freq);
	}

	const result = { over: [], under: [], mismatch: [] };
	if (referenceComboFreq) {
		for (let row = 0; row < RANKS.length; row += 1) {
			for (let col = 0; col < RANKS.length; col += 1) {
				const currentHand = handAt(row, col);
				const check = checkHandAgainstRange(
					currentHand,
					comboFreq,
					referenceComboFreq
				);
				if (check.status === "over") {
					result.over.push({ hand: currentHand, total: check.total, expected: check.expected });
				} else if (check.status === "under") {
					result.under.push({ hand: currentHand, total: check.total, expected: check.expected });
				} else if (check.status === "mismatch") {
					result.mismatch.push({ hand: currentHand, total: check.total, expected: check.expected });
				}
			}
		}
		result.empty =
			Object.keys(comboFreq).length === 0 &&
			Object.keys(referenceComboFreq).length === 0;
		return result;
	}

	for (const [currentHand, actions] of Object.entries(freq)) {
		const check = checkHand(actions);
		if (check.status) result[check.status].push({
			hand: currentHand,
			total: check.total,
		});
	}
	result.empty = Object.keys(freq).length === 0;
	return result;
}

export function isRangeLeaf(node) {
	return Object.values(node).every((value) => typeof value === "string");
}

// Scan every spot in ranges.json. Returns the ids of the ones with a problem.
export function findFlaggedSpots(node, path = [], found = new Set()) {
	if (isRangeLeaf(node)) {
		const { over, under } = checkRangeConsistency({ freq: parseRange(node) });
		if (over.length || under.length) found.add(path.join(" > "));
		return found;
	}

	for (const [key, child] of Object.entries(node)) {
		findFlaggedSpots(child, [...path, key], found);
	}
	return found;
}
