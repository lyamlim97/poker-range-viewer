export const formatPercent = (fraction) => +(fraction * 100).toFixed(1);

export function summarizeHands(items, limit = 8) {
	const shown = items
		.slice(0, limit)
		.map(({ hand, total }) => `${hand} ${formatPercent(total)}%`)
		.join(", ");
	return items.length > limit ? `${shown} +${items.length - limit} more` : shown;
}

// Turns a range-consistency check into a tone ("muted", "ok" or "warning") and one line of text.
export function describeRangeCheck(check, { emptyText = "No hands entered for this node" } = {}) {
	const { over = [], under = [], mismatch = [] } = check;

	if (check.kind === "unavailable") {
		return { tone: "warning", text: check.reason || "Previous range unavailable" };
	}
	if (check.kind === "previous") {
		return over.length === 0 && under.length === 0 && mismatch.length === 0
			? { tone: "ok", text: `✓ Every hand matches ${check.previous.action}` }
			: {
					tone: "warning",
					text: `${over.length} over · ${under.length} under · ${mismatch.length} mismatched`,
				};
	}
	if (check.empty) return { tone: "muted", text: emptyText };
	if (over.length === 0 && under.length === 0) {
		return { tone: "ok", text: "✓ Every hand adds up to 100%" };
	}
	return {
		tone: "warning",
		text: `${over.length} over 100% · ${under.length} under 100%`,
	};
}

const arrow = (from, to) => `${from} → ${to}`;

const GROUPS = [
	{
		title: "Missing node targets",
		shortTitle: "Missing targets",
		items: (report) =>
			report.missingTargets.map(({ sourceNodeId, targetNodeId }) => arrow(sourceNodeId, targetNodeId)),
	},
	{
		title: "Wrongly linked nodes",
		shortTitle: "Wrongly linked actions",
		items: (report, compact) =>
			report.wronglyLinkedNodes.map(
				({ sourceNodeId, action, targetNodeId, expectedNodeId }) =>
					compact
						? arrow(sourceNodeId, targetNodeId)
						: `${sourceNodeId} — ${action} → ${targetNodeId} (expected ${expectedNodeId || "no next node"})`
			),
	},
	{
		title: "Actions without rawRangeText",
		shortTitle: "Action ranges needed",
		items: (report) => report.actionsWithoutRange,
	},
	{
		title: "Range consistency",
		items: (report) =>
			(report.rangeIssues || []).map(
				(issue) => `${issue.nodeId || "Solution"}${issue.hand ? ` — ${issue.hand}` : ""}`
			),
	},
	{
		title: "Actions without nextNodeId",
		shortTitle: "Actions without a next node",
		items: (report) => report.actionsWithoutNextNode,
		count: (report) => report.actionsWithoutNextNodeCount,
	},
	{
		title: "Unreachable nodes",
		items: (report) => report.unreachableNodeIds,
	},
	{
		title: "Cycles",
		items: (report) => report.cycles.map((cycle) => cycle.join(" → ")),
	},
	{
		title: "Terminal nodes with actions/links",
		shortTitle: "Terminal node endpoint issues",
		items: (report) => report.invalidEndpointNodeIds,
	},
	{
		title: "Terminal or almost-never-reached actions with links",
		shortTitle: "Outcome actions with links",
		items: (report) => report.outcomeActionsWithLinks,
	},
	{
		title: "Almost-never-reached tags on nodes (move to actions)",
		shortTitle: "Misplaced rare node tags",
		items: (report) => report.misplacedRareNodeTags,
	},
	{
		title: "Node ID / position mismatches",
		shortTitle: "Position mismatches",
		items: (report, compact) =>
			report.positionMismatches.map(({ nodeId, idPosition, declaredPosition }) =>
				compact
					? nodeId
					: `${nodeId} (ID ends in ${idPosition}; position is ${declaredPosition})`
			),
	},
	{
		title: "Unfinished decision nodes",
		shortTitle: "Incomplete nodes",
		items: (report) => report.incompleteNodeIds,
	},
	{
		title: "Invalid or duplicate node IDs/positions",
		shortTitle: "Other tree issues",
		items: (report) => report.invalidNodeIds,
	},
];

// Returns the non-empty problem groups of a validateSolutionTree report.
// `compact` uses short titles and short item text for the DAG editor.
export function getValidationGroups(report, { compact = false } = {}) {
	return GROUPS.map((group) => {
		const items = group.items(report, compact);
		return {
			title: compact ? group.shortTitle || group.title : group.title,
			items,
			count: compact || !group.count ? items.length : group.count(report),
		};
	}).filter((group) => group.items.length > 0);
}
