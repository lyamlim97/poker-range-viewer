export const POSITIONS_6MAX = [
	{ id: "EP", defaultStack: 100 },
	{ id: "MP", defaultStack: 100 },
	{ id: "CO", defaultStack: 100 },
	{ id: "BU", defaultStack: 100 },
	{ id: "SB", defaultStack: 99.5 },
	{ id: "BB", defaultStack: 99 },
];

const POSITION_IDS = POSITIONS_6MAX.map(({ id }) => id);

function getRootFoldHistory(solutionData) {
	const rootNodeId = solutionData?.rootNodeId || solutionData?.tree?.root;
	if (!rootNodeId) return [];

	const parts = rootNodeId.split("_");
	const history = [];
	for (let index = 0; index < parts.length - 1; index += 2) {
		const position = parts[index];
		if (!POSITION_IDS.includes(position) || parts[index + 1] !== "F") return [];
		history.push({ position, action: "Fold" });
	}
	return history;
}

function getNodePosition(node) {
	const nodeIdPosition = node?.nodeId?.split("_").pop();
	const inferredPosition = POSITION_IDS.includes(nodeIdPosition) ? nodeIdPosition : null;
	const declaredPosition = node?.position;
	const hasDeclaredPosition = node?.position != null;

	if (hasDeclaredPosition && !POSITION_IDS.includes(declaredPosition)) {
		throw new Error(
			`Solution node "${node.nodeId}" has an invalid position "${node.position}".`
		);
	}

	if (inferredPosition && hasDeclaredPosition && inferredPosition !== declaredPosition) {
		throw new Error(
			`Solution node "${node.nodeId}" ends with ${inferredPosition}, but its position is ${declaredPosition}.`
		);
	}

	return inferredPosition || (POSITION_IDS.includes(declaredPosition) ? declaredPosition : null);
}

function hasNoSavedStrategy(node) {
	return node?.tags?.includes("almost-never-reached") === true;
}

export function normalizeActionPath(actionHistory = {}) {
	if (Array.isArray(actionHistory)) {
		return actionHistory
			.filter((event) => event && POSITION_IDS.includes(event.position) && event.action)
			.map((event) => ({
				position: event.position,
				action: String(event.action),
			}));
	}

	return POSITIONS_6MAX.flatMap(({ id }) => {
		const action = actionHistory[id];
		return action ? [{ position: id, action: String(action) }] : [];
	});
}

export function isAggressiveAction(action = "") {
	return /^(raise|all[\s-]?in|jam|[345][\s-]?bet|squeeze)/i.test(action);
}

function isAllInAction(action = "") {
	return /^(all[\s-]?in|jam)/i.test(action);
}

function actionAmount(action = "") {
	const match = action.match(/([\d.]+)\s*(?:bb)?\s*$/i);
	if (!match) return null;
	const amount = Number(match[1]);
	return Number.isFinite(amount) ? amount : null;
}

function formatSize(size) {
	return Number(size.toFixed(1)).toString();
}

function getHandState(actionHistory = {}) {
	const path = normalizeActionPath(actionHistory);
	const folded = new Set();
	const allIn = new Set();
	const pending = new Set(POSITION_IDS);
	const raises = [];

	for (const { position, action } of path) {
		pending.delete(position);
		if (/^fold\b/i.test(action)) folded.add(position);
		if (isAllInAction(action)) allIn.add(position);

		const lastRaiseAmount = actionAmount(raises[raises.length - 1]?.action);
		const currentAmount = actionAmount(action);
		const isRaise = isAllInAction(action)
			? currentAmount === null || currentAmount > (lastRaiseAmount || 0)
			: isAggressiveAction(action);
		if (isRaise) {
			raises.push({ position, action });
			for (const id of POSITION_IDS) {
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
	if (POSITION_IDS.filter((id) => !folded.has(id)).length <= 1) pending.clear();

	return { path, folded, allIn, pending, raises };
}

export function getActionablePositions(actionHistory = {}, solutionData = null) {
	const node = resolveTreeNode(solutionData, actionHistory);
	if (node?.terminal === true || hasNoSavedStrategy(node)) return [];

	const path = [...getRootFoldHistory(solutionData), ...normalizeActionPath(actionHistory)];
	const { pending, folded, allIn } = getHandState(path);
	return POSITIONS_6MAX
		.map(({ id }) => id)
		.filter((id) => pending.has(id) && !folded.has(id) && !allIn.has(id));
}

export function getNextPosition(actionHistory = {}, solutionData = null) {
	const node = resolveTreeNode(solutionData, actionHistory);
	const nodePosition = getNodePosition(node);
	if (nodePosition) return nodePosition;

	const path = [...getRootFoldHistory(solutionData), ...normalizeActionPath(actionHistory)];
	if (path.length === 0) return "EP";

	const { pending, folded, allIn } = getHandState(path);
	const lastIndex = POSITION_IDS.indexOf(path[path.length - 1].position);
	for (let offset = 1; offset <= POSITION_IDS.length; offset++) {
		const candidate = POSITION_IDS[(lastIndex + offset) % POSITION_IDS.length];
		if (pending.has(candidate) && !folded.has(candidate) && !allIn.has(candidate)) {
			return candidate;
		}
	}
	return null;
}

export function analyzeActionHistory(actionHistory = {}) {
	const { path, raises } = getHandState(actionHistory);
	const callers = path
		.filter(({ action }) => /^call\b/i.test(action))
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

function getSolutionNodes(solutionData) {
	const nodes = solutionData?.nodes || solutionData?.tree?.nodes;
	if (Array.isArray(nodes)) {
		return Object.fromEntries(nodes.filter((node) => node?.nodeId).map((node) => [node.nodeId, node]));
	}
	return nodes || null;
}

function getNodeActions(node) {
	return Array.isArray(node?.actions) ? node.actions : [];
}

function getActionLabel(action) {
	return typeof action === "string" ? action : action?.label;
}

function getActionRange(action, node) {
	const label = getActionLabel(action);
	const range =
		typeof action === "object" && action !== null
			? action.rawRangeText ?? node.strategy?.[label]
			: node.strategy?.[label];
	return typeof range === "string" ? range : null;
}

function findNodeAction(node, action) {
	return getNodeActions(node).find(
		(option) => getActionLabel(option) === action || option?.id === action
	);
}

function resolveTreeNode(solutionData, actionHistory, onTransition) {
	const nodes = getSolutionNodes(solutionData);
	const rootNodeId = solutionData?.rootNodeId || solutionData?.tree?.root;
	if (!rootNodeId || !nodes) return null;

	let node = nodes[rootNodeId];
	if (!node) return null;

	for (const event of normalizeActionPath(actionHistory)) {
		const nodePosition = getNodePosition(node);
		if (nodePosition && nodePosition !== event.position) return null;
		const option = findNodeAction(node, event.action);
		onTransition?.(node, event, option);
		const nextId =
			(typeof option === "object" ? option.nextNodeId : null) ??
			node.next?.[event.action] ??
			node.children?.[event.action];
		if (!nextId) return null;
		node = typeof nextId === "string" ? nodes[nextId] : nextId;
		if (!node) return null;
	}

	return node;
}

function getPreviousActionRange(solutionData, actionHistory, position) {
	let rangeText = null;
	resolveTreeNode(solutionData, actionHistory, (node, event, action) => {
		if (event.position === position) {
			rangeText = getActionRange(action, node);
		}
	});
	return rangeText;
}

function resolveSpot(solutionData, position, actionHistory) {
	const spotMap = solutionData?.spots?.[position];
	if (!spotMap) return null;

	const { path, raises } = analyzeActionHistory(actionHistory);
	if (raises.length === 0) return spotMap.open || null;

	const aggressor = raises[raises.length - 1].position;
	if (raises.length === 1) {
		const raiseIndex = path.findIndex(
			(event) => event.position === aggressor && isAggressiveAction(event.action)
		);
		const callers = path
			.slice(raiseIndex + 1)
			.filter(({ action }) => /^call\b/i.test(action));
		const caller = callers[callers.length - 1];
		const callSpot = caller && spotMap["vs Open after Call"]?.[caller.position];
		return callSpot || spotMap["vs Open"]?.[aggressor] || null;
	}

	const betLevel = raises.length + 1;
	return spotMap[`vs ${betLevel}Bet`]?.[aggressor] || null;
}

function defaultActions(position, actionHistory, openSize) {
	const { path, raises } = analyzeActionHistory(actionHistory);
	const lastRaise = raises[raises.length - 1];
	const allIn = "Allin 100";

	if (raises.length === 0) {
		if (position === "SB") return ["Fold", "Call", "Raise 3", allIn];
		if (position === "BB" && path.some(({ position: actor, action }) => actor === "SB" && /^call\b/i.test(action))) {
			return ["Check", `Raise ${openSize}`, allIn];
		}
		if (position === "BB") return ["Check", `Raise ${openSize}`, allIn];
		return ["Fold", `Raise ${openSize}`, allIn];
	}

	const lastSize = actionAmount(lastRaise.action) || parseFloat(openSize) || 2;
	const raiseSize = raises.length === 1 ? lastSize * 3 : lastSize * 2.5;
	const stackLimit = getMaxRaiseTo(position, actionHistory);
	const actions = ["Fold", "Call"];
	if (raiseSize <= stackLimit) actions.push(`Raise ${formatSize(raiseSize)}`);
	actions.push(allIn);
	return actions;
}

function getMaxRaiseTo(position, actionHistory) {
	const seat = POSITIONS_6MAX.find(({ id }) => id === position);
	const defaultStack = seat?.defaultStack ?? 100;
	const remainingStack = computePositionStack(position, actionHistory, defaultStack);
	const ownEvents = normalizeActionPath(actionHistory).filter(
		(event) => event.position === position
	);
	const lastOwnAction = ownEvents[ownEvents.length - 1]?.action;
	const path = normalizeActionPath(actionHistory);
	const currentContribution = isAggressiveAction(lastOwnAction) && !isAllInAction(lastOwnAction)
		? actionAmount(lastOwnAction) || 0
		: /^call\b/i.test(lastOwnAction || "")
			? path.reduce(
				(highest, event) =>
					isAggressiveAction(event.action)
						? Math.max(highest, actionAmount(event.action) || 0)
						: highest,
				0
			)
			: 0;
	return remainingStack + currentContribution;
}

function limitActionsToStack(actions, position, actionHistory) {
	const maxRaiseTo = getMaxRaiseTo(position, actionHistory);
	return actions.filter((action) => {
		if (!isAggressiveAction(action) || isAllInAction(action)) return true;
		const amount = actionAmount(action);
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
		const amount = actionAmount(action);

		if (isAllInAction(action)) {
			const seat = POSITIONS_6MAX.find(({ id }) => id === position);
			const blind = position === "SB" ? 0.5 : position === "BB" ? 1 : 0;
			const totalStack = (seat?.defaultStack ?? 100) + blind;
			const allInTo = Math.min(amount ?? totalStack, totalStack);
			contributions.set(position, Math.max(contributed, allInTo));
			currentBet = Math.max(currentBet, allInTo);
		} else if (isAggressiveAction(action) && amount !== null) {
			contributions.set(position, Math.max(contributed, amount));
			currentBet = Math.max(currentBet, amount);
		} else if (/^call\b/i.test(action)) {
			contributions.set(position, Math.max(contributed, currentBet));
		}
	}

	const potSize = Array.from(contributions.values()).reduce((total, amount) => total + amount, 0);
	return Number(potSize.toFixed(2));
}

export function computePositionActions(
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

	const spot = resolveSpot(solutionData, position, actionHistory);
	if (Array.isArray(spot?.actions)) {
		return limitActionsToStack(spot.actions, position, actionHistory);
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
		const actions = getNodeActions(node).map((action) =>
			typeof action === "string"
				? { id: action, label: action }
				: { id: action.id || action.label, label: action.label }
		);
		const allowed = new Set(
			limitActionsToStack(actions.map(({ label }) => label), position, actionHistory)
		);
		return actions.filter(({ label }) => allowed.has(label));
	}

	return computePositionActions(posId, actionHistory, openSize, solutionData).map((label) => ({
		id: label,
		label,
	}));
}

export function computePositionStack(posId, actionHistory = {}, defaultStack = 100) {
	const position = posId;
	const path = normalizeActionPath(actionHistory);
	const ownEvents = path.filter((event) => event.position === position);
	const lastEvent = ownEvents[ownEvents.length - 1];
	if (!lastEvent) return defaultStack;

	if (isAllInAction(lastEvent.action)) return 0;

	if (/^call\b/i.test(lastEvent.action)) {
		const maxBet = path.reduce((highest, event) => {
			return isAggressiveAction(event.action)
				? Math.max(highest, actionAmount(event.action) || 0)
				: highest;
		}, 0);
		return Math.max(0, defaultStack - maxBet);
	}

	if (isAggressiveAction(lastEvent.action)) {
		const amount = actionAmount(lastEvent.action);
		if (amount !== null) return Math.max(0, defaultStack - amount);
	}

	return defaultStack;
}

export function resolveSpotFromSolution(activePosition, actionHistory = {}, solutionData = {}) {
	const position = activePosition;
	const node = resolveTreeNode(solutionData, actionHistory);
	const strategyUnavailable = hasNoSavedStrategy(node);
	const nodePosition = getNodePosition(node);
	const spot = resolveSpot(solutionData, position, actionHistory);
	const nodeActions = node ? getNodeActions(node).map(getActionLabel).filter(Boolean) : null;
	const actions =
		(strategyUnavailable
			? []
			: node && nodePosition === position && nodeActions
			? nodeActions
			: null) ||
		(Array.isArray(spot?.actions) ? spot.actions : null) ||
		defaultActions(position, actionHistory, solutionData?.meta?.openSize || "2");
	const { raises } = analyzeActionHistory(actionHistory);
	const lastAggressor = raises[raises.length - 1];
	const defaultTitle = lastAggressor
		? `${position} vs ${lastAggressor.position} ${raises.length === 1 ? "Open" : `${raises.length + 1}-Bet`}`
		: `${position} RFI (Open)`;
	const path = normalizeActionPath(actionHistory)
		.map(({ position: actor, action }) => `${actor} ${action}`)
		.join(" > ");

	return {
		title: node?.title || spot?.title || defaultTitle,
		terminal: node?.terminal === true,
		tags: Array.isArray(node?.tags) ? node.tags : [],
		referenceRangeText:
			node && nodePosition === position
				? getPreviousActionRange(solutionData, actionHistory, position)
				: null,
		actions: limitActionsToStack(actions, position, actionHistory),
		strategy: strategyUnavailable
			? {}
			: node
			? Object.fromEntries(
					getNodeActions(node)
						.map((action) => {
							const label = getActionLabel(action);
							const range = getActionRange(action, node);
							return typeof label === "string" && typeof range === "string"
								? [label, range]
								: null;
						})
						.filter(Boolean)
				)
			: spot?.strategy || {},
		path: path || `${position} > open`,
		potSizeBB: computePotSizeBB(actionHistory),
	};
}
