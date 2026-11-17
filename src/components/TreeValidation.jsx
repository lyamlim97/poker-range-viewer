import { useMemo } from "react";
import { validateSolutionTree } from "../utils/validateSolutionTree";

export default function TreeValidation({ solutionData }) {
	const report = useMemo(
		() => validateSolutionTree(solutionData),
		[solutionData]
	);
	const groups = [
		{
			title: `Missing node targets (${report.missingTargets.length})`,
			items: report.missingTargets.map(
				({ sourceNodeId, targetNodeId }) => `${sourceNodeId} → ${targetNodeId}`
			),
		},
		{
			title: `Wrongly linked nodes (${report.wronglyLinkedNodes.length})`,
			items: report.wronglyLinkedNodes.map(
				({ sourceNodeId, action, targetNodeId, expectedNodeId }) =>
					`${sourceNodeId} — ${action} → ${targetNodeId} (expected ${expectedNodeId || "no next node"})`
			),
		},
		{
			title: `Actions without nextNodeId (${report.actionsWithoutNextNodeCount})`,
			items: report.actionsWithoutNextNode,
		},
		{
			title: `Unreachable nodes (${report.unreachableNodeIds.length})`,
			items: report.unreachableNodeIds,
		},
		{
			title: `Cycles (${report.cycles.length})`,
			items: report.cycles.map((cycle) => cycle.join(" → ")),
		},
		{
			title: `Terminal nodes with actions/links (${report.invalidEndpointNodeIds.length})`,
			items: report.invalidEndpointNodeIds,
		},
		{
			title: `Terminal or almost-never-reached actions with links (${report.outcomeActionsWithLinks.length})`,
			items: report.outcomeActionsWithLinks,
		},
		{
			title: `Almost-never-reached tags on nodes (move to actions) (${report.misplacedRareNodeTags.length})`,
			items: report.misplacedRareNodeTags,
		},
		{
			title: `Unfinished decision nodes (${report.incompleteNodeIds.length})`,
			items: report.incompleteNodeIds,
		},
		{
			title: `Invalid or duplicate node IDs/positions (${report.invalidNodeIds.length})`,
			items: report.invalidNodeIds,
		},
	].filter((group) => group.items.length > 0);

	return (
		<section className="rv-tree-validation" aria-labelledby="rv-tree-validation-title">
			<div className="rv-tree-validation-header">
				<h2 id="rv-tree-validation-title">Tree validation</h2>
				<span
					className={`rv-tree-validation-status ${
						report.issueCount > 0 ? "has-issues" : "is-complete"
					}`}
				>
					{report.issueCount > 0
						? `${report.issueCount} ${report.issueCount === 1 ? "issue" : "issues"}`
						: "Complete"}
				</span>
			</div>
			<p className="rv-tree-validation-description">
				Each non-terminal action link must match its expected next node, and
				branches without a next node must end at a terminal action or an
				almost-never-reached action.
			</p>
			{groups.length === 0 ? (
				<p className="rv-tree-validation-empty">No structural issues found.</p>
			) : (
				<div className="rv-tree-validation-groups">
					{groups.map((group) => (
						<div className="rv-tree-validation-group" key={group.title}>
							<h3>{group.title}</h3>
							<ul className="rv-tree-validation-list">
								{group.items.map((item, index) => (
									<li key={`${item}-${index}`}>
										<code>{item}</code>
									</li>
								))}
							</ul>
						</div>
					))}
				</div>
			)}
		</section>
	);
}
