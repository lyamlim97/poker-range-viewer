import { useState } from "react";
import Viewer from "./Viewer";
import RangeViewer from "./RangeViewer";

// Scenario tabs still use the legacy ranges files.
const scenarioFiles = import.meta.glob("./data/ranges-*.json", { eager: true, import: "default" });
// The range viewer should read from solution JSON files instead of the ranges-2x / ranges-2p5x files.
const viewerFiles = import.meta.glob("./data/solutions/*.json", { eager: true, import: "default" });

const ORDER = ["2x", "2p5x", "3x"];
const rank = (label) => (ORDER.includes(label) ? ORDER.indexOf(label) : ORDER.length);
const TABS = Object.entries(scenarioFiles)
	.map(([path, ranges]) => ({
		label: path.match(/ranges-(.+)\.json$/)[1],
		file: path.split("/").pop(),
		ranges,
	}))
	// smallest size first: 2x, 2.5x, 3x
	.sort((a, b) => rank(a.label) - rank(b.label) || parseFloat(a.label) - parseFloat(b.label));

export default function App() {
	const [active, setActive] = useState(0);
	const [mode, setMode] = useState("scenarios"); // "scenarios" | "range-viewer"

	return (
		<>
			<nav className="tabs">
				<div className="mode-toggle">
					<button
						className={mode === "scenarios" ? "mode-btn active" : "mode-btn"}
						onClick={() => setMode("scenarios")}
					>
						Scenarios
					</button>
					<button
						className={mode === "range-viewer" ? "mode-btn active" : "mode-btn"}
						onClick={() => setMode("range-viewer")}
					>
						Range Viewer
					</button>
				</div>
			</nav>

			{mode === "scenarios" && (
				<>
					<nav className="tabs">
						<span className="tabs-label">RFI size</span>
						{TABS.map((tab, i) => (
							<button
								key={tab.file}
								className={i === active ? "tab active" : "tab"}
								onClick={() => setActive(i)}
							>
								{tab.label}
							</button>
						))}
					</nav>

					{/* every tab stays mounted (just hidden) so edits and selections survive switching */}
					{TABS.map((tab, i) => (
						<div key={tab.file} hidden={i !== active}>
							<Viewer initialRanges={tab.ranges} fileName={tab.file} />
						</div>
					))}
				</>
			)}

			{mode === "range-viewer" && (
				<RangeViewer allFiles={viewerFiles} />
			)}
		</>
	);
}
