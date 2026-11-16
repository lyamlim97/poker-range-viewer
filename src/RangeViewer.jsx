import { useState, useMemo } from "react";
import RangeGrid from "./components/RangeGrid";
import ActionSummary from "./components/ActionSummary";
import HandDetail from "./components/HandDetail";
import PreflopNav from "./components/PreflopNav";
import SolutionModal from "./components/SolutionModal";
import { parseDetailedRange } from "./utils/parseRange";
import {
	POSITIONS_6MAX,
	getActionablePositions,
	getNextPosition,
	resolveSpotFromSolution,
} from "./utils/preflopTree";
import "./App.css";

const SCENARIO_TAG_LABELS = {
	"almost-never-reached": "Almost never reached",
};

export default function RangeViewer({ allFiles = {} }) {
	const availableSolutions = useMemo(
		() =>
			Object.entries(allFiles).flatMap(([path, data]) => {
				if (!path.includes("/solutions/")) return [];
				const fileName = path.split("/").pop().replace(".json", "");
				return [{
					id: fileName,
					rootPosition: getNextPosition([], data) || "EP",
					game: data?.meta?.game || "Missing",
					stack: data?.meta?.stack || "Missing",
					type: data?.meta?.type || "Missing",
					format: data?.meta?.format || fileName,
					rake: data?.meta?.rake || "Missing",
					open: data?.meta?.openSize || "Missing",
					threeBet: data?.meta?.threeBet || "Missing",
					cashDrop: data?.meta?.cashDrop || "-",
					fileKey: fileName,
					title: data?.meta?.title || "Missing",
					betSizeText: data?.meta?.betSize || fileName,
				}];
			}),
		[allFiles]
	);

	// Store the selection by key so updated JSON data can replace stale solution objects.
	const [selectedSolutionKey, setSelectedSolutionKey] = useState(
		() => availableSolutions[0]?.fileKey || availableSolutions[0]?.id
	);
	const selectedSolution =
		availableSolutions.find(
			(solution) =>
				solution.fileKey === selectedSolutionKey ||
				solution.id === selectedSolutionKey
		) || availableSolutions[0];
	const [isSolutionModalOpen, setIsSolutionModalOpen] = useState(false);

	// Retrieve ranges data for the active solution.
	// Important: the range viewer should read custom solution JSON files, not the legacy ranges-2x/ranges-2p5x scenario files.
	const key = selectedSolution?.fileKey || selectedSolution?.id || "example-solution";
	const currentRangesData = useMemo(() => {
		const matchingFile = Object.entries(allFiles).find(
			([path]) => path.split("/").pop().replace(/\.json$/, "") === key
		);
		return matchingFile?.[1] || Object.values(allFiles)[0] || {};
	}, [allFiles, key]);

	// The action path is chronological so a position can act more than once.
	const [activePosition, setActivePosition] = useState(
		() => availableSolutions[0]?.rootPosition || "EP"
	);
	const openSizeNumeric = selectedSolution?.open?.replace("x", "") || "2";
	const [actionPath, setActionPath] = useState([]);

	// Hand selection for GTO Wizard combo inspector
	const [selectedHand, setSelectedHand] = useState("AA");

	// Selecting a position that already acted rewinds to that decision.
	const handleSelectPosition = (posId) => {
		if (getActionablePositions(actionPath, currentRangesData).includes(posId)) {
			setActivePosition(posId);
			return;
		}

		for (let index = actionPath.length - 1; index >= 0; index -= 1) {
			if (actionPath[index].position === posId) {
				setActionPath(actionPath.slice(0, index));
				setActivePosition(posId);
				return;
			}
		}

		setActivePosition(posId);
	};

	const handleSelectAction = (nodeIndex, posId, action) => {
		let nextPath =
			nodeIndex < actionPath.length
				? actionPath.slice(0, nodeIndex)
				: [...actionPath];

		if (
			nodeIndex < actionPath.length &&
			actionPath[nodeIndex].position === posId &&
			actionPath[nodeIndex].action === action
		) {
			setActionPath(nextPath);
			setActivePosition(getNextPosition(nextPath, currentRangesData) || posId);
			return;
		}

		let nextActor = getNextPosition(nextPath, currentRangesData);
		let skipped = 0;
		while (
			nextActor &&
			nextActor !== posId &&
			getActionablePositions(nextPath, currentRangesData).includes(posId) &&
			skipped < POSITIONS_6MAX.length
		) {
			nextPath.push({ position: nextActor, action: "Fold" });
			nextActor = getNextPosition(nextPath, currentRangesData);
			skipped += 1;
		}

		if (nextActor !== posId) return;

		nextPath.push({ position: posId, action });
		setActionPath(nextPath);
		setActivePosition(getNextPosition(nextPath, currentRangesData) || posId);
	};

	// Compute scenario from preflop tree
	const scenario = useMemo(() => {
		return resolveSpotFromSolution(activePosition, actionPath, currentRangesData);
	}, [activePosition, actionPath, currentRangesData]);
	const scenarioTags = (scenario?.tags || []).map((id) => ({
		id,
		label: SCENARIO_TAG_LABELS[id] || id,
	}));
	const hasUnsavedRareStrategy = scenarioTags.some(
		({ id }) => id === "almost-never-reached"
	);

	// The solution resolver returns the strategy alongside its title and action path.
	const rawVal = scenario?.strategy;

	const { freq, comboFreq, allActions } = useMemo(
		() => parseDetailedRange(rawVal),
		[rawVal]
	);
	const referenceComboFreq = useMemo(
		() =>
			typeof scenario?.referenceRangeText === "string"
				? parseDetailedRange(scenario.referenceRangeText).comboFreq
				: null,
		[scenario?.referenceRangeText]
	);

	return (
		<div className="rv-container">
			{/* Top Navigation Bar: Solution Info & 6-Max Position Boxes */}
			<PreflopNav
				solutionInfo={{
					title: selectedSolution?.title || "Cash 100bb",
					format: selectedSolution?.format || "6max GG R&C",
					betSize: selectedSolution?.betSizeText || `With cold calls ${openSizeNumeric}x`,
				}}
				activePosition={activePosition}
				onSelectPosition={handleSelectPosition}
				actionPath={actionPath}
				actionablePositions={getActionablePositions(actionPath, currentRangesData)}
				onSelectAction={(index, position, action) =>
					handleSelectAction(index, position, action)
				}
				isTerminal={scenario?.terminal}
				isStrategyUnavailable={hasUnsavedRareStrategy}
				onChangeSolution={() => setIsSolutionModalOpen(true)}
				openSize={openSizeNumeric}
				solutionData={currentRangesData}
			/>

			{/* Sub-header showing scenario tags and action path */}
			<div className="rv-sub-bar">
				<div className="rv-spot-title">
					{scenarioTags.map(({ id, label }) => (
						<span className="rv-scenario-badge" key={id}>
							{label}
						</span>
					))}
					{scenario?.path && <span className="rv-title-path-dim">({scenario.path})</span>}
				</div>
				<div className="rv-table-status">
					Preflop Solution:{" "}
					<strong style={{ color: "var(--accent)" }}>
						{selectedSolution?.format || "Standard"}
					</strong>
				</div>
			</div>

			{/* Main Content Area: Grid on Left, Sidebar on Right */}
			<div className="rv-body">
				{scenario?.terminal ? (
					<div className="rv-terminal-state" role="status">
						<strong>Hand complete</strong>
						<span>Pot: {scenario.potSizeBB}bb</span>
					</div>
				) : hasUnsavedRareStrategy ? (
					<div className="rv-unavailable-strategy" role="status">
						<strong>Strategy not saved</strong>
						<span>
							The solution reaches this line in fewer than 1 in 10,000 hands, so
							its strategy was not saved.
						</span>
					</div>
				) : (
					<>
						{/* Left Column: 13x13 Grid */}
						<div className="rv-grid-column">
							<RangeGrid
								freq={freq}
								selectedHand={selectedHand}
								onHoverHand={setSelectedHand}
								onSelectHand={setSelectedHand}
								comboFreq={comboFreq}
								referenceComboFreq={referenceComboFreq}
								className="rv-range-grid"
							/>
						</div>

						{/* Right Column: GTO Wizard Sidebar */}
						<div className="rv-sidebar-column">
							{/* Top: Strategy Action Breakdown Cards */}
							<ActionSummary freq={freq} />

							{/* Bottom: Hand Inspector / Individual Combos Grid */}
							<HandDetail
								hand={selectedHand}
								handActions={freq[selectedHand] || {}}
								comboFreq={comboFreq}
								allActions={allActions}
							/>
						</div>
					</>
				)}
			</div>

			{/* Solution Selection Modal */}
			<SolutionModal
				isOpen={isSolutionModalOpen}
				onClose={() => setIsSolutionModalOpen(false)}
				solutions={availableSolutions}
				currentSolutionId={selectedSolution?.id}
				onSelectSolution={(sol) => {
					setSelectedSolutionKey(sol.fileKey || sol.id);
					setActivePosition(sol.rootPosition || "EP");
					setActionPath([]);
				}}
			/>
		</div>
	);
}
