import { useState, useMemo, useEffect, useRef } from "react";
import RangeGrid from "./components/RangeGrid";
import ActionSummary from "./components/ActionSummary";
import HandDetail from "./components/HandDetail";
import PreflopNav from "./components/PreflopNav";
import SolutionModal from "./components/SolutionModal";
import TreeValidation from "./components/TreeValidation";
import { parseSolutionStrategy } from "./utils/parseRange";
import {
	POSITIONS_6MAX,
	getActionablePositions,
	getNextPosition,
	getSolutionNodes,
	getSolutionNodeStrategy,
	isActionPathValid,
	resolveSpotFromSolution,
} from "./utils/preflopTree";
import "./App.css";

const EMPTY_SOLUTION_INDEX = [];
const EMPTY_SOLUTION_URLS = {};

function yieldToBrowser() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

async function copyTextToClipboard(text) {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// Fall through to the browser-compatible copy fallback.
	}

	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.setAttribute("readonly", "");
	textarea.style.position = "fixed";
	textarea.style.opacity = "0";
	document.body.appendChild(textarea);
	textarea.select();
	const copied = document.execCommand("copy");
	textarea.remove();
	return copied;
}

export default function RangeViewer({
	solutionIndex = EMPTY_SOLUTION_INDEX,
	solutionUrls = EMPTY_SOLUTION_URLS,
}) {
	const availableSolutions = solutionIndex;

	const [selectedSolutionKey, setSelectedSolutionKey] = useState(
		() => availableSolutions[0]?.id
	);
	const selectedSolution =
		availableSolutions.find((solution) => solution.id === selectedSolutionKey) ||
		availableSolutions[0];
	const [isSolutionModalOpen, setIsSolutionModalOpen] = useState(false);
	const [loadAttempt, setLoadAttempt] = useState(0);
	const [loadState, setLoadState] = useState({
		solutionKey: availableSolutions[0]?.id,
		attempt: 0,
		urls: solutionUrls,
		phase: "loading",
		progress: 0,
		parsedNodes: 0,
		totalNodes: 0,
		error: null,
	});
	const loadStateMatchesSelection =
		loadState.solutionKey === selectedSolutionKey &&
		loadState.attempt === loadAttempt &&
		loadState.urls === solutionUrls;
	const currentRangesData =
		loadStateMatchesSelection && loadState.phase === "ready"
			? loadState.data
			: null;
	// The action path is chronological so a position can act more than once.
	const [activePosition, setActivePosition] = useState(
		() => availableSolutions[0]?.rootPosition || "EP"
	);
	const [actionPath, setActionPath] = useState([]);
	const [selectedHand, setSelectedHand] = useState("AA");
	const [copiedNodeId, setCopiedNodeId] = useState(null);
	const reloadSnapshotRef = useRef(null);
	const copyResetRef = useRef(null);

	useEffect(() => {
		return () => {
			if (copyResetRef.current) clearTimeout(copyResetRef.current);
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		const controller = new AbortController();
		const solutionKey = selectedSolution?.id;
		const assetUrl = solutionKey
			? solutionUrls[`./data/solutions/${solutionKey}.json`]
			: null;

		async function loadSelectedSolution() {
			try {
				if (!assetUrl) {
					throw new Error(
						`No solution file is registered for "${solutionKey || "selection"}".`
					);
				}

				const response = await fetch(assetUrl, {
					cache: "no-cache",
					signal: controller.signal,
				});
				if (!response.ok) {
					throw new Error(`The solution file could not be loaded (HTTP ${response.status}).`);
				}

				const solutionData = await response.json();
				if (!solutionData || typeof solutionData !== "object") {
					throw new Error("The solution file must contain a JSON object.");
				}
				if (cancelled) return;

				const nodes = getSolutionNodes(solutionData) || {};
				const entries = Object.entries(nodes);
				setLoadState({
					solutionKey,
					attempt: loadAttempt,
					urls: solutionUrls,
					phase: "parsing",
					progress: entries.length === 0 ? 100 : 0,
					parsedNodes: 0,
					totalNodes: entries.length,
					error: null,
				});
				await yieldToBrowser();

				for (let index = 0; index < entries.length; index += 1) {
					if (cancelled) return;
					const node = entries[index][1];
					if (node && typeof node === "object") {
						parseSolutionStrategy(
							solutionData,
							getSolutionNodeStrategy(node)
						);
					}

					const parsedNodes = index + 1;
					setLoadState({
						solutionKey,
						attempt: loadAttempt,
						urls: solutionUrls,
						phase: "parsing",
						progress: Math.round((parsedNodes / entries.length) * 100),
						parsedNodes,
						totalNodes: entries.length,
						error: null,
					});
					await yieldToBrowser();
				}

				if (cancelled) return;
				const rootPosition =
					getNextPosition([], solutionData) ||
					selectedSolution?.rootPosition ||
					"EP";
				const reloadSnapshot = reloadSnapshotRef.current;
				const canRestorePath =
					reloadSnapshot?.solutionKey === solutionKey &&
					reloadSnapshot.actionPath.length > 0 &&
					isActionPathValid(
						reloadSnapshot.actionPath,
						solutionData
					) &&
					getNextPosition(reloadSnapshot.actionPath, solutionData) ===
						reloadSnapshot.nextPosition;

				if (canRestorePath) {
					setActivePosition(reloadSnapshot.activePosition);
					setActionPath(reloadSnapshot.actionPath);
				} else {
					setActivePosition(rootPosition);
					setActionPath([]);
				}
				reloadSnapshotRef.current = null;
				setLoadState({
					solutionKey,
					attempt: loadAttempt,
					urls: solutionUrls,
					phase: "ready",
					progress: 100,
					parsedNodes: entries.length,
					totalNodes: entries.length,
					data: solutionData,
					error: null,
				});
			} catch (error) {
				if (cancelled) return;
				setLoadState({
					solutionKey,
					attempt: loadAttempt,
					urls: solutionUrls,
					phase: "error",
					progress: 0,
					parsedNodes: 0,
					totalNodes: 0,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		void loadSelectedSolution();
		return () => {
			cancelled = true;
			controller.abort();
		};
	}, [selectedSolution, selectedSolutionKey, solutionUrls, loadAttempt]);

	const openSizeNumeric = selectedSolution?.open?.replace("x", "") || "2";
	const handleReloadSolution = () => {
		const nextAttempt = loadAttempt + 1;
		reloadSnapshotRef.current = {
			solutionKey: selectedSolutionKey,
			actionPath: actionPath.map((event) => ({ ...event })),
			activePosition,
			nextPosition: getNextPosition(actionPath, currentRangesData),
		};
		setLoadState({
			solutionKey: selectedSolutionKey,
			attempt: nextAttempt,
			urls: solutionUrls,
			phase: "loading",
			progress: 0,
			parsedNodes: 0,
			totalNodes: 0,
			error: null,
		});
		setLoadAttempt(nextAttempt);
	};

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
	const hasUnsavedRareStrategy = scenario?.tags?.includes("almost-never-reached") === true;
	const handleCopyNodeId = async () => {
		if (!scenario?.nodeId) return;
		const copied = await copyTextToClipboard(scenario.nodeId);
		if (!copied) return;

		setCopiedNodeId(scenario.nodeId);
		if (copyResetRef.current) clearTimeout(copyResetRef.current);
		copyResetRef.current = setTimeout(() => {
			setCopiedNodeId(null);
			copyResetRef.current = null;
		}, 1600);
	};

	// The solution resolver returns the strategy alongside its title and action path.
	const rawVal = scenario?.strategy;

	const { freq, comboFreq, allActions } = useMemo(
		() => parseSolutionStrategy(currentRangesData, rawVal),
		[currentRangesData, rawVal]
	);
	const referenceComboFreq = useMemo(
		() => {
			const referenceRange = scenario?.referenceRange;
			return referenceRange
				? parseSolutionStrategy(currentRangesData, referenceRange).comboFreq
				: null;
		},
		[currentRangesData, scenario]
	);
	const solutionModal = (
		<SolutionModal
			isOpen={isSolutionModalOpen}
			onClose={() => setIsSolutionModalOpen(false)}
			solutions={availableSolutions}
			currentSolutionId={selectedSolution?.id}
			onSelectSolution={(solution) => {
				reloadSnapshotRef.current = null;
				if (solution.id !== selectedSolutionKey) {
					setLoadState({
						solutionKey: solution.id,
						attempt: loadAttempt,
						urls: solutionUrls,
						phase: "loading",
						progress: 0,
						parsedNodes: 0,
						totalNodes: 0,
						error: null,
					});
				}
				setSelectedSolutionKey(solution.id);
				setActivePosition(solution.rootPosition || "EP");
				setActionPath([]);
			}}
		/>
	);

	if (!currentRangesData) {
		const phase = loadStateMatchesSelection ? loadState.phase : "loading";
		const error = loadStateMatchesSelection ? loadState.error : null;
		const progress = loadStateMatchesSelection ? loadState.progress : 0;
		const parsedNodes = loadStateMatchesSelection ? loadState.parsedNodes : 0;
		const totalNodes = loadStateMatchesSelection ? loadState.totalNodes : 0;

		return (
			<div className="rv-container">
				<section
					className="rv-solution-loading"
					role={phase === "error" ? "alert" : "status"}
					aria-live="polite"
				>
					<h2>{selectedSolution?.title || "Loading solution"}</h2>
					{phase === "error" ? (
						<p>{error}</p>
					) : phase === "parsing" ? (
						<p>
							Parsing ranges: {parsedNodes} of {totalNodes} nodes
							{totalNodes > 0 ? ` (${progress}%)` : ""}
						</p>
					) : (
						<p>Loading the selected solution file...</p>
					)}
					{phase !== "error" && (
						<progress
							aria-label="Loading selected solution"
							max="100"
							value={phase === "parsing" ? progress : undefined}
						/>
					)}
					{phase === "error" && (
						<button onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
							Retry
						</button>
					)}
					<button onClick={() => setIsSolutionModalOpen(true)}>
						Choose solution
					</button>
				</section>
				{solutionModal}
			</div>
		);
	}

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
				onReloadSolution={handleReloadSolution}
				openSize={openSizeNumeric}
				solutionData={currentRangesData}
			/>

			{/* Main Content Area: Grid on Left, Sidebar on Right */}
			<div className="rv-body">
				{scenario?.terminal ? (
					<div className="rv-terminal-state" role="status">
						<strong>Preflop over</strong>
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
							{scenario?.nodeId && (
								<div className="rv-node-id-row">
									<div className="rv-node-id-value">
										<span>Node ID</span>
										<code>{scenario.nodeId}</code>
									</div>
									<button
										type="button"
										className={`rv-node-id-copy ${copiedNodeId === scenario.nodeId ? "copied" : ""}`}
										onClick={handleCopyNodeId}
										aria-label={`Copy node ID ${scenario.nodeId}`}
									>
										{copiedNodeId === scenario.nodeId ? "Copied!" : "Copy"}
									</button>
								</div>
							)}

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

			<TreeValidation solutionData={currentRangesData} />

			{/* Solution Selection Modal */}
			{solutionModal}
		</div>
	);
}
