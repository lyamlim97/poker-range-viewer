import {
	checkNodeRangeConsistency,
} from "./checkRange";
import { getActionToken, getNodeIdPosition, isAggressiveToken, parseNodeId } from "./nodeId";
import { POSITIONS, POSITION_IDS } from "./positions";
import {
	getActionLabel,
	getActionRange,
	getNodeActions,
	getRootNodeId,
	getSolutionNodes,
	hasRareTag,
	isRareAction,
	isTerminalAction,
} from "./solutionAccessors";

export function getExpectedNextNodeId(sourceNodeId, action) {
	const parsedSource = parseNodeId(sourceNodeId);
	if (!parsedSource) return null;

	const actionToken = getActionToken(action, parsedSource.history);
	if (!actionToken) return null;

	const events = [
		...parsedSource.history,
		{ position: parsedSource.currentPosition, actionToken },
	];
	const folded = new Set();
	const allIn = new Set();
	let actedSinceRaise = new Set();
	let lastAggressor = null;

	for (const event of events) {
		if (event.actionToken === "F") folded.add(event.position);
		if (event.actionToken === "AI") allIn.add(event.position);

		if (isAggressiveToken(event.actionToken)) {
			lastAggressor = event.position;
			actedSinceRaise = new Set([event.position]);
		} else {
			actedSinceRaise.add(event.position);
		}
	}

	const currentIndex = POSITIONS.indexOf(parsedSource.currentPosition);
	for (let offset = 1; offset <= POSITIONS.length; offset++) {
		const nextPosition = POSITIONS[(currentIndex + offset) % POSITIONS.length];
		if (folded.has(nextPosition) || allIn.has(nextPosition)) continue;
		if (actedSinceRaise.has(nextPosition)) continue;
		if (lastAggressor && nextPosition === lastAggressor) continue;
		return { nodeId: `${sourceNodeId}_${actionToken}_${nextPosition}` };
	}

	return { nodeId: null };
}

function getTargetLabel(target) {
	if (typeof target === "string") return target.trim() ? target : "(empty target)";
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
	const entries = Object.entries(getSolutionNodes(solutionData) || {});
	const nodes = new Map();
	const invalidNodeIds = new Set();
	const positionMismatches = [];
	const issues = [];
	const nodeIssues = {};

	if (!solutionData || typeof solutionData !== "object" || Array.isArray(solutionData)) {
		addSolutionIssue("invalid-solution", "error", {
			message: "Solution data must be a JSON object.",
		});
	}
	if (!solutionData?.meta || typeof solutionData.meta !== "object" || Array.isArray(solutionData.meta)) {
		addSolutionIssue("missing-meta", "error", {
			message: "Solution metadata is missing or invalid.",
		});
	}
	if (!solutionData?.nodes || typeof solutionData.nodes !== "object" || Array.isArray(solutionData.nodes)) {
		addSolutionIssue("invalid-nodes", "error", {
			message: "The solution nodes value must be an object.",
		});
	}

	function addIssue(category, severity, nodeId, details = {}) {
		const issue = {
			category,
			severity,
			nodeId: nodeId ?? null,
			...details,
		};
		issues.push(issue);
		if (nodeId) {
			if (!nodeIssues[nodeId]) nodeIssues[nodeId] = [];
			nodeIssues[nodeId].push(issue);
		}
	}

	function addSolutionIssue(category, severity, details = {}) {
		addIssue(category, severity, null, details);
	}

	for (const [index, [nodeId, node]] of entries.entries()) {
		if (!nodeId) {
			invalidNodeIds.add("(empty node key)");
			addSolutionIssue("invalid-node-id", "error", {
				message: "A node key is empty or invalid.",
				nodeIndex: index,
			});
			continue;
		}

		nodes.set(nodeId, node);
		if (node?.nodeId !== nodeId) {
			invalidNodeIds.add(`${nodeId} / ${node?.nodeId || "(missing nodeId)"}`);
			addIssue("node-id-mismatch", "error", nodeId, {
				message: `Node object nodeId "${node?.nodeId || "(missing)"}" does not match key "${nodeId}".`,
				declaredNodeId: node?.nodeId || null,
			});
		}
		if (node && typeof node === "object") {
			const idPosition = getNodeIdPosition(nodeId);
			const declaredPosition = node.position;
			const isEndpoint = node.terminal === true;
			const hasIdPosition = POSITION_IDS.has(idPosition);
			const hasDeclaredPosition = POSITION_IDS.has(declaredPosition);
			if (hasIdPosition && hasDeclaredPosition && idPosition !== declaredPosition) {
				positionMismatches.push({ nodeId, idPosition, declaredPosition });
				addIssue("position-mismatch", "error", nodeId, {
					message: `Node ID ends in ${idPosition}, but position is ${declaredPosition}.`,
					idPosition,
					declaredPosition,
				});
			}
			if (
				(declaredPosition != null && !hasDeclaredPosition) ||
				(!hasIdPosition && !hasDeclaredPosition && !isEndpoint)
			) {
				invalidNodeIds.add(nodeId);
				addIssue("invalid-node", "error", nodeId, {
					message: "Node position or node ID position is invalid.",
					declaredPosition: declaredPosition ?? null,
				});
			}
		} else {
			invalidNodeIds.add(nodeId);
			addIssue("invalid-node", "error", nodeId, {
				message: "Node value must be an object.",
			});
		}
	}

	const rootNodeId = getRootNodeId(solutionData);
	const missingTargets = [];
	const missingTargetKeys = new Set();
	const actionsWithoutRange = [];
	const actionsWithoutNextNode = new Map();
	const wronglyLinkedNodes = [];
	const wronglyLinkedKeys = new Set();
	const adjacency = new Map([...nodes.keys()].map((nodeId) => [nodeId, new Set()]));
	const outgoingReferenceNodeIds = new Set();
	const incompleteNodeIds = new Set();
	const invalidEndpointNodeIds = new Set();
	const outcomeActionsWithLinks = new Set();
	const misplacedRareNodeTags = new Set();
	const rangeIssues = [];

	function addTarget(sourceNodeId, target) {
		if (typeof target !== "string" || !target.trim()) {
			if (target != null) {
				const targetLabel = getTargetLabel(target);
				const key = `${sourceNodeId}\u0000${targetLabel}`;
				if (!missingTargetKeys.has(key)) {
					missingTargetKeys.add(key);
					missingTargets.push({ sourceNodeId, targetNodeId: targetLabel });
					addIssue("missing-target", "error", sourceNodeId, {
						message: `Action target "${targetLabel}" is missing or invalid.`,
						targetNodeId: targetLabel,
					});
				}
			}
			return;
		}

		if (!nodes.has(target)) {
			const key = `${sourceNodeId}\u0000${target}`;
			if (!missingTargetKeys.has(key)) {
				missingTargetKeys.add(key);
				missingTargets.push({ sourceNodeId, targetNodeId: target });
				addIssue("missing-target", "error", sourceNodeId, {
					message: `Target node "${target}" does not exist.`,
					targetNodeId: target,
				});
			}
			return;
		}

		adjacency.get(sourceNodeId)?.add(target);
	}

	function checkActionTarget(sourceNodeId, action, targetNodeId) {
		if (typeof targetNodeId !== "string" || !nodes.has(targetNodeId)) return;

		const expected = getExpectedNextNodeId(sourceNodeId, action);
		if (!expected || targetNodeId === expected.nodeId) return;

		const actionLabel = getActionLabel(action) || "(unknown action)";
		const key = `${sourceNodeId}\u0000${actionLabel}\u0000${targetNodeId}`;
		if (wronglyLinkedKeys.has(key)) return;
		wronglyLinkedKeys.add(key);
		wronglyLinkedNodes.push({
			sourceNodeId,
			action: actionLabel,
			targetNodeId,
			expectedNodeId: expected.nodeId,
		});
		addIssue("wrong-target", "error", sourceNodeId, {
			message: `Action "${actionLabel}" should lead to "${expected.nodeId}", not "${targetNodeId}".`,
			action: actionLabel,
			targetNodeId,
			expectedNodeId: expected.nodeId,
		});
	}

	if (!rootNodeId || !nodes.has(rootNodeId)) {
		const targetNodeId = rootNodeId || "(missing rootNodeId)";
		missingTargets.push({ sourceNodeId: "rootNodeId", targetNodeId });
		addSolutionIssue("invalid-root", "error", {
			message: `Root node "${targetNodeId}" does not exist.`,
			targetNodeId,
		});
	}

	for (const [nodeId, node] of nodes) {
		if (!node || typeof node !== "object") {
			invalidNodeIds.add(nodeId);
			continue;
		}

		const actions = getNodeActions(node);
		const isEndpoint = node.terminal === true;
		if (hasRareTag(node)) {
			misplacedRareNodeTags.add(nodeId);
			addIssue("rare-node-tag", "error", nodeId, {
				message: "The almost-never-reached tag belongs on an action, not a node.",
			});
		}

		if (isEndpoint && actions.length > 0) {
			invalidEndpointNodeIds.add(nodeId);
			addIssue("terminal-with-actions", "error", nodeId, {
				message: "Terminal nodes cannot contain actions.",
			});
		} else if (!isEndpoint && actions.length === 0) {
			incompleteNodeIds.add(nodeId);
			addIssue("incomplete-node", "warning", nodeId, {
				message: "This node has no actions and is not marked terminal.",
			});
		}

		for (const action of actions) {
			if (!action || typeof action !== "object" || Array.isArray(action)) {
				addIssue("invalid-action", "error", nodeId, {
					message: "Action must be an object.",
				});
				continue;
			}
			const actionLabel = getActionLabel(action) || "(unknown action)";
			if (getActionRange(action) === null) {
				actionsWithoutRange.push(`${nodeId} — ${actionLabel}`);
				addIssue("missing-range", "warning", nodeId, {
					message: `Action "${actionLabel}" has no range.`,
					action: actionLabel,
					actionId: typeof action.id === "string" ? action.id : null,
				});
			}

			const target = action.nextNodeId;
			const isTerminal = isTerminalAction(action);
			const isRare = isRareAction(action);

			if ((isTerminal || isRare) && target != null) {
				outcomeActionsWithLinks.add(nodeId);
				addIssue("outcome-action-with-target", "error", nodeId, {
					message: `Action "${actionLabel}" is terminal or rare but has a target.`,
					action: actionLabel,
				});
			}
			if (
				!isEndpoint &&
				!isTerminal &&
				!isRare &&
				!(typeof target === "string" && target.trim())
			) {
				actionsWithoutNextNode.set(
					nodeId,
					(actionsWithoutNextNode.get(nodeId) || 0) + 1
				);
				addIssue("missing-next-node", "warning", nodeId, {
					message: `Action "${actionLabel}" has no nextNodeId.`,
					action: actionLabel,
					actionId: typeof action.id === "string" ? action.id : null,
				});
			}
			if (target != null) {
				outgoingReferenceNodeIds.add(nodeId);
				addTarget(nodeId, target);
				checkActionTarget(nodeId, action, target);
			}
		}

		if (!isEndpoint && actions.length > 0) {
			const rangeCheck = checkNodeRangeConsistency(solutionData, nodeId);
			const isPrevious = rangeCheck?.kind === "previous";
			if (rangeCheck?.kind === "100" || isPrevious) {
				const suffix = isPrevious ? "previous" : "100";
				for (const status of ["over", "under", "mismatch"]) {
					for (const issue of rangeCheck[status] ?? []) {
						const category = `range-${status}-${suffix}`;
						const details = {
							hand: issue.hand,
							total: issue.total,
							...(isPrevious && {
								expected: issue.expected,
								previousAction: rangeCheck.previous.action,
							}),
						};
						const percent = +(issue.total * 100).toFixed(1);
						rangeIssues.push({ category, nodeId, ...details });
						addIssue(category, "warning", nodeId, {
							message: isPrevious
								? `Hand "${issue.hand}" totals ${percent}%; ${rangeCheck.previous.action} previously allowed ${+(issue.expected * 100).toFixed(1)}%.`
								: `Hand "${issue.hand}" action frequencies add up to ${percent}%, not 100%.`,
							...details,
						});
					}
				}
			}
		}

		if (isEndpoint && outgoingReferenceNodeIds.has(nodeId)) {
			invalidEndpointNodeIds.add(nodeId);
			addIssue("endpoint-with-outgoing-link", "error", nodeId, {
				message: "Terminal nodes cannot have outgoing links.",
			});
		}
	}

	const reachableNodeIds = new Set();
	if (rootNodeId && nodes.has(rootNodeId)) {
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
	for (const nodeId of unreachableNodeIds) {
		addIssue("unreachable-node", "warning", nodeId, {
			message: "This node cannot be reached from the root.",
		});
	}

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
					for (const nodeId of cycle.slice(0, -1)) {
						addIssue("cycle", "error", nodeId, {
							message: `This node is part of a cycle: ${cycle.join(" -> ")}.`,
							cycle,
						});
					}
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
	const issueCount = issues.length;
	const nodeIssueCounts = Object.fromEntries(
		Object.entries(nodeIssues).map(([nodeId, nodeIssueList]) => [
			nodeId,
			nodeIssueList.length,
		])
	);

	return {
		missingTargets,
		actionsWithoutRange,
		rangeIssues,
		wronglyLinkedNodes,
		actionsWithoutNextNode: [...actionsWithoutNextNode].map(([nodeId]) => nodeId),
		actionsWithoutNextNodeCount,
		unreachableNodeIds,
		cycles,
		invalidEndpointNodeIds: [...invalidEndpointNodeIds],
		outcomeActionsWithLinks: [...outcomeActionsWithLinks],
		misplacedRareNodeTags: [...misplacedRareNodeTags],
		positionMismatches,
		incompleteNodeIds: [...incompleteNodeIds],
		invalidNodeIds: [...invalidNodeIds],
		issueCount,
		issues,
		nodeIssues,
		nodeIssueCounts,
	};
}
