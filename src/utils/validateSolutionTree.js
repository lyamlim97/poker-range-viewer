const POSITION_IDS = new Set(["EP", "MP", "CO", "BU", "SB", "BB"]);
const POSITION_ORDER = ["EP", "MP", "CO", "BU", "SB", "BB"];

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

function isAlmostNeverReached(value) {
	return (
		Array.isArray(value?.tags) &&
		value.tags.includes("almost-never-reached")
	);
}

function parseNodeHistory(nodeId) {
	const parts = nodeId.split("_");
	if (parts.length % 2 === 0 || !POSITION_IDS.has(parts[parts.length - 1])) {
		return null;
	}

	const history = [];
	for (let index = 0; index < parts.length - 1; index += 2) {
		if (!POSITION_IDS.has(parts[index]) || !parts[index + 1]) return null;
		history.push({ position: parts[index], actionToken: parts[index + 1] });
	}

	return { history, currentPosition: parts[parts.length - 1] };
}

function isAggressiveToken(actionToken) {
	return /^(?:RFI|SQZ|AI|\d+B)$/i.test(actionToken);
}

function getActionToken(action, history) {
	const label = (getActionKeys(action)[0] || "").trim();
	if (/^fold\b/i.test(label)) return "F";
	if (/^call\b/i.test(label)) return "C";
	if (/^check\b/i.test(label)) return "X";
	if (/^(?:all[\s-]*in|jam|AI)\b/i.test(label)) return "AI";
	if (/\b(?:squeeze|SQZ)\b/i.test(label)) return "SQZ";

	let lastAggressionIndex = -1;
	for (let index = history.length - 1; index >= 0; index--) {
		if (isAggressiveToken(history[index].actionToken)) {
			lastAggressionIndex = index;
			break;
		}
	}
	const callsAfterLastAggression = history
		.slice(lastAggressionIndex + 1)
		.some(({ actionToken }) => actionToken === "C");
	const raiseCount = history.filter(({ actionToken }) =>
		isAggressiveToken(actionToken)
	).length;
	const isSqueeze = raiseCount === 1 && callsAfterLastAggression;

	const numberedBet = label.match(/\b(\d+)\s*[- ]?\s*bet\b/i);
	if (numberedBet) {
		if (numberedBet[1] === "3" && isSqueeze) return "SQZ";
		return `${numberedBet[1]}B`;
	}
	const wordBet = label.match(/\b(three|four|five|six|seven|eight|nine)[\s-]*bet\b/i);
	if (wordBet) {
		const betNumbers = {
			three: 3,
			four: 4,
			five: 5,
			six: 6,
			seven: 7,
			eight: 8,
			nine: 9,
		};
		if (wordBet[1].toLowerCase() === "three" && isSqueeze) return "SQZ";
		return `${betNumbers[wordBet[1].toLowerCase()]}B`;
	}

	if (/^open\b/i.test(label)) return "RFI";
	if (/^raise\b/i.test(label)) {
		if (raiseCount === 0) return "RFI";
		if (isSqueeze) return "SQZ";
		return `${raiseCount + 2}B`;
	}

	return null;
}

export function getExpectedNextNodeId(sourceNodeId, action) {
	const parsedSource = parseNodeHistory(sourceNodeId);
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

	const currentIndex = POSITION_ORDER.indexOf(parsedSource.currentPosition);
	for (let offset = 1; offset <= POSITION_ORDER.length; offset++) {
		const nextPosition = POSITION_ORDER[(currentIndex + offset) % POSITION_ORDER.length];
		if (folded.has(nextPosition) || allIn.has(nextPosition)) continue;
		if (actedSinceRaise.has(nextPosition)) continue;
		if (lastAggressor && nextPosition === lastAggressor) continue;
		return { nodeId: `${sourceNodeId}_${actionToken}_${nextPosition}` };
	}

	return { nodeId: null };
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

	for (const entry of entries) {
		const nodeId = typeof entry.key === "string" ? entry.key : "";
		if (!nodeId) {
			invalidNodeIds.add(entry.isArray ? `[nodes ${entry.index}]` : "(empty node key)");
			addSolutionIssue("invalid-node-id", "error", {
				message: "A node key is empty or invalid.",
				nodeIndex: entry.index,
			});
			continue;
		}
		if (nodes.has(nodeId)) {
			duplicateNodeIds.add(nodeId);
			addIssue("duplicate-node-id", "error", nodeId, {
				message: `Node ID "${nodeId}" appears more than once.`,
			});
			continue;
		}

		nodes.set(nodeId, entry.node);
		if (!entry.isArray && entry.node?.nodeId !== nodeId) {
			invalidNodeIds.add(`${nodeId} / ${entry.node?.nodeId || "(missing nodeId)"}`);
			addIssue("node-id-mismatch", "error", nodeId, {
				message: `Node object nodeId "${entry.node?.nodeId || "(missing)"}" does not match key "${nodeId}".`,
				declaredNodeId: entry.node?.nodeId || null,
			});
		}
		if (entry.node && typeof entry.node === "object") {
			const idPosition = nodeId.split("_").pop();
			const declaredPosition = entry.node.position;
			const isEndpoint = entry.node.terminal === true;
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

	for (const nodeId of duplicateNodeIds) {
		invalidNodeIds.add(nodeId);
	}

	const rootNodeId = solutionData?.rootNodeId || solutionData?.tree?.root;
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

	function checkActionTarget(sourceNodeId, action, target) {
		const targetNodeId = typeof target === "string" ? target : target?.nodeId;
		if (typeof targetNodeId !== "string" || !nodes.has(targetNodeId)) return;

		const expected = getExpectedNextNodeId(sourceNodeId, action);
		if (!expected || targetNodeId === expected.nodeId) return;

		const actionLabel = getActionKeys(action)[0] || "(unknown action)";
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

	if (typeof rootNodeId !== "string" || !nodes.has(rootNodeId)) {
		const targetNodeId =
			typeof rootNodeId === "string" && rootNodeId
				? rootNodeId
				: "(missing rootNodeId)";
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

		const actions = Array.isArray(node.actions) ? node.actions : [];
		const isEndpoint = node.terminal === true;
		if (isAlmostNeverReached(node)) {
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
			if (
				typeof action !== "string" &&
				(!action || typeof action !== "object" || Array.isArray(action))
			) {
				addIssue("invalid-action", "error", nodeId, {
					message: "Action must be a string or an object.",
				});
				continue;
			}
			const actionLabel = getActionKeys(action)[0] || "(unknown action)";
			const strategyRange = getActionKeys(action)
				.map((key) => node.strategy?.[key])
				.find((rangeText) => typeof rangeText === "string");
			const rangeText =
				typeof action?.rawRangeText === "string"
					? action.rawRangeText
					: strategyRange;
			if (typeof rangeText !== "string") {
				actionsWithoutRange.push(`${nodeId} — ${actionLabel}`);
				addIssue("missing-range", "warning", nodeId, {
					message: `Action "${actionLabel}" has no range.`,
					action: actionLabel,
					actionId: typeof action?.id === "string" ? action.id : null,
				});
			}

			const directTarget =
				action && typeof action === "object" ? action.nextNodeId : null;
			const isTerminalAction =
				action && typeof action === "object" && action.terminal === true;
			const isRareAction = isAlmostNeverReached(action);
			const mappedTarget = getMappedTarget(node, action);
			const target = directTarget ?? mappedTarget;

			if (
				(isTerminalAction || isRareAction) &&
				(directTarget != null || mappedTarget != null)
			) {
				outcomeActionsWithLinks.add(nodeId);
				addIssue("outcome-action-with-target", "error", nodeId, {
					message: `Action "${actionLabel}" is terminal or rare but has a target.`,
					action: actionLabel,
				});
			}
			if (
				!isEndpoint &&
				!isTerminalAction &&
				!isRareAction &&
				!(typeof directTarget === "string" && directTarget.trim())
			) {
				actionsWithoutNextNode.set(
					nodeId,
					(actionsWithoutNextNode.get(nodeId) || 0) + 1
				);
				addIssue("missing-next-node", "warning", nodeId, {
					message: `Action "${actionLabel}" has no nextNodeId.`,
					action: actionLabel,
					actionId: typeof action?.id === "string" ? action.id : null,
				});
			}
			if (target != null) {
				outgoingReferenceNodeIds.add(nodeId);
				addTarget(nodeId, target);
				checkActionTarget(nodeId, action, target);
			}
		}

		for (const mapping of [node.next, node.children]) {
			if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) continue;
			for (const [action, target] of Object.entries(mapping)) {
				if (target != null) {
					outgoingReferenceNodeIds.add(nodeId);
					addTarget(nodeId, target);
					checkActionTarget(nodeId, action, target);
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
