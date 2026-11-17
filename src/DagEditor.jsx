import { useEffect, useMemo, useRef, useState } from "react";
import DagCanvas from "./components/DagCanvas";
import { parseDetailedRange } from "./utils/parseRange";
import {
	getActionKey,
	getActionLabel,
	getActionRange,
	getRangeClass,
	getRangeStatus,
} from "./utils/actionHelpers";
import {
	getExpectedNextNodeId,
	validateSolutionTree,
} from "./utils/validateSolutionTree";
import "./App.css";

const EMPTY_SOLUTIONS = [];
const EMPTY_URLS = {};

const ACTION_TYPES = [
	{ id: "fold", label: "Fold", hasSize: false },
	{ id: "call", label: "Call", hasSize: false },
	{ id: "raise", label: "Raise", hasSize: true },
	{ id: "3-bet", label: "3-Bet", hasSize: true },
	{ id: "4-bet", label: "4-Bet", hasSize: true },
	{ id: "5-bet", label: "5-Bet", hasSize: true },
	{ id: "squeeze", label: "Squeeze", hasSize: true },
	{ id: "all-in", label: "All-in", hasSize: true, optionalSize: true },
];

function makeSlug(value) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "") || "action";
}

function makeUniqueActionId(label, actions) {
	const base = makeSlug(label);
	const usedIds = new Set(
		actions.map((action) =>
			typeof action === "object" && action?.id ? action.id : null
		)
	);
	let id = base;
	let suffix = 2;
	while (usedIds.has(id)) {
		id = `${base}-${suffix}`;
		suffix += 1;
	}
	return id;
}

function getSizeText(value) {
	const amount = Number(value);
	if (!Number.isFinite(amount) || amount <= 0) return null;
	return String(Number(amount.toFixed(2)));
}

function makeActionLabel(kind, size) {
	const type = ACTION_TYPES.find((item) => item.id === kind);
	if (!type) return null;
	if (!type.hasSize) return type.label;
	if (kind === "all-in" && !size.trim()) return type.label;
	const sizeText = getSizeText(size);
	if (!sizeText) return null;
	return `${type.label} ${sizeText}`;
}

function normalizeAction(action, index, actions) {
	if (typeof action !== "string") return action;
	return {
		id: makeUniqueActionId(action, actions.slice(0, index)),
		label: action,
	};
}

function updateNode(solution, nodeId, update) {
	const node = solution.nodes[nodeId];
	return {
		...solution,
		nodes: {
			...solution.nodes,
			[nodeId]: update(node),
		},
	};
}

function buildValidationGroups(report) {
	return [
		["Missing targets", report.missingTargets.map((item) => `${item.sourceNodeId} → ${item.targetNodeId}`)],
		["Action ranges needed", report.actionsWithoutRange],
		["Actions without a next node", report.actionsWithoutNextNode],
		["Wrongly linked actions", report.wronglyLinkedNodes.map((item) => `${item.sourceNodeId} → ${item.targetNodeId}`)],
		["Unreachable nodes", report.unreachableNodeIds],
		["Incomplete nodes", report.incompleteNodeIds],
		["Position mismatches", report.positionMismatches.map((item) => item.nodeId)],
		["Cycles", report.cycles.map((cycle) => cycle.join(" → "))],
		["Outcome actions with links", report.outcomeActionsWithLinks],
		["Misplaced rare node tags", report.misplacedRareNodeTags],
		["Terminal node endpoint issues", report.invalidEndpointNodeIds],
		["Other tree issues", report.invalidNodeIds],
	].filter(([, values]) => values.length > 0);
}

export default function DagEditor({
	solutionIndex = EMPTY_SOLUTIONS,
	solutionUrls = EMPTY_URLS,
}) {
	const [selectedSolutionId, setSelectedSolutionId] = useState(
		() => solutionIndex[0]?.id || ""
	);
	const [loadAttempt, setLoadAttempt] = useState(0);
	const [loadState, setLoadState] = useState({
		solutionId: solutionIndex[0]?.id || "",
		attempt: 0,
		status: "loading",
		data: null,
		error: null,
		diskRevision: null,
	});
	const [selectedNodeId, setSelectedNodeId] = useState("");
	const [selectedActionKey, setSelectedActionKey] = useState("");
	const [addFocusTick, setAddFocusTick] = useState(0);
	const addCardRef = useRef(null);
	const [newActionKind, setNewActionKind] = useState("raise");
	const [newActionSize, setNewActionSize] = useState("2.5");
	const [newActionOutcome, setNewActionOutcome] = useState("continue");
	const [addActionError, setAddActionError] = useState("");
	const [revision, setRevision] = useState(0);
	const [savedRevision, setSavedRevision] = useState(0);
	const [saveState, setSaveState] = useState({ status: "saved" });
	const [retrySave, setRetrySave] = useState(0);
	const [conflictRevision, setConflictRevision] = useState(null);
	const saveQueueRef = useRef(Promise.resolve());
	const canWriteFiles = import.meta.env.DEV;

	const loadMatchesSelection =
		loadState.solutionId === selectedSolutionId &&
		loadState.attempt === loadAttempt;
	const solution =
		loadMatchesSelection && loadState.status === "ready" ? loadState.data : null;
	const diskRevision = loadMatchesSelection ? loadState.diskRevision : null;
	const solutionMetadata = solutionIndex.find(
		(item) => item.id === selectedSolutionId
	);
	const isDirty = Boolean(solution && revision > savedRevision);
	const selectedNode = solution?.nodes?.[selectedNodeId] || null;
	const selectedActions = Array.isArray(selectedNode?.actions)
		? selectedNode.actions
		: [];
	const selectedActionIndex = selectedActions.findIndex(
		(action, index) => getActionKey(action, index) === selectedActionKey
	);
	const selectedAction =
		selectedActionIndex >= 0 ? selectedActions[selectedActionIndex] : null;
	const selectedRange = selectedAction
		? getActionRange(selectedAction, selectedNode)
		: null;
	const rangePreview = useMemo(
		() => (selectedRange?.trim() ? parseDetailedRange(selectedRange) : null),
		[selectedRange]
	);
	const selectedActionOutcome =
		selectedAction && typeof selectedAction === "object"
			? selectedAction.terminal
				? "terminal"
				: Array.isArray(selectedAction.tags) &&
				  selectedAction.tags.includes("almost-never-reached")
					? "rare"
					: "continue"
			: "continue";
	const selectedActionTarget =
		selectedAction &&
		typeof selectedAction === "object" &&
		typeof selectedAction.nextNodeId === "string"
			? selectedAction.nextNodeId
			: "";
	const expectedSelectedActionTarget =
		selectedAction
			? getExpectedNextNodeId(selectedNodeId, selectedAction)?.nodeId || ""
			: "";
	const continuationTargetOptions = useMemo(() => {
		if (!solution) return [];
		return [
			...new Set([
				expectedSelectedActionTarget,
				selectedActionTarget,
				...Object.keys(solution.nodes),
			]),
		].filter(Boolean);
	}, [
		solution,
		expectedSelectedActionTarget,
		selectedActionTarget,
	]);
	const validationReport = useMemo(
		() => (solution ? validateSolutionTree(solution) : null),
		[solution]
	);
	const missingRangeItems = validationReport?.actionsWithoutRange || [];
	const selectedNodeIssues =
		validationReport?.nodeIssues?.[selectedNodeId] || [];
	const validationGroups = validationReport
		? [
				...buildValidationGroups(validationReport),
			]
		: [];
	const otherTreeIssueCount = validationReport
		? validationReport.issueCount - validationReport.actionsWithoutRange.length
		: 0;

	const problemNodeIds = useMemo(() => {
		if (!validationReport) return new Set();
		return new Set(Object.keys(validationReport.nodeIssues || {}));
	}, [validationReport]);
	const actionLabel = makeActionLabel(newActionKind, newActionSize);
	const previewAction = actionLabel ? { label: actionLabel } : null;
	const nextNodePreview =
		selectedNode && previewAction
			? getExpectedNextNodeId(selectedNodeId, previewAction)?.nodeId || null
			: null;
	const selectedActionType = ACTION_TYPES.find(
		(item) => item.id === newActionKind
	);
	const effectiveOutcome =
		newActionOutcome === "continue" && !nextNodePreview
			? "terminal"
			: newActionOutcome;
	const currentLoadStatus = !loadMatchesSelection
		? "loading"
		: loadState.status;

	useEffect(() => {
		if (addFocusTick === 0) return;
		const card = addCardRef.current;
		if (!card) return;
		card.scrollIntoView({ behavior: "smooth", block: "nearest" });
		card.querySelector("select, button")?.focus({ preventScroll: true });
	}, [addFocusTick]);

	useEffect(() => {
		if (!selectedSolutionId) return undefined;

		let cancelled = false;
		const controller = new AbortController();
		const assetUrl =
			solutionUrls[`./data/solutions/${selectedSolutionId}.json`];

		async function loadSolution() {
			try {
				if (!canWriteFiles && !assetUrl) {
					throw new Error(
						`No solution file is registered for "${selectedSolutionId}".`
					);
				}

				const response = await fetch(
					canWriteFiles
						? `/__range-editor/load/${encodeURIComponent(selectedSolutionId)}`
						: assetUrl,
					{
						cache: "no-cache",
						signal: controller.signal,
					}
				);
				if (!response.ok) {
					throw new Error(
						`The solution file could not be loaded (HTTP ${response.status}).`
					);
				}

				const responseData = await response.json();
				const data = canWriteFiles
					? responseData.solution
					: responseData;
				if (
					!data ||
					typeof data !== "object" ||
					!data.nodes ||
					typeof data.nodes !== "object" ||
					Array.isArray(data.nodes)
				) {
					throw new Error("The solution must contain a nodes object.");
				}
				if (cancelled) return;

				setLoadState({
					solutionId: selectedSolutionId,
					attempt: loadAttempt,
					status: "ready",
					data,
					error: null,
					diskRevision: canWriteFiles ? responseData.revision : null,
				});
				setSelectedNodeId(
					typeof data.rootNodeId === "string" &&
						Object.hasOwn(data.nodes, data.rootNodeId)
						? data.rootNodeId
						: Object.keys(data.nodes)[0] || ""
				);
				setSelectedActionKey("");
				setRevision(0);
				setSavedRevision(0);
				setSaveState({ status: "saved" });
				setConflictRevision(null);
				setAddActionError("");
			} catch (error) {
				if (cancelled || error.name === "AbortError") return;
				setLoadState({
					solutionId: selectedSolutionId,
					attempt: loadAttempt,
					status: "error",
					data: null,
					error: error instanceof Error ? error.message : String(error),
					diskRevision: null,
				});
			}
		}

		loadSolution();
		return () => {
			cancelled = true;
			controller.abort();
		};
	}, [canWriteFiles, selectedSolutionId, solutionUrls, loadAttempt]);

	useEffect(() => {
		if (
			!canWriteFiles ||
			!solution ||
			revision <= savedRevision ||
			currentLoadStatus !== "ready"
		) {
			return undefined;
		}

		const snapshot = solution;
		const snapshotRevision = revision;
		const solutionId = selectedSolutionId;
		let cancelled = false;
		const timer = setTimeout(() => {
			setSaveState({ status: "saving", revision: snapshotRevision });
			const savePromise = saveQueueRef.current
				.catch(() => {})
				.then(async () => {
					const response = await fetch(
						`/__range-editor/save/${encodeURIComponent(solutionId)}`,
						{
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								solution: snapshot,
								expectedRevision: diskRevision,
							}),
						}
					);
					const result = await response.json().catch(() => null);
					if (!response.ok) {
						const error = new Error(
							result?.error || `Save failed (HTTP ${response.status}).`
						);
						error.code = result?.code;
						error.revision = result?.revision;
						throw error;
					}
					setLoadState((current) =>
						current.solutionId === solutionId
							? {
									...current,
									diskRevision: result?.revision || current.diskRevision,
								}
							: current
					);
				});
			saveQueueRef.current = savePromise;
			savePromise.then(
				() => {
					if (cancelled) return;
					setSavedRevision((current) =>
						Math.max(current, snapshotRevision)
					);
					setSaveState((current) =>
						current.revision === snapshotRevision
							? { status: "saved" }
							: current
					);
				},
				(error) => {
					if (cancelled) return;
					if (error.code === "FILE_CHANGED" && error.revision) {
						setConflictRevision(error.revision);
					}
					setSaveState({
						status:
							error.code === "FILE_CHANGED" ? "conflict" : "error",
						revision: snapshotRevision,
						error:
							error instanceof Error
								? error.message
								: "The solution could not be saved.",
					});
				}
			);
		}, 500);

		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [
		canWriteFiles,
		currentLoadStatus,
		revision,
		retrySave,
		savedRevision,
		selectedSolutionId,
		solution,
		diskRevision,
	]);

	function updateSolution(update) {
		setLoadState((current) => {
			if (
				current.status !== "ready" ||
				current.solutionId !== selectedSolutionId
			) {
				return current;
			}
			return { ...current, data: update(current.data) };
		});
		setRevision((current) => current + 1);
		setSaveState({ status: "dirty" });
	}

	function updateSelectedActionRange(value) {
		if (selectedActionIndex < 0) return;
		updateSolution((current) =>
			updateNode(current, selectedNodeId, (node) => {
				const actions = [...(Array.isArray(node.actions) ? node.actions : [])];
				const currentAction = normalizeAction(
					actions[selectedActionIndex],
					selectedActionIndex,
					actions
				);
				actions[selectedActionIndex] = {
					...currentAction,
					rawRangeText: value,
				};
				return { ...node, actions };
			})
		);
	}

	function deleteSelectedActionRange() {
		if (selectedActionIndex < 0) return;
		const label = getActionLabel(selectedAction);
		if (
			!window.confirm(
				`Delete the saved range for "${label}" on node "${selectedNodeId}"?`
			)
		) {
			return;
		}

		updateSolution((current) =>
			updateNode(current, selectedNodeId, (node) => {
				const actions = [...(Array.isArray(node.actions) ? node.actions : [])];
				const currentAction = actions[selectedActionIndex];
				const updatedAction =
					typeof currentAction === "object" && currentAction
						? { ...currentAction }
						: currentAction;
				if (typeof updatedAction === "object" && updatedAction) {
					delete updatedAction.rawRangeText;
				}
				actions[selectedActionIndex] = updatedAction;

				const nextNode = { ...node, actions };
				if (node.strategy && typeof node.strategy === "object") {
					const strategy = { ...node.strategy };
					delete strategy[label];
					if (Object.keys(strategy).length > 0) {
						nextNode.strategy = strategy;
					} else {
						delete nextNode.strategy;
					}
				}
				return nextNode;
			})
		);
	}

	function updateSelectedActionOutcome(outcome, targetNodeId = "") {
		if (selectedActionIndex < 0) return;
		const expected =
			getExpectedNextNodeId(selectedNodeId, selectedAction)?.nodeId || "";
		const existingTarget =
			selectedAction &&
			typeof selectedAction === "object" &&
			typeof selectedAction.nextNodeId === "string"
				? selectedAction.nextNodeId
				: "";
		const selectedTarget =
			targetNodeId ||
			(existingTarget && Object.hasOwn(solution.nodes, existingTarget)
				? existingTarget
				: expected);

		updateSolution((current) => {
			let next = updateNode(current, selectedNodeId, (node) => {
				const actions = [...(Array.isArray(node.actions) ? node.actions : [])];
				const currentAction = normalizeAction(
					actions[selectedActionIndex],
					selectedActionIndex,
					actions
				);
				const tags = Array.isArray(currentAction.tags)
					? currentAction.tags.filter(
							(tag) => tag !== "almost-never-reached"
						)
					: [];
				const updatedAction = { ...currentAction };

				delete updatedAction.nextNodeId;
				delete updatedAction.terminal;
				if (tags.length > 0) updatedAction.tags = tags;
				else delete updatedAction.tags;

				if (outcome === "terminal") {
					updatedAction.terminal = true;
				} else if (outcome === "rare") {
					updatedAction.tags = [
						...tags,
						"almost-never-reached",
					];
				} else if (outcome === "continue" && selectedTarget) {
					updatedAction.nextNodeId = selectedTarget;
				}

				actions[selectedActionIndex] = updatedAction;
				return { ...node, actions };
			});

			if (outcome === "continue" && selectedTarget) {
				if (Object.hasOwn(next.nodes, selectedTarget)) return next;
				const position = selectedTarget.split("_").pop();
				return {
					...next,
					nodes: {
						...next.nodes,
						[selectedTarget]: {
							nodeId: selectedTarget,
							position,
							actions: [],
						},
					},
				};
			}
			return next;
		});
		setSelectedActionKey(
			normalizeAction(
				selectedAction,
				selectedActionIndex,
				selectedActions
			)?.id || getActionKey(selectedAction, selectedActionIndex)
		);
		setAddActionError("");
	}

	function addAction(event) {
		event.preventDefault();
		setAddActionError("");

		if (!selectedNode || selectedNode.terminal === true) {
			setAddActionError("Reopen this terminal node before adding an action.");
			return;
		}
		if (!actionLabel) {
			setAddActionError("Enter a valid bet size greater than zero.");
			return;
		}
		if (
			selectedActions.some(
				(action) =>
					getActionLabel(action).toLowerCase() === actionLabel.toLowerCase()
			)
		) {
			setAddActionError("This action already exists on the selected node.");
			return;
		}
		if (effectiveOutcome === "continue" && !nextNodePreview) {
			setAddActionError("There is no next decision position to link to.");
			return;
		}

		const action = {
			id: makeUniqueActionId(actionLabel, selectedActions),
			label: actionLabel,
		};
		if (effectiveOutcome === "continue") {
			action.nextNodeId = nextNodePreview;
		} else if (effectiveOutcome === "terminal") {
			action.terminal = true;
		} else {
			action.tags = ["almost-never-reached"];
		}

		updateSolution((current) => {
			const currentNode = current.nodes[selectedNodeId];
			const actions = [
				...(Array.isArray(currentNode.actions) ? currentNode.actions : []),
				action,
			];
			let next = updateNode(current, selectedNodeId, (node) => ({
				...node,
				actions,
			}));

			if (
				effectiveOutcome === "continue" &&
				!Object.hasOwn(next.nodes, nextNodePreview)
			) {
				next = {
					...next,
					nodes: {
						...next.nodes,
						[nextNodePreview]: {
							nodeId: nextNodePreview,
							position: nextNodePreview.split("_").pop(),
							actions: [],
						},
					},
				};
			}
			return next;
		});
		setSelectedActionKey(action.id);
		setNewActionKind("raise");
		setNewActionSize("2.5");
		setNewActionOutcome("continue");
	}

	function reopenNode() {
		updateSolution((current) =>
			updateNode(current, selectedNodeId, (node) => ({
				...node,
				terminal: false,
				actions: Array.isArray(node.actions) ? node.actions : [],
			}))
		);
	}

	function deleteNode(nodeId) {
		if (!nodeId) return;
		if (nodeId === solution?.rootNodeId) {
			window.alert("The root node cannot be deleted.");
			return;
		}
		if (
			!window.confirm(
				`Delete node "${nodeId}" and unlink actions that point to it?`
			)
		) {
			return;
		}

		updateSolution((current) => {
			const nodes = Object.fromEntries(
				Object.entries(current.nodes).filter(([id]) => id !== nodeId)
			);
			for (const [id, originalNode] of Object.entries(nodes)) {
				const node = { ...originalNode };
				if (!Array.isArray(node.actions)) continue;
				node.actions = node.actions.map((action) => {
					if (
						typeof action === "object" &&
						action.nextNodeId === nodeId
					) {
						const updated = { ...action };
						delete updated.nextNodeId;
						updated.terminal = true;
						return updated;
					}
					return action;
				});
				nodes[id] = node;
			}
			return { ...current, nodes };
		});
		if (selectedNodeId === nodeId) {
			setSelectedNodeId("");
			setSelectedActionKey("");
		}
	}

	function deleteSelectedNode() {
		deleteNode(selectedNodeId);
	}

	function deleteAction(nodeId, actionKey) {
		if (!nodeId || !actionKey) return;
		const node = solution?.nodes?.[nodeId];
		const actions = Array.isArray(node?.actions) ? node.actions : [];
		const actionIndex = actions.findIndex(
			(action, index) => getActionKey(action, index) === actionKey
		);
		if (actionIndex < 0) return;
		const action = actions[actionIndex];
		const label = getActionLabel(action);
		if (
			!window.confirm(
				`Delete action "${label}" and its range from node "${nodeId}"?`
			)
		) {
			return;
		}

		updateSolution((current) =>
			updateNode(current, nodeId, (currentNode) => {
				const currentActions = Array.isArray(currentNode.actions)
					? [...currentNode.actions]
					: [];
				const currentIndex = currentActions.findIndex(
					(item, index) => getActionKey(item, index) === actionKey
				);
				if (currentIndex < 0) return currentNode;
				const removedAction = currentActions[currentIndex];
				const removedLabel = getActionLabel(removedAction);
				currentActions.splice(currentIndex, 1);

				const nextNode = { ...currentNode, actions: currentActions };
				if (currentNode.strategy && typeof currentNode.strategy === "object") {
					const strategy = { ...currentNode.strategy };
					delete strategy[removedLabel];
					if (Object.keys(strategy).length > 0) {
						nextNode.strategy = strategy;
					} else {
						delete nextNode.strategy;
					}
				}
				return nextNode;
			})
		);

		if (selectedNodeId === nodeId) {
			const remaining = actions.filter(
				(_, index) => index !== actionIndex
			);
			const nextAction =
				remaining[actionIndex] || remaining[actionIndex - 1] || null;
			setSelectedActionKey(
				nextAction
					? getActionKey(
							nextAction,
							remaining.findIndex((item) => item === nextAction)
						)
					: ""
			);
		}
	}

	function handleReload() {
		if (
			isDirty &&
			!window.confirm(
				"Reload the latest file from disk and discard unsaved DAG changes?"
			)
		) {
			return;
		}
		setLoadAttempt((current) => current + 1);
	}

	function overwriteExternalFile() {
		if (!conflictRevision) return;
		setLoadState((current) =>
			current.solutionId === selectedSolutionId
				? { ...current, diskRevision: conflictRevision }
				: current
		);
		setConflictRevision(null);
		setSaveState({ status: "dirty" });
		setRetrySave((current) => current + 1);
	}

	function reloadExternalFile() {
		const confirmed = window.confirm(
			"Reload the latest file from disk and discard the unsaved editor changes?"
		);
		if (!confirmed) return;
		setConflictRevision(null);
		setLoadAttempt((current) => current + 1);
	}

	function downloadLocalBackup() {
		if (!solution) return;
		const blob = new Blob(
			[`${JSON.stringify(solution, null, "\t")}\n`],
			{ type: "application/json" }
		);
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `${selectedSolutionId}-local-backup.json`;
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
	}

	function selectNode(id) {
		setSelectedNodeId(id);
		setSelectedActionKey("");
		setAddActionError("");
	}

	function handleSolutionChange(event) {
		const nextId = event.target.value;
		setSelectedSolutionId(nextId);
		setSelectedActionKey("");
	}

	const saveStatusText = !canWriteFiles
		? "File saving is available in the local development server."
		: saveState.status === "saving"
			? "Saving changes…"
			: saveState.status === "conflict"
				? "The file changed on disk; your edits were not overwritten."
			: saveState.status === "error"
				? `Save failed: ${saveState.error}`
				: isDirty
					? "Unsaved changes — saving automatically…"
					: "Saved automatically";
	const saveStatusClass =
		saveState.status === "error" || saveState.status === "conflict"
			? "error"
			: isDirty || saveState.status === "saving"
				? "pending"
				: "saved";

	return (
		<section className="range-editor">
			<header className="range-editor-header">
				<div>
					<h1>Range Tree</h1>
					<p>
						Drag nodes to arrange the tree, click an action to paste its range, or
						use + Add on a node to grow a new branch. Changes are saved to the
						selected JSON file automatically.
					</p>
				</div>
				<div className="range-editor-header-actions">
					{canWriteFiles && (
						<button
							type="button"
							className="range-editor-refresh"
							onClick={handleReload}
							title="Reload the solution from disk"
						>
							<svg
								className="range-editor-button-icon"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<path d="M20 6v5h-5" />
								<path d="M19 11a7.5 7.5 0 1 1-2.2-5.3L20 8" />
							</svg>
							<span>Reload</span>
						</button>
					)}
					<div className={`range-editor-save-status ${saveStatusClass}`} role="status">
						<span className="range-editor-status-dot" />
						<span>{saveStatusText}</span>
						{saveState.status === "error" && canWriteFiles && (
							<button
								type="button"
								className="range-editor-retry"
								onClick={() => setRetrySave((current) => current + 1)}
							>
								Retry
							</button>
						)}
						{saveState.status === "conflict" && canWriteFiles && (
							<>
								<button
									type="button"
									className="range-editor-retry"
									onClick={overwriteExternalFile}
								>
									Overwrite file
								</button>
								<button
									type="button"
									className="range-editor-retry"
									onClick={reloadExternalFile}
								>
									Reload from disk
								</button>
								<button
									type="button"
									className="range-editor-retry"
									onClick={downloadLocalBackup}
								>
									Download local backup
								</button>
							</>
						)}
					</div>
				</div>
			</header>

			<div className="range-editor-toolbar">
				<label htmlFor="range-editor-solution">Solution file</label>
				<select
					id="range-editor-solution"
					value={selectedSolutionId}
					onChange={handleSolutionChange}
					disabled={isDirty || saveState.status === "saving"}
				>
					{solutionIndex.map((item) => (
						<option key={item.id} value={item.id}>
							{item.title} ({item.id}.json)
						</option>
					))}
				</select>
				{solutionMetadata && (
					<span className="range-editor-file-hint">
						Editing <code>src/data/solutions/{selectedSolutionId}.json</code>
					</span>
				)}
			</div>

			{!canWriteFiles && (
				<div className="range-editor-notice">
					Autosave requires the local Vite development server. Open this page
					with <code>npm run dev</code> to edit solution files.
				</div>
			)}

			{currentLoadStatus === "loading" && (
				<div className="range-editor-message">Loading selected solution…</div>
			)}
			{currentLoadStatus === "error" && (
				<div className="range-editor-message error">
					<p>{loadState.error}</p>
					<button
						type="button"
						onClick={() => setLoadAttempt((current) => current + 1)}
					>
						Retry loading
					</button>
				</div>
			)}

			{solution && (
				<div className="range-editor-layout">
					<DagCanvas
						key={selectedSolutionId}
						solution={solution}
						layoutKey={selectedSolutionId}
						selectedNodeId={selectedNodeId}
						selectedActionKey={selectedActionKey}
						canDeleteActions={canWriteFiles}
						problemNodeIds={problemNodeIds}
						nodeIssues={validationReport?.nodeIssues || {}}
						onSelectNode={selectNode}
						onSelectAction={(nodeId, actionKey) => {
							setSelectedNodeId(nodeId);
							setSelectedActionKey(actionKey);
							setAddActionError("");
						}}
						onAddAction={(nodeId) => {
							selectNode(nodeId);
							setAddFocusTick((current) => current + 1);
						}}
						onDeleteNode={(nodeId) => {
							deleteNode(nodeId);
						}}
						onDeleteAction={(nodeId, actionKey) => {
							deleteAction(nodeId, actionKey);
						}}
					/>

					<main className="range-editor-main">
						{selectedNode ? (
							<>
								<section className="range-editor-card">
									<div className="range-editor-node-heading">
										<div>
											<div className="range-editor-eyebrow">
												{solution.rootNodeId === selectedNodeId
													? "Root decision"
													: "Decision node"}
											</div>
											<h2>{selectedNode.position || selectedNodeId.split("_").pop()}</h2>
										</div>
										{selectedNode.terminal === true ? (
											<button
												type="button"
												className="range-editor-secondary"
												onClick={reopenNode}
												disabled={!canWriteFiles}
											>
												Reopen as decision
											</button>
										) : (
											<span className="range-editor-count">
												{selectedActions.length} action
												{selectedActions.length === 1 ? "" : "s"}
											</span>
										)}
										<button
											type="button"
											className="range-editor-danger"
											onClick={deleteSelectedNode}
											disabled={
												!canWriteFiles ||
												selectedNodeId === solution?.rootNodeId
											}
											title={
												selectedNodeId === solution?.rootNodeId
													? "The root node cannot be deleted"
													: "Delete this node"
											}
										>
											<svg
												className="range-editor-button-icon"
												viewBox="0 0 24 24"
												aria-hidden="true"
											>
												<path d="M3 6h18" />
												<path d="M8 6V4h8v2" />
												<path d="M19 6l-1 14H6L5 6" />
												<path d="M10 10v6M14 10v6" />
											</svg>
											<span>Delete node</span>
										</button>
									</div>
									<code className="range-editor-node-path">{selectedNodeId}</code>
									{selectedNodeIssues.length > 0 && (
										<div className="range-editor-node-issues" role="status">
											<strong>
												⚠ {selectedNodeIssues.length} validation issue
												{selectedNodeIssues.length === 1 ? "" : "s"}
											</strong>
											<ul>
												{selectedNodeIssues.map((issue, index) => (
													<li
														key={`${issue.category}-${issue.action || issue.targetNodeId || index}`}
														className={`range-editor-node-issue ${issue.severity}`}
													>
														<span>{issue.category.replaceAll("-", " ")}</span>
														<p>{issue.message}</p>
													</li>
												))}
											</ul>
										</div>
									)}

									{selectedNode.terminal !== true && selectedActions.length > 0 && (
										<div className="range-editor-action-list">
											{selectedActions.map((action, index) => {
												const key = getActionKey(action, index);
												const label = getActionLabel(action);
												const target =
													typeof action === "object"
														? action.nextNodeId
														: null;
												const isTerminalAction =
													action &&
													typeof action === "object" &&
													action.terminal === true;
												const isRareAction =
													action &&
													typeof action === "object" &&
													Array.isArray(action.tags) &&
													action.tags.includes("almost-never-reached");
												const missingNextNode =
													action &&
													typeof action === "object" &&
													!isTerminalAction &&
													!isRareAction &&
													!(typeof target === "string" && target.trim());
												const selected = key === selectedActionKey;
												return (
													<div
														key={key}
														className={
															selected
																? "range-editor-action-item active"
																: "range-editor-action-item"
														}
													>
														<button
															type="button"
															className="range-editor-action"
															onClick={() => setSelectedActionKey(key)}
														>
															<span className="range-editor-action-top">
																<strong>{label}</strong>
																<span className="range-editor-action-badges">
																	{missingNextNode && (
																		<span
																			className="range-editor-action-badge warning"
																			title="This range has no nextNodeId"
																		>
																			⚠ No next node
																		</span>
																	)}
																	{isTerminalAction && (
																		<span className="range-editor-action-badge terminal">
																			Terminal
																		</span>
																	)}
																	{isRareAction && (
																		<span className="range-editor-action-badge rare">
																			Almost never reached
																		</span>
																	)}
																	<span
																		className={`range-editor-range-pill ${getRangeClass(getRangeStatus(action, selectedNode))}`}
																	>
																		{getRangeStatus(action, selectedNode)}
																	</span>
																</span>
															</span>
															<span className="range-editor-action-bottom">
																{typeof target === "string" && target
																	? `Next: ${target}`
																	: action &&
																	typeof action === "object" &&
																			action.terminal
																		? "Ends the hand"
																		: action &&
																		typeof action === "object" &&
																				Array.isArray(action.tags) &&
																				action.tags.includes(
																					"almost-never-reached"
																			)
																			? "Almost never reached"
																			: "No next node linked"}
															</span>
														</button>
														<button
															type="button"
															className="range-editor-action-delete"
															onClick={() => deleteAction(selectedNodeId, key)}
															disabled={!canWriteFiles}
															aria-label={`Delete ${label} action`}
															title={`Delete ${label} action and range`}
														>
															<svg
																className="range-editor-button-icon"
																viewBox="0 0 24 24"
																aria-hidden="true"
															>
																<path d="M3 6h18" />
																<path d="M8 6V4h8v2" />
																<path d="M19 6l-1 14H6L5 6" />
																<path d="M10 10v6M14 10v6" />
															</svg>
															<span>Delete</span>
														</button>
													</div>
												);
											})}
										</div>
									)}

									{selectedNode.terminal === true && (
										<p className="range-editor-help">
											This is a terminal node. Reopen it only if another
											preflop decision should follow.
										</p>
									)}
									{selectedNode.terminal !== true &&
										selectedActions.length === 0 && (
											<p className="range-editor-help">
												This node has no actions yet. Add the available actions
												below; continuation nodes are created automatically.
											</p>
										)}
								</section>

								{selectedAction && (
									<section className="range-editor-card">
										<div className="range-editor-card-heading">
											<div>
												<div className="range-editor-eyebrow">Selected action</div>
												<h3>{getActionLabel(selectedAction)}</h3>
											</div>
											<div className="range-editor-card-heading-actions">
												<span
													className={`range-editor-range-pill ${getRangeClass(getRangeStatus(selectedAction, selectedNode))}`}
												>
													{getRangeStatus(selectedAction, selectedNode)}
												</span>
												<button
													type="button"
													className="range-editor-danger range-editor-delete-action"
													onClick={() =>
														deleteAction(selectedNodeId, getActionKey(selectedAction, selectedActionIndex))
													}
													disabled={!canWriteFiles}
												>
													<svg
														className="range-editor-button-icon"
														viewBox="0 0 24 24"
														aria-hidden="true"
													>
														<path d="M3 6h18" />
														<path d="M8 6V4h8v2" />
														<path d="M19 6l-1 14H6L5 6" />
														<path d="M10 10v6M14 10v6" />
													</svg>
													<span>Delete action</span>
												</button>
											</div>
										</div>
										<label
											className="range-editor-field-label"
											htmlFor="range-editor-range-text"
										>
											Range text
										</label>
										<p className="range-editor-help">
											Paste the range copied for this exact action. The text is
											stored unchanged as <code>rawRangeText</code>.
										</p>
										<textarea
											id="range-editor-range-text"
											className="range-editor-range-input"
											value={selectedRange ?? ""}
											onChange={(event) =>
												updateSelectedActionRange(event.target.value)
											}
											disabled={!canWriteFiles}
											placeholder="Paste combos such as AsKd: 1, AhKh: 0.5, …"
											spellCheck="false"
										/>
										<div className="range-editor-range-footer">
											{rangePreview ? (
												<span>
													Recognized {Object.keys(rangePreview.freq).length} hands
													and {Object.keys(rangePreview.comboFreq).length} combos.
												</span>
											) : selectedRange?.trim() ? (
												<span className="warning">
													No range tokens were recognized. Check the pasted text.
												</span>
											) : selectedRange === "" ? (
												<span>This action is saved with an intentionally empty range.</span>
											) : (
												<span>Include the copied range, or mark it intentionally empty.</span>
											)}
											{selectedRange === null && (
												<button
													type="button"
													className="range-editor-secondary"
													onClick={() => updateSelectedActionRange("")}
													disabled={!canWriteFiles}
												>
													Mark empty range
												</button>
											)}
											{selectedRange !== null && (
												<button
													type="button"
													className="range-editor-secondary range-editor-delete-range"
													onClick={deleteSelectedActionRange}
													disabled={!canWriteFiles}
												>
													Delete range
												</button>
											)}
										</div>
										<div className="range-editor-destination range-editor-outcome-editor">
											<div className="range-editor-destination-heading">
												<strong>What happens after this action</strong>
												{canWriteFiles ? (
													<span>Changes save automatically</span>
												) : (
													<span>Editing requires the local dev server</span>
												)}
											</div>
											<label
												className="range-editor-field-label"
												htmlFor="range-editor-action-outcome"
											>
												Outcome
											</label>
											<select
												id="range-editor-action-outcome"
												value={selectedActionOutcome}
												onChange={(event) =>
													updateSelectedActionOutcome(event.target.value)
												}
												disabled={!canWriteFiles}
											>
												<option
													value="continue"
													disabled={!selectedActionTarget && !expectedSelectedActionTarget}
												>
													Continue to next decision
												</option>
												<option value="terminal">End the hand (terminal)</option>
												<option value="rare">Almost never reached</option>
											</select>

											{selectedActionOutcome === "continue" && (
												<>
													<label
														className="range-editor-field-label"
														htmlFor="range-editor-action-target"
													>
														Next node
													</label>
													<select
														id="range-editor-action-target"
														value={
															selectedActionTarget ||
															expectedSelectedActionTarget ||
															""
														}
														onChange={(event) =>
															updateSelectedActionOutcome(
																"continue",
																event.target.value
															)
														}
														disabled={!canWriteFiles}
													>
														{continuationTargetOptions.map((nodeId) => (
															<option key={nodeId} value={nodeId}>
																{nodeId}
																{nodeId === expectedSelectedActionTarget
																	? " (expected)"
																	: ""}
															</option>
														))}
													</select>
													{expectedSelectedActionTarget &&
														selectedActionTarget !==
															expectedSelectedActionTarget && (
															<p className="range-editor-help warning">
																This target differs from the expected node{" "}
																<code>{expectedSelectedActionTarget}</code>.
															</p>
														)}
													{!solution.nodes[selectedActionTarget] &&
														selectedActionTarget && (
															<p className="range-editor-help">
																The selected target node will be created automatically.
															</p>
														)}
													{selectedActionTarget &&
														solution.nodes[selectedActionTarget] && (
															<button
																type="button"
																className="range-editor-open-target"
																onClick={() => {
																	setSelectedNodeId(selectedActionTarget);
																	setSelectedActionKey("");
																}}
															>
																<span>Open target node</span>
																<svg
																	className="range-editor-button-icon"
																	viewBox="0 0 24 24"
																	aria-hidden="true"
																>
																	<path d="M5 12h14" />
																	<path d="m13 6 6 6-6 6" />
																</svg>
															</button>
														)}
												</>
											)}

											{selectedActionOutcome === "terminal" && (
												<p className="range-editor-help">
													This action will end the preflop hand.
												</p>
											)}
											{selectedActionOutcome === "rare" && (
												<p className="range-editor-help">
													This action will be retained but marked almost never reached.
												</p>
											)}
										</div>
									</section>
								)}

								<section className="range-editor-card" ref={addCardRef}>
									<div className="range-editor-card-heading">
										<div>
											<div className="range-editor-eyebrow">Build the tree</div>
											<h3>Add an action</h3>
										</div>
									</div>
									{selectedNode.terminal === true ? (
										<p className="range-editor-help">
											Reopen this node before adding actions.
										</p>
									) : (
										<form
											className="range-editor-add-form"
											onSubmit={addAction}
										>
											<label>
												Action
												<select
													value={newActionKind}
													onChange={(event) => {
														const kind = event.target.value;
														if (kind === "all-in" && newActionSize === "2.5") {
															setNewActionSize("100");
														} else if (
															newActionKind === "all-in" &&
															kind !== "all-in" &&
															newActionSize === "100"
														) {
															setNewActionSize("2.5");
														}
														setNewActionKind(kind);
													}}
												>
													{ACTION_TYPES.map((type) => (
														<option key={type.id} value={type.id}>
															{type.label}
														</option>
													))}
												</select>
											</label>
											{selectedActionType?.hasSize && (
												<label>
													{newActionKind === "all-in"
														? "All-in size (optional, bb)"
														: "Size (bb)"}
													<input
														type="number"
														min="0.01"
														step="0.01"
														value={newActionSize}
														onChange={(event) =>
															setNewActionSize(event.target.value)
														}
														placeholder={
															newActionKind === "all-in" ? "100" : "2.5"
														}
													/>
												</label>
											)}
											<label>
												After this action
												<select
													value={effectiveOutcome}
													onChange={(event) =>
														setNewActionOutcome(event.target.value)
													}
												>
													<option
														value="continue"
														disabled={!nextNodePreview}
													>
														Continue to next decision
													</option>
													<option value="terminal">End the hand</option>
													<option value="rare">Almost never reached</option>
												</select>
											</label>
											{actionLabel && (
												<div className="range-editor-id-preview">
													<span>Action label</span>
													<strong>{actionLabel}</strong>
													<span>Generated next node</span>
													<code>
														{effectiveOutcome === "continue"
															? nextNodePreview
															: effectiveOutcome === "terminal"
																? "Terminal action (no node)"
																: "Rare action (no node)"}
													</code>
												</div>
											)}
											{addActionError && (
												<p className="range-editor-form-error" role="alert">
													{addActionError}
												</p>
											)}
											<button
												type="submit"
												className="range-editor-primary"
												disabled={!actionLabel || !canWriteFiles}
											>
												<svg
													className="range-editor-button-icon"
													viewBox="0 0 24 24"
													aria-hidden="true"
												>
													<path d="M12 5v14M5 12h14" />
												</svg>
												<span>Add action</span>
											</button>
										</form>
									)}
									<p className="range-editor-help">
										The node ID is generated from the current path, action, and
										next position. Action labels determine the token (for example
										<code> F</code>, <code>RFI</code>, <code>3B</code>,{" "}
										<code>4B</code>, <code>SQZ</code>, or <code>AI</code>).
									</p>
								</section>
							</>
						) : (
							<div className="range-editor-message">
								Select a node to review its actions.
							</div>
						)}

						{validationReport && (
							<details className="range-editor-validation">
								<summary
									className={
										validationReport.issueCount === 0 &&
										missingRangeItems.length === 0
											? "valid"
											: "warning"
									}
								>
									{validationReport.issueCount === 0 &&
									missingRangeItems.length === 0
										? "Tree checks passed; all action ranges are present"
										: [
												otherTreeIssueCount > 0
													? `${otherTreeIssueCount} tree issue${otherTreeIssueCount === 1 ? "" : "s"}`
													: null,
												missingRangeItems.length > 0
													? `${missingRangeItems.length} action range${missingRangeItems.length === 1 ? "" : "s"} needed`
													: null,
											]
												.filter(Boolean)
												.join(" · ")}
								</summary>
								{validationGroups.length > 0 && (
									<ul>
										{validationGroups.map(([label, values]) => (
											<li key={label}>
												<strong>{label}:</strong> {values.length}
												<span>
													{" "}
													({values.slice(0, 3).join(", ")}
													{values.length > 3 ? ", …" : ""})
												</span>
											</li>
										))}
									</ul>
								)}
							</details>
						)}
					</main>
				</div>
			)}
		</section>
	);
}
