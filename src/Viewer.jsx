import { useState, useMemo } from "react";
import { FlaggedContext, checkSpot, findFlaggedSpots } from "./utils/checkRange";

import Section from "./components/Section";
import SpotSection from "./components/SpotSection";
import RangeGrid from "./components/RangeGrid";
import { parseRange } from "./utils/parseRange";
import { actionColor } from "./utils/actions";
import "./App.css";

const SECTIONS = ["RFI", "BB def", "vs 3Bet/5Bet", "3Bet/5Bet"];

const Pos = ({ children }) => <span className="pos">{children}</span>;
const Dim = ({ children }) => <span className="dim">{children}</span>;

const getNestedValue = (obj, path) => path.split(" > ").reduce((acc, key) => acc?.[key], obj);

const setNestedValue = (obj, path, value) => {
	const keys = path.split(" > ");
	const lastKey = keys.pop();
	const target = keys.reduce((acc, key) => {
		if (!acc[key]) acc[key] = {};
		return acc[key];
	}, obj);
	target[lastKey] = value;
};

function getHeading(id) {
	if (!id) return "Pick a scenario";
	const [section, a, b, c] = id.split(" > ");

	switch (section) {
		case "RFI":
			return <><Pos>{a}</Pos> <Dim>RFI</Dim></>;
		case "BB def":
			return <>BB Def vs <Pos>{a}</Pos></>;
		case "vs 3Bet/5Bet":
			return <><Pos>{a}</Pos> vs <Pos>{b}</Pos> <Dim>3Bet/5Bet</Dim></>;
		case "3Bet/5Bet":
			return <><Pos>{a}</Pos> <Dim>3Bet/5Bet</Dim> vs <Pos>{b}</Pos></>;
		case "SQUEEZE": {
			const callers = b.split("+");
			return (
				<>
					<Pos>{c}</Pos> <Dim>Squeeze</Dim> vs <Pos>{a}</Pos> RFI,{" "}
					<Pos>{callers.join(" + ")}</Pos>{" "}
					<Dim>call{callers.length === 1 ? "s" : ""}</Dim>
				</>
			);
		}
		case "Cold 4bet":
			return <><Pos>{c}</Pos> <Dim>Cold 4Bet</Dim> vs <Pos>{a}</Pos> RFI, <Pos>{b}</Pos> 3Bet</>;
	}
}

const summary = (items) => {
	const shown = items
		.slice(0, 8)
		.map(({ hand, total }) => `${hand} ${+(total * 100).toFixed(1)}%`)
		.join(", ");
	return items.length > 8 ? `${shown} +${items.length - 8} more` : shown;
};

function RangeCheck({ empty, over, under }) {
	if (empty) return <p className="range-check muted">No hands entered for this scenario yet</p>;
	if (!over.length && !under.length) {
		return <p className="range-check ok">✓ Every hand adds up to 100%</p>;
	}
	return (
		<div className="range-check warn">
			{over.length > 0 && <p><b>{over.length} over 100%:</b> {summary(over)}</p>}
			{under.length > 0 && <p><b>{under.length} under 100%:</b> {summary(under)}</p>}
		</div>
	);
}

export default function Viewer({ initialRanges, fileName }) {
	const [selected, setSelected] = useState(null);
	const [resetKey, setResetKey] = useState(0);
	const [rangesData, setRangesData] = useState(initialRanges);

	const rawVal = selected ? getNestedValue(rangesData, selected) : "";
	const freq = parseRange(rawVal);
	const { over, under } = checkSpot(freq);
	const flagged = useMemo(() => findFlaggedSpots(rangesData), [rangesData]);
	const pick = { selected, onSelect: setSelected };

	const handleReset = () => {
		setSelected(null);
		setResetKey((prev) => prev + 1);
		setRangesData(initialRanges);
	};

	const handleRangeChange = (action, value) => {
		setRangesData((prev) => {
			const updated = structuredClone(prev);
			setNestedValue(updated, `${selected} > ${action}`, value);
			return updated;
		});
	};

	const handleDownloadJson = () => {
		const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(rangesData, null, "\t"));
		const a = document.createElement("a");
		a.setAttribute("href", dataStr);
		a.setAttribute("download", fileName);
		document.body.appendChild(a);
		a.click();
		a.remove();
	};

	return (
		<FlaggedContext.Provider value={flagged}>
			<div className="app">
				<div className="panel">
					<div className="panel-header">
						<span className="panel-label">SCENARIOS</span>
						<button className="reset-btn" onClick={handleReset}>Reset All</button>
					</div>
					{SECTIONS.map((title) => (
						<Section key={title} title={title} data={rangesData[title]} {...pick} />
					))}
					<SpotSection
						key={`squeeze-${resetKey}`}
						title="SQUEEZE"
						note="Rows = Callers, Button = Squeezer"
						rowLabel={(callers) => callers}
						className="wide-labels"
						data={rangesData["SQUEEZE"]}
						{...pick}
					/>
					<SpotSection
						key={`cold4bet-${resetKey}`}
						title="Cold 4Bet"
						note="Button = 4Bettor"
						rowLabel={(p) => `${p} 3Bet`}
						data={rangesData["Cold 4Bet"]}
						{...pick}
					/>
				</div>

				<div className="viewer">
					<h1>{getHeading(selected)}</h1>
					<RangeGrid freq={freq} />
					{selected && (
						<RangeCheck empty={Object.keys(freq).length === 0} over={over} under={under} />
					)}

					{selected && typeof rawVal === "object" ? (
						<div className="range-editor-section">
							<div className="editor-header">
								<span>Edit ranges for this scenario</span>
								<button className="download-json-btn" onClick={handleDownloadJson}>Download updated ranges.json</button>
							</div>

							{Object.entries(rawVal).map(([action, text]) => (
								<label className="action-field" key={action}>
									<span className="action-name">
										<span className="swatch" style={{ background: actionColor(action) }} />
										{action}
									</span>
									<textarea
										className="range-textarea"
										value={text}
										onChange={(e) => handleRangeChange(action, e.target.value)}
										rows={2}
										placeholder="e.g. QQ+, AKs, [75.0]A9s[/75.0]"
									/>
								</label>
							))}
						</div>
					) : (
						<p className="range-text">Select a scenario above to view and edit its ranges.</p>
					)}
				</div>
			</div>
		</FlaggedContext.Provider>
	);
}