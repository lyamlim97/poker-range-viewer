import {
	getCombosForHand,
	parseDetailedRange,
} from "./parseRange";
import { getOrderedActions } from "./actions";
import { RANKS, handAt } from "./hands";
import { actionMatchesToken, getNodeIdPosition, parseNodeId } from "./nodeId";
import { normalizeActionPath } from "./positions";
import {
	getActionLabel,
	getActionRange,
	getActionTarget,
	getNodeActions,
	getRootNodeId,
	getSolutionNodes,
} from "./solutionAccessors";

// A hand can be off by this much (1%) before it counts as wrong,
// so splits like 33.3 + 33.3 + 33.3 still pass.
const TOLERANCE = 0.01;

const sumFrequencies = (actions) =>
	Object.values(actions).reduce((sum, frequency) => sum + frequency, 0);

// Add up one hand's actions. Over 100% or under 100% is wrong.
// A hand in no action at all (0%) is just "not in range", so it is not flagged.
function checkHand(actions) {
	const total = sumFrequencies(actions);
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
		const comboTotal = sumFrequencies(actionsByCombo[id] || {});
		const referenceTotal = sumFrequencies(referenceByCombo[id] || {});

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

function findOrderedAction(node, predicate) {
	return getOrderedActions(getNodeActions(node))
		.map(({ action }) => action)
		.find(predicate);
}

export function getPositionRangeReference(
	solution,
	{ nodeId = null, actionHistory = null, position = null } = {}
) {
	const nodes = getSolutionNodes(solution) || {};
	if (actionHistory != null) {
		if (!position) return null;
		const rootNodeId = getRootNodeId(solution);
		let node = rootNodeId ? nodes[rootNodeId] : null;
		let previous = null;
		for (const event of normalizeActionPath(actionHistory)) {
			if (!node) break;
			const nodePosition = node.position || getNodeIdPosition(node.nodeId);
			if (nodePosition && nodePosition !== event.position) break;
			const action = findOrderedAction(
				node,
				(item) => getActionLabel(item) === event.action || item.id === event.action
			);
			if (!action) break;
			if (event.position === position) {
				const range = getActionRange(action);
				if (range !== null) {
					previous = {
						action: getActionLabel(action),
						range,
					};
				}
			}
			node = nodes[getActionTarget(action)];
		}
		return previous;
	}
	const parsed = parseNodeId(nodeId);
	if (!parsed) return null;
	const targetPosition = position || nodes[nodeId]?.position || parsed.currentPosition;

	let previous = null;
	for (const { position: sourcePosition, actionToken, sourceNodeId } of parsed.history) {
		if (sourcePosition !== targetPosition) continue;

		const sourceNode = nodes[sourceNodeId];
		if (!sourceNode) continue;
		const action = findOrderedAction(sourceNode, (item) =>
			actionMatchesToken(item, actionToken)
		);
		if (!action) continue;
		const range = getActionRange(action);
		if (range !== null) {
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
	for (const { action } of getOrderedActions(getNodeActions(node))) {
		const range = getActionRange(action);
		if (!range?.trim()) continue;
		strategy[getActionLabel(action)] = range;
	}
	return parseDetailedRange(strategy);
}

export function checkNodeRangeConsistency(solution, nodeId) {
	const node = (getSolutionNodes(solution) || {})[nodeId];
	if (!node || node.terminal === true) return null;
	if (getNodeActions(node).length === 0) return null;

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
				if (check.status) {
					result[check.status].push({
						hand: currentHand,
						total: check.total,
						expected: check.expected,
					});
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
