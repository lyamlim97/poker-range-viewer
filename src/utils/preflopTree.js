import {
	getActionAmount,
	getOrderedActions,
	isAggressive,
	isAllIn,
	isCall,
	isFold,
} from "./actions";
import { getPositionRangeReference } from "./checkRange";
import { getNodeIdPosition, parseNodeId } from "./nodeId";
import { POSITIONS, POSITION_IDS, getSeat, normalizeActionPath } from "./positions";
import {
	RARE_TAG,
	findNodeAction,
	getActionLabel,
	getActionOutcome,
	getActionTarget,
	getNodeActions,
	getNodeStrategy,
	getRootNodeId,
	getSolutionNodes,
} from "./solutionAccessors";

const EMPTY_STRATEGY = {};

function getRootFoldHistory(solutionData) {
	const parsed = parseNodeId(getRootNodeId(solutionData));
	if (!parsed || parsed.history.some(({ actionToken }) => actionToken !== "F")) return [];
	return parsed.history.map(({ position }) => ({ position, action: "Fold" }));
}

function getNodePosition(node) {
	const nodeIdPosition = getNodeIdPosition(node?.nodeId);
	const inferredPosition = POSITION_IDS.has(nodeIdPosition) ? nodeIdPosition : null;
	const declaredPosition = node?.position;
	const hasDeclaredPosition = node?.position != null;

	if (hasDeclaredPosition && !POSITION_IDS.has(declaredPosition)) {
		throw new Error(
			`Solution node "${node.nodeId}" has an invalid position "${node.position}".`
		);
	}

	if (inferredPosition && hasDeclaredPosition && inferredPosition !== declaredPosition) {
		throw new Error(
			`Solution node "${node.nodeId}" ends with ${inferredPosition}, but its position is ${declaredPosition}.`
		);
	}

	return inferredPosition || (POSITION_IDS.has(declaredPosition) ? declaredPosition : null);
}

function hasNoSavedStrategy(node) {
	return node?.strategyUnavailable === true;
}

function formatSize(size) {
	return Number(size.toFixed(1)).toString();
}

function getHandState(actionHistory = {}) {
	const path = normalizeActionPath(actionHistory);
	const folded = new Set();
	const allIn = new Set();
	const pending = new Set(POSITIONS);
	const raises = [];

	for (const { position, action } of path) {
		pending.delete(position);
		if (isFold(action)) folded.add(position);
		if (isAllIn(action)) allIn.add(position);

		const lastRaiseAmount = getActionAmount(raises[raises.length - 1]?.action);
		const currentAmount = getActionAmount(action);
		const isRaise = isAllIn(action)
			? currentAmount === null || currentAmount > (lastRaiseAmount || 0)
			: isAggressive(action);
		if (isRaise) {
			raises.push({ position, action });
			for (const id of POSITIONS) {
				if (id === position || folded.has(id) || allIn.has(id)) {
					pending.delete(id);
				} else {
					pending.add(id);
				}
			}
		}
	}

	for (const id of folded) pending.delete(id);
	for (const id of allIn) pending.delete(id);
	if (POSITIONS.filter((id) => !folded.has(id)).length <= 1) pending.clear();

	return { path, folded, allIn, pending, raises };
}

export function getActionablePositions(actionHistory = {}, solutionData = null) {
	const node = resolveTreeNode(solutionData, actionHistory);
	if (node?.terminal === true || hasNoSavedStrategy(node)) return [];

	const path = [...getRootFoldHistory(solutionData), ...normalizeActionPath(actionHistory)];
	const { pending, folded, allIn } = getHandState(path);
	return POSITIONS.filter((id) => pending.has(id) && !folded.has(id) && !allIn.has(id));
}

export function getNextPosition(actionHistory = {}, solutionData = null) {
	const node = resolveTreeNode(solutionData, actionHistory);
	if (node?.terminal === true || hasNoSavedStrategy(node)) return null;

	const nodePosition = getNodePosition(node);
	if (nodePosition) return nodePosition;

	const path = [...getRootFoldHistory(solutionData), ...normalizeActionPath(actionHistory)];
	if (path.length === 0) return "EP";

	const { pending, folded, allIn } = getHandState(path);
	const lastIndex = POSITIONS.indexOf(path[path.length - 1].position);
	for (let offset = 1; offset <= POSITIONS.length; offset++) {
		const candidate = POSITIONS[(lastIndex + offset) % POSITIONS.length];
		if (pending.has(candidate) && !folded.has(candidate) && !allIn.has(candidate)) {
			return candidate;
		}
	}
	return null;
}

function analyzeActionHistory(actionHistory = {}) {
	const { path, raises } = getHandState(actionHistory);
	const callers = path
		.filter(({ action }) => isCall(action))
		.map(({ position }) => position);

	return {
		opener: raises[0]?.position || null,
		openAction: raises[0]?.action || null,
		callers,
		threeBettor: raises[1]?.position || null,
		threeBetAction: raises[1]?.action || null,
		fourBettor: raises[2]?.position || null,
		fourBetAction: raises[2]?.action || null,
		raises,
		lastAggressor: raises[raises.length - 1] || null,
		raiseCount: raises.length,
	};
}

function resolveTreeNode(solutionData, actionHistory) {
	const nodes = getSolutionNodes(solutionData);
	const rootNodeId = getRootNodeId(solutionData);
	if (!rootNodeId || !nodes) return null;

	let node = nodes[rootNodeId];
	if (!node) return null;

	for (const event of normalizeActionPath(actionHistory)) {
		const nodePosition = getNodePosition(node);
		if (nodePosition && nodePosition !== event.position) return null;
		const option = findNodeAction(node, event.action);
		const outcome = getActionOutcome(option);
		if (outcome === "terminal") {
			node = { terminal: true, actions: [] };
			continue;
		}
		if (outcome === "rare") {
			node = {
				tags: [RARE_TAG],
				strategyUnavailable: true,
				actions: [],
			};
			continue;
		}
		node = nodes[getActionTarget(option)];
		if (!node) return null;
	}

	return node;
}

export function isActionPathValid(actionHistory, solutionData) {
	try {
		const node = resolveTreeNode(solutionData, actionHistory);
		if (!node) return false;
		getNodePosition(node);
		return true;
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("Solution node ")) {
			return false;
		}
		throw error;
	}
}

function defaultActions(position, actionHistory, openSize) {
	const { raises } = analyzeActionHistory(actionHistory);
	const lastRaise = raises[raises.length - 1];
	const allIn = "Allin 100";

	if (raises.length === 0) {
		if (position === "SB") return ["Fold", "Call", "Raise 3", allIn];
		if (position === "BB") return ["Check", `Raise ${openSize}`, allIn];
		return ["Fold", `Raise ${openSize}`, allIn];
	}

	const lastSize = getActionAmount(lastRaise.action) || parseFloat(openSize) || 2;
	const raiseSize = raises.length === 1 ? lastSize * 3 : lastSize * 2.5;
	const stackLimit = getMaxRaiseTo(position, actionHistory);
	const actions = ["Fold", "Call"];
	if (raiseSize <= stackLimit) actions.push(`Raise ${formatSize(raiseSize)}`);
	actions.push(allIn);
	return actions;
}

function highestRaiseAmount(path) {
	return path.reduce(
		(highest, event) =>
			isAggressive(event.action)
				? Math.max(highest, getActionAmount(event.action) || 0)
				: highest,
		0
	);
}

function getMaxRaiseTo(position, actionHistory) {
	const defaultStack = getSeat(position)?.defaultStack ?? 100;
	const remainingStack = computePositionStack(position, actionHistory, defaultStack);
	const path = normalizeActionPath(actionHistory);
	const ownEvents = path.filter((event) => event.position === position);
	const lastOwnAction = ownEvents[ownEvents.length - 1]?.action;
	const currentContribution = isAggressive(lastOwnAction) && !isAllIn(lastOwnAction)
		? getActionAmount(lastOwnAction) || 0
		: isCall(lastOwnAction || "")
			? highestRaiseAmount(path)
			: 0;
	return remainingStack + currentContribution;
}

function limitActionsToStack(actions, position, actionHistory) {
	const maxRaiseTo = getMaxRaiseTo(position, actionHistory);
	return actions.filter((action) => {
		if (!isAggressive(action) || isAllIn(action)) return true;
		const amount = getActionAmount(action);
		return amount === null || amount <= maxRaiseTo;
	});
}

function computePotSizeBB(actionHistory) {
	const contributions = new Map([
		["SB", 0.5],
		["BB", 1],
	]);
	let currentBet = 1;

	for (const { position, action } of normalizeActionPath(actionHistory)) {
		const contributed = contributions.get(position) || 0;
		const amount = getActionAmount(action);

		if (isAllIn(action)) {
			const blind = position === "SB" ? 0.5 : position === "BB" ? 1 : 0;
			const totalStack = (getSeat(position)?.defaultStack ?? 100) + blind;
			const allInTo = Math.min(amount ?? totalStack, totalStack);
			contributions.set(position, Math.max(contributed, allInTo));
			currentBet = Math.max(currentBet, allInTo);
		} else if (isAggressive(action) && amount !== null) {
			contributions.set(position, Math.max(contributed, amount));
			currentBet = Math.max(currentBet, amount);
		} else if (isCall(action)) {
			contributions.set(position, Math.max(contributed, currentBet));
		}
	}

	const potSize = Array.from(contributions.values()).reduce((total, amount) => total + amount, 0);
	return Number(potSize.toFixed(2));
}

function computePositionActions(
	posId,
	actionHistory = {},
	openSize = "2",
	solutionData = null
) {
	const position = posId;
	const node = resolveTreeNode(solutionData, actionHistory);
	if (hasNoSavedStrategy(node)) return [];
	if (node && getNodePosition(node) === position) {
		const actions = getNodeActions(node).map(getActionLabel).filter(Boolean);
		return limitActionsToStack(actions, position, actionHistory);
	}

	return limitActionsToStack(
		defaultActions(position, actionHistory, openSize),
		position,
		actionHistory
	);
}

export function computePositionActionOptions(
	posId,
	actionHistory = {},
	openSize = "2",
	solutionData = null
) {
	const position = posId;
	const node = resolveTreeNode(solutionData, actionHistory);
	if (hasNoSavedStrategy(node)) return [];
	if (node && getNodePosition(node) === position) {
		const actions = getNodeActions(node).map((action) => ({
			id: action.id || action.label,
			label: action.label,
		}));
		const allowed = new Set(
			limitActionsToStack(actions.map(({ label }) => label), position, actionHistory)
		);
		return getOrderedActions(actions)
			.map(({ action }) => action)
			.filter(({ label }) => allowed.has(label));
	}

	return getOrderedActions(
		computePositionActions(posId, actionHistory, openSize, solutionData).map((label) => ({
			id: label,
			label,
		}))
	).map(({ action }) => action);
}

export function computePositionStack(posId, actionHistory = {}, defaultStack = 100) {
	const position = posId;
	const path = normalizeActionPath(actionHistory);
	const ownEvents = path.filter((event) => event.position === position);
	const lastEvent = ownEvents[ownEvents.length - 1];
	if (!lastEvent) return defaultStack;

	if (isAllIn(lastEvent.action)) return 0;

	if (isCall(lastEvent.action)) {
		return Math.max(0, defaultStack - highestRaiseAmount(path));
	}

	if (isAggressive(lastEvent.action)) {
		const amount = getActionAmount(lastEvent.action);
		if (amount !== null) return Math.max(0, defaultStack - amount);
	}

	return defaultStack;
}

export function resolveSpotFromSolution(activePosition, actionHistory = {}, solutionData = {}) {
	const position = activePosition;
	const node = resolveTreeNode(solutionData, actionHistory);
	const nodes = getSolutionNodes(solutionData);
	const nodeId =
		node?.nodeId ||
		Object.entries(nodes || {}).find(([, candidate]) => candidate === node)?.[0] ||
		null;
	const strategyUnavailable = hasNoSavedStrategy(node);
	const nodePosition = getNodePosition(node);
	const referenceRange =
		node && nodePosition === position
			? getPositionRangeReference(solutionData, { actionHistory, position })?.range
			: null;
	const actions = strategyUnavailable
		? []
		: node && nodePosition === position
			? getNodeActions(node).map(getActionLabel).filter(Boolean)
			: defaultActions(position, actionHistory, solutionData?.meta?.openSize || "2");
	const { raises } = analyzeActionHistory(actionHistory);
	const lastAggressor = raises[raises.length - 1];
	const title = lastAggressor
		? `${position} vs ${lastAggressor.position} ${raises.length === 1 ? "Open" : `${raises.length + 1}-Bet`}`
		: `${position} RFI (Open)`;
	const path = normalizeActionPath(actionHistory)
		.map(({ position: actor, action }) => `${actor} ${action}`)
		.join(" > ");

	return {
		nodeId,
		title,
		terminal: node?.terminal === true,
		tags: Array.isArray(node?.tags) ? node.tags : [],
		referenceRange: referenceRange || null,
		actions: limitActionsToStack(actions, position, actionHistory),
		strategy: strategyUnavailable || !node ? EMPTY_STRATEGY : getNodeStrategy(node),
		path: path || `${position} > open`,
		potSizeBB: computePotSizeBB(actionHistory),
	};
}
