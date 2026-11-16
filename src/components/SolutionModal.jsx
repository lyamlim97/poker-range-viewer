import { useState } from "react";
import rangeViewerConfig from "../data/range-viewer-config.json";

const defaultOptions = rangeViewerConfig?.options || {
	games: ["Cash"],
	players: ["6max", "Heads-up"],
	openSizes: ["Any", "2x", "2.3x", "2.5x", "3x"],
};

export default function SolutionModal({
	isOpen,
	onClose,
	solutions = [],
	currentSolutionId = "example-solution",
	onSelectSolution,
}) {
	const [gameFilter, setGameFilter] = useState(rangeViewerConfig?.defaults?.gameFilter || "Cash");
	const [playerFilter, setPlayerFilter] = useState(rangeViewerConfig?.defaults?.playerFilter || "6max");
	const [openSizeFilter, setOpenSizeFilter] = useState(rangeViewerConfig?.defaults?.openSizeFilter || "Any");

	if (!isOpen) return null;

	const filteredSolutions = solutions.filter((sol) => {
		if (gameFilter !== "Any" && sol.game && sol.game !== gameFilter) return false;
		if (openSizeFilter !== "Any" && sol.open !== openSizeFilter) return false;
		return true;
	});

	return (
		<div className="rv-modal-backdrop" onClick={onClose}>
			<div className="rv-modal-content" onClick={(e) => e.stopPropagation()}>
				{/* Modal Header */}
				<div className="rv-modal-header">
					<div className="rv-modal-title-row">
						<h2>Solutions</h2>
						<button className="rv-modal-close-btn" onClick={onClose}>
							✕
						</button>
					</div>
					<div className="rv-modal-banner">
						<span className="rv-banner-icon">ℹ</span>
						<span>
							Select preflop solutions. Configure depth, rake, open sizing and formats.
						</span>
					</div>
				</div>

				{/* Filter Controls */}
				<div className="rv-modal-filters">
					<div className="rv-filter-group">
						<span className="rv-filter-label">Game</span>
						<div className="rv-filter-buttons">
							{(defaultOptions.games || []).map((g) => (
								<button
									key={g}
									className={`rv-fbtn ${gameFilter === g ? "active" : ""}`}
									onClick={() => setGameFilter(g)}
								>
									{g}
								</button>
							))}
						</div>
					</div>

					<div className="rv-filter-group">
						<span className="rv-filter-label">Players</span>
						<div className="rv-filter-buttons">
							{(defaultOptions.players || []).map((p) => (
								<button
									key={p}
									className={`rv-fbtn ${playerFilter === p ? "active" : ""}`}
									onClick={() => setPlayerFilter(p)}
								>
									{p}
								</button>
							))}
						</div>
					</div>

					<div className="rv-filter-group">
						<span className="rv-filter-label">Opening size</span>
						<div className="rv-filter-buttons">
							{(defaultOptions.openSizes || []).map((s) => (
								<button
									key={s}
									className={`rv-fbtn ${openSizeFilter === s ? "active" : ""}`}
									onClick={() => setOpenSizeFilter(s)}
								>
									{s}
								</button>
							))}
						</div>
					</div>
				</div>

				{/* Solutions Table */}
				<div className="rv-solutions-table-wrap">
					<table className="rv-solutions-table">
						<thead>
							<tr>
								<th>Stack</th>
								<th>Type</th>
								<th>Rake</th>
								<th>Open</th>
								<th>3bet</th>
								<th>Cash drop</th>
								<th>Select</th>
							</tr>
						</thead>
						<tbody>
							{filteredSolutions.map((sol) => {
								const isSelected = sol.id === currentSolutionId;
								return (
									<tr
										key={sol.id}
										className={isSelected ? "selected-row" : ""}
										onClick={() => {
											onSelectSolution?.(sol);
											onClose();
										}}
									>
										<td className="rv-td-stack">{sol.stack}</td>
										<td>{sol.type}</td>
										<td>{sol.rake}</td>
										<td>{sol.open}</td>
										<td>{sol.threeBet}</td>
										<td>{sol.cashDrop || "-"}</td>
										<td>
											<button className={`rv-sol-select-btn ${isSelected ? "active" : ""}`}>
												{isSelected ? "Active" : "Load"}
											</button>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}
