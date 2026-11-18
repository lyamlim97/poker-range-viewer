export const RARE_TAG = "almost-never-reached";

const strategyCache = new WeakMap();

export function getSolutionNodes(solution) {
	const nodes = solution?.nodes;
	return nodes && typeof nodes === "object" && !Array.isArray(nodes) ? nodes : null;
}

export function getRootNodeId(solution) {
	const rootNodeId = solution?.rootNodeId;
	return typeof rootNodeId === "string" && rootNodeId ? rootNodeId : null;
}

export function getNodeActions(node) {
	return Array.isArray(node?.actions) ? node.actions : [];
}

export function getActionLabel(action) {
	return action?.label || action?.id;
}

export function getActionKey(action, index) {
	return action?.id || `${getActionLabel(action)}-${index}`;
}

export function getActionRange(action) {
	return typeof action?.rawRangeText === "string" ? action.rawRangeText : null;
}

export function getActionTarget(action) {
	return typeof action?.nextNodeId === "string" ? action.nextNodeId : "";
}

export function findNodeAction(node, labelOrId) {
	return getNodeActions(node).find(
		(action) => getActionLabel(action) === labelOrId || action?.id === labelOrId
	);
}

export function hasRareTag(value) {
	return Array.isArray(value?.tags) && value.tags.includes(RARE_TAG);
}

export function isTerminalAction(action) {
	return action?.terminal === true;
}

export function isRareAction(action) {
	return hasRareTag(action);
}

// "terminal" and "rare" actions end the tree; terminal wins when both are set.
export function getActionOutcome(action) {
	if (isTerminalAction(action)) return "terminal";
	if (isRareAction(action)) return "rare";
	return "continue";
}

export function getNodeStrategy(node) {
	if (!node) return {};
	const cached = strategyCache.get(node);
	if (cached) return cached;

	const strategy = {};
	for (const action of getNodeActions(node)) {
		const label = getActionLabel(action);
		const range = getActionRange(action);
		if (typeof label === "string" && range !== null) strategy[label] = range;
	}
	strategyCache.set(node, strategy);
	return strategy;
}
