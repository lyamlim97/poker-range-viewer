const LEGACY_NODE_KEYS = ["strategy", "next", "children"];

const isPlainObject = (value) =>
	value !== null && typeof value === "object" && !Array.isArray(value);

function hoistInlineNode(target, hoisted) {
	if (!isPlainObject(target) || typeof target.nodeId !== "string" || !target.nodeId) {
		return null;
	}
	if (!Object.hasOwn(hoisted, target.nodeId)) {
		hoisted[target.nodeId] = convertNode(target, hoisted);
	}
	return target.nodeId;
}

function convertAction(action, node, hoisted) {
	if (typeof action === "string") {
		return convertAction({ id: action, label: action }, node, hoisted);
	}
	if (!isPlainObject(action)) return action;

	const patch = {};
	if (action.label == null && action.id != null) patch.label = action.id;
	if (action.id == null && action.label != null) patch.id = action.label;

	const keys = [action.label, action.id].filter((key) => typeof key === "string");
	if (typeof action.rawRangeText !== "string") {
		const range = keys
			.map((key) => node.strategy?.[key])
			.find((text) => typeof text === "string");
		if (range !== undefined) patch.rawRangeText = range;
	}

	let target = action.nextNodeId;
	if (target == null || target === "") {
		target =
			keys
				.map((key) => node.next?.[key] ?? node.children?.[key])
				.find((mapped) => mapped != null) ?? target;
	}
	const hoistedId = hoistInlineNode(target, hoisted);
	if (hoistedId) target = hoistedId;
	if (typeof target === "string" && target !== action.nextNodeId) {
		patch.nextNodeId = target;
	}

	return Object.keys(patch).length > 0 ? { ...action, ...patch } : action;
}

function convertNode(node, hoisted) {
	if (!isPlainObject(node)) return node;

	let actions = node.actions;
	let actionsChanged = false;
	if (Array.isArray(actions)) {
		actions = actions.map((action) => convertAction(action, node, hoisted));
		actionsChanged = actions.some((action, index) => action !== node.actions[index]);
	}
	const hasLegacyKeys = LEGACY_NODE_KEYS.some((key) => Object.hasOwn(node, key));
	if (!hasLegacyKeys && !actionsChanged) return node;

	const converted = { ...node };
	for (const key of LEGACY_NODE_KEYS) delete converted[key];
	if (actionsChanged) converted.actions = actions;
	return converted;
}

function convertNodes(rawNodes, hoisted) {
	if (Array.isArray(rawNodes)) {
		const nodes = {};
		for (const node of rawNodes) {
			if (node?.nodeId) nodes[node.nodeId] = convertNode(node, hoisted);
		}
		return nodes;
	}
	if (!isPlainObject(rawNodes)) return rawNodes;

	let changed = false;
	const nodes = {};
	for (const [nodeId, node] of Object.entries(rawNodes)) {
		nodes[nodeId] = convertNode(node, hoisted);
		if (nodes[nodeId] !== node) changed = true;
	}
	return changed || Object.keys(hoisted).length > 0 ? nodes : rawNodes;
}

// Converts older file layouts (tree.root/tree.nodes, node arrays, string
// actions, node.strategy, node.next/children) to the canonical shape. A
// solution that is already canonical is returned untouched.
export function normalizeSolution(raw) {
	if (!isPlainObject(raw)) return raw;

	const tree = isPlainObject(raw.tree) ? raw.tree : null;
	const rootNodeId = raw.rootNodeId || tree?.root || raw.rootNodeId;
	const hoisted = {};
	let nodes = convertNodes(raw.nodes || tree?.nodes || raw.nodes, hoisted);
	if (isPlainObject(nodes)) {
		const missing = Object.keys(hoisted).filter((nodeId) => !Object.hasOwn(nodes, nodeId));
		if (missing.length > 0) {
			nodes = { ...nodes, ...Object.fromEntries(missing.map((id) => [id, hoisted[id]])) };
		}
	}

	if (!Object.hasOwn(raw, "tree") && nodes === raw.nodes && rootNodeId === raw.rootNodeId) {
		return raw;
	}

	const result = { ...raw };
	delete result.tree;
	if (rootNodeId !== undefined) result.rootNodeId = rootNodeId;
	if (nodes !== undefined) result.nodes = nodes;
	return result;
}
