const POSITION_IDS = new Set(["EP", "MP", "CO", "BU", "SB", "BB"]);

function getNodeEntries(rawNodes) {
	if (Array.isArray(rawNodes)) {
		return rawNodes.map((node, index) => ({
			key: node?.nodeId,
			node,
			index,
			isArray: true,
		}));
	}

	if (rawNodes && typeof rawNodes === "object") {
		return Object.entries(rawNodes).map(([key, node], index) => ({
			key,
			node,
			index,
			isArray: false,
		}));
	}

	return [];
}

function getActionKeys(action) {
	if (typeof action === "string") return [action];
	return [action?.label, action?.id].filter((key) => typeof key === "string" && key);
}

function getMappedTarget(node, action) {
	for (const key of getActionKeys(action)) {
		const target = node.next?.[key] ?? node.children?.[key];
		if (target != null) return target;
	}
	return null;
}

function getTargetLabel(target) {
	if (typeof target === "string") return target.trim() ? target : "(empty target)";
	if (target && typeof target.nodeId === "string" && target.nodeId.trim()) {
		return target.nodeId;
	}
	if (target == null) return "(missing target)";
	return "(invalid target)";
}

function getCanonicalCycle(cycle) {
	const ring = cycle.slice(0, -1);
	const rotations = ring.map((_, index) =>
		ring.slice(index).concat(ring.slice(0, index))
	);
	rotations.sort((left, right) => left.join("\u0000").localeCompare(right.join("\u0000")));
	const canonical = rotations[0] || ring;
	return [...canonical, canonical[0]];
}

export function validateSolutionTree(solutionData = {}) {
	const rawNodes = solutionData?.nodes ?? solutionData?.tree?.nodes;
	const entries = getNodeEntries(rawNodes);
	const nodes = new Map();
	const invalidNodeIds = new Set();
	const duplicateNodeIds = new Set();

	for (const entry of entries) {
		const nodeId = typeof entry.key === "string" ? entry.key : "";
		if (!nodeId) {
			invalidNodeIds.add(entry.isArray ? `[nodes ${entry.index}]` : "(empty node key)");
			continue;
		}
		if (nodes.has(nodeId)) {
			duplicateNodeIds.add(nodeId);
			continue;
		}

		nodes.set(nodeId, entry.node);
		if (!entry.isArray && entry.node?.nodeId !== nodeId) {
			invalidNodeIds.add(`${nodeId} / ${entry.node?.nodeId || "(missing nodeId)"}`);
		}
		if (entry.node && typeof entry.node === "object") {
			const idPosition = nodeId.split("_").pop();
			const declaredPosition = entry.node.position;
			const isEndpoint =
				entry.node.terminal === true ||
				(Array.isArray(entry.node.tags) &&
					entry.node.tags.includes("almost-never-reached"));
			const hasIdPosition = POSITION_IDS.has(idPosition);
			const hasDeclaredPosition = POSITION_IDS.has(declaredPosition);
			if (
				(declaredPosition != null && !hasDeclaredPosition) ||
				(hasIdPosition && hasDeclaredPosition && idPosition !== declaredPosition) ||
				(!hasIdPosition && !hasDeclaredPosition && !isEndpoint)
			) {
				invalidNodeIds.add(nodeId);
			}
		}
	}

	for (const nodeId of duplicateNodeIds) {
		invalidNodeIds.add(nodeId);
	}

	const rootNodeId = solutionData?.rootNodeId || solutionData?.tree?.root;
	const missingTargets = [];
	const missingTargetKeys = new Set();
	const actionsWithoutNextNode = new Map();
	const adjacency = new Map([...nodes.keys()].map((nodeId) => [nodeId, new Set()]));
	const outgoingReferenceNodeIds = new Set();
	const incompleteNodeIds = new Set();
	const invalidEndpointNodeIds = new Set();
	const terminalActionsWithLinks = new Set();

	function addTarget(sourceNodeId, target) {
		if (typeof target !== "string" || !target.trim()) {
			if (target != null) {
				const targetLabel = getTargetLabel(target);
				const key = `${sourceNodeId}\u0000${targetLabel}`;
				if (!missingTargetKeys.has(key)) {
					missingTargetKeys.add(key);
					missingTargets.push({ sourceNodeId, targetNodeId: targetLabel });
				}
			}
			return;
		}

		if (!nodes.has(target)) {
			const key = `${sourceNodeId}\u0000${target}`;
			if (!missingTargetKeys.has(key)) {
				missingTargetKeys.add(key);
				missingTargets.push({ sourceNodeId, targetNodeId: target });
			}
			return;
		}

		adjacency.get(sourceNodeId)?.add(target);
	}

	if (typeof rootNodeId !== "string" || !nodes.has(rootNodeId)) {
		const targetNodeId =
			typeof rootNodeId === "string" && rootNodeId
				? rootNodeId
				: "(missing rootNodeId)";
		missingTargets.push({ sourceNodeId: "rootNodeId", targetNodeId });
	}

	for (const [nodeId, node] of nodes) {
		if (!node || typeof node !== "object") {
			invalidNodeIds.add(nodeId);
			continue;
		}

		const actions = Array.isArray(node.actions) ? node.actions : [];
		const isEndpoint =
			node.terminal === true ||
			(Array.isArray(node.tags) && node.tags.includes("almost-never-reached"));

		if (isEndpoint && actions.length > 0) {
			invalidEndpointNodeIds.add(nodeId);
		} else if (!isEndpoint && actions.length === 0) {
			incompleteNodeIds.add(nodeId);
		}

		for (const action of actions) {
			const directTarget =
				action && typeof action === "object" ? action.nextNodeId : null;
			const isTerminalAction =
				action && typeof action === "object" && action.terminal === true;
			const mappedTarget = getMappedTarget(node, action);
			const target = directTarget ?? mappedTarget;

			if (
				isTerminalAction &&
				(directTarget != null || mappedTarget != null)
			) {
				terminalActionsWithLinks.add(nodeId);
			}
			if (
				!isEndpoint &&
				!isTerminalAction &&
				!(typeof directTarget === "string" && directTarget.trim())
			) {
				actionsWithoutNextNode.set(
					nodeId,
					(actionsWithoutNextNode.get(nodeId) || 0) + 1
				);
			}
			if (target != null) {
				outgoingReferenceNodeIds.add(nodeId);
				addTarget(nodeId, target);
			}
		}

		for (const mapping of [node.next, node.children]) {
			if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) continue;
			for (const target of Object.values(mapping)) {
				if (target != null) {
					outgoingReferenceNodeIds.add(nodeId);
					addTarget(nodeId, target);
				}
			}
		}

		if (isEndpoint && outgoingReferenceNodeIds.has(nodeId)) {
			invalidEndpointNodeIds.add(nodeId);
		}
	}

	const reachableNodeIds = new Set();
	if (typeof rootNodeId === "string" && nodes.has(rootNodeId)) {
		const pending = [rootNodeId];
		while (pending.length > 0) {
			const nodeId = pending.pop();
			if (reachableNodeIds.has(nodeId)) continue;
			reachableNodeIds.add(nodeId);
			for (const target of adjacency.get(nodeId) || []) {
				pending.push(target);
			}
		}
	}
	const unreachableNodeIds = [...nodes.keys()].filter(
		(nodeId) => !reachableNodeIds.has(nodeId)
	);

	const visitState = new Map();
	const visitPath = [];
	const cycles = [];
	const cycleKeys = new Set();

	function visit(nodeId) {
		visitState.set(nodeId, 1);
		visitPath.push(nodeId);

		for (const target of adjacency.get(nodeId) || []) {
			if (visitState.get(target) === 1) {
				const start = visitPath.indexOf(target);
				const cycle = getCanonicalCycle([...visitPath.slice(start), target]);
				const key = cycle.join("\u0000");
				if (!cycleKeys.has(key)) {
					cycleKeys.add(key);
					cycles.push(cycle);
				}
			} else if (!visitState.has(target)) {
				visit(target);
			}
		}

		visitPath.pop();
		visitState.set(nodeId, 2);
	}

	for (const nodeId of nodes.keys()) {
		if (!visitState.has(nodeId)) visit(nodeId);
	}

	const actionsWithoutNextNodeCount = [...actionsWithoutNextNode.values()].reduce(
		(total, count) => total + count,
		0
	);
	const issueCount =
		missingTargets.length +
		actionsWithoutNextNodeCount +
		unreachableNodeIds.length +
		cycles.length +
		invalidEndpointNodeIds.size +
		terminalActionsWithLinks.size +
		incompleteNodeIds.size +
		invalidNodeIds.size;

	return {
		missingTargets,
		actionsWithoutNextNode: [...actionsWithoutNextNode].map(([nodeId]) => nodeId),
		actionsWithoutNextNodeCount,
		unreachableNodeIds,
		cycles,
		invalidEndpointNodeIds: [...invalidEndpointNodeIds],
		terminalActionsWithLinks: [...terminalActionsWithLinks],
		incompleteNodeIds: [...incompleteNodeIds],
		invalidNodeIds: [...invalidNodeIds],
		issueCount,
	};
}
