import { useMemo } from "react";
import { validateSolutionTree } from "../utils/validateSolutionTree";
import { getValidationGroups } from "../utils/reports";

export default function TreeValidation({ solutionData, report: loadedReport }) {
	const report = useMemo(
		() => loadedReport || validateSolutionTree(solutionData),
		[loadedReport, solutionData]
	);
	const groups = getValidationGroups(report);

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
				Every action must have a rawRangeText string (an empty string is allowed
				for an intentionally empty range). Continuing action links must match
				their expected next node, and branches without a next node must end at a
				terminal or almost-never-reached action.
			</p>
			{groups.length === 0 ? (
				<p className="rv-tree-validation-empty">No structural issues found.</p>
			) : (
				<div className="rv-tree-validation-groups">
					{groups.map((group) => (
						<div className="rv-tree-validation-group" key={group.title}>
							<h3>{group.title} ({group.count})</h3>
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
