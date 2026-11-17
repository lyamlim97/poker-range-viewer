export function validateBasicSolutionStructure(solution) {
	if (!solution || typeof solution !== "object" || Array.isArray(solution)) {
		return "The solution must be a JSON object.";
	}
	if (!solution.meta || typeof solution.meta !== "object" || Array.isArray(solution.meta)) {
		return "Solution metadata must be an object.";
	}
	if (typeof solution.rootNodeId !== "string" || !solution.rootNodeId.trim()) {
		return "rootNodeId must be a non-empty string.";
	}
	if (
		!solution.nodes ||
		typeof solution.nodes !== "object" ||
		Array.isArray(solution.nodes)
	) {
		return "nodes must be an object.";
	}
	if (!Object.hasOwn(solution.nodes, solution.rootNodeId)) {
		return `Root node "${solution.rootNodeId}" does not exist.`;
	}

	for (const [nodeId, node] of Object.entries(solution.nodes)) {
		if (!node || typeof node !== "object" || Array.isArray(node)) {
			return `Node "${nodeId}" must be an object.`;
		}
		if (typeof node.nodeId !== "string" || node.nodeId !== nodeId) {
			return `Node key "${nodeId}" must match nodeId "${node.nodeId || ""}".`;
		}
		if (node.actions != null && !Array.isArray(node.actions)) {
			return `Node "${nodeId}" actions must be an array.`;
		}
		const actions = Array.isArray(node.actions) ? node.actions : [];
		if (node.terminal === true && actions.length > 0) {
			return `Terminal node "${nodeId}" cannot contain actions.`;
		}

		for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
			const action = actions[actionIndex];
			if (typeof action === "string") continue;
			if (!action || typeof action !== "object" || Array.isArray(action)) {
				return `Action ${actionIndex + 1} on node "${nodeId}" must be an object or string.`;
			}
			if (typeof action.label !== "string" && typeof action.id !== "string") {
				return `Action ${actionIndex + 1} on node "${nodeId}" needs an id or label.`;
			}
			if (
				action.nextNodeId != null &&
				action.nextNodeId !== "" &&
				(typeof action.nextNodeId !== "string" ||
					!Object.hasOwn(solution.nodes, action.nextNodeId))
			) {
				return `Action "${action.label || action.id || actionIndex + 1}" on node "${nodeId}" has an invalid nextNodeId.`;
			}
		}
	}

	return null;
}
