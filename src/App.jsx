import { useState } from "react";
import Viewer from "./Viewer";

// Every file named src/data/ranges-<size>.json becomes a tab.
// e.g. ranges-2.5x.json -> a tab labelled "2.5x"
const files = import.meta.glob("./data/ranges-*.json", { eager: true, import: "default" });
// Your sizes, in the order you want the tabs. Anything not listed goes last.
const ORDER = ["2x", "2p5x", "3x"];
const rank = (label) => (ORDER.includes(label) ? ORDER.indexOf(label) : ORDER.length);
const TABS = Object.entries(files)
	.map(([path, ranges]) => ({
		label: path.match(/ranges-(.+)\.json$/)[1],
		file: path.split("/").pop(),
		ranges,
	}))
	// smallest size first: 2x, 2.5x, 3x
	.sort((a, b) => rank(a.label) - rank(b.label) || parseFloat(a.label) - parseFloat(b.label));

export default function App() {
	const [active, setActive] = useState(0);

	return (
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
	);
}
