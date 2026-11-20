import { useEffect, useMemo, useRef, useState } from "react";
import DagCanvas from "./components/DagCanvas";
import ActionSummary from "./components/ActionSummary";
import {
	parseDetailedRange,
} from "./utils/parseRange";
import {
	checkNodeRangeConsistency,
} from "./utils/checkRange";
import {
	getActionKey,
	getActionLabel,
	getActionRange,
	getOrderedActions,
	getRangeClass,
	getRangeStatus,
	actionColor,
} from "./utils/actions";
import {
	RARE_TAG,
	getActionOutcome,
	getActionTarget,
	getNodeActions,
	getRootNodeId,
	getSolutionNodes,
	isRareAction,
	isTerminalAction,
} from "./utils/solutionAccessors";
import { getNodeIdPosition } from "./utils/nodeId";
import {
	getExpectedNextNodeId,
	validateSolutionTree,
} from "./utils/validateSolutionTree";
import {
	EMPTY_SOLUTION_INDEX,
	EMPTY_SOLUTION_URLS,
	fetchJson,
	getSolutionAssetUrl,
} from "./utils/solutionLoader";
import { normalizeSolution } from "./utils/normalizeSolution";
import { editorLoadUrl, editorSaveUrl } from "./utils/editorApi";
import { downloadJson } from "./utils/download";
import { describeRangeCheck, getValidationGroups } from "./utils/reports";
import { validateBasicSolutionStructure } from "./utils/saveValidation";
import { TrashIcon } from "./components/icons";
import "./App.css";

const ACTION_TYPES = [
	{ id: "fold", label: "Fold", hasSize: false },
	{ id: "call", label: "Call", hasSize: false },
	{ id: "raise", label: "Raise", hasSize: true },
	{ id: "all-in", label: "All-in", hasSize: true, optionalSize: true },
];

const GROUP_ACTION_PRESETS = [
	{ id: "fold-call", label: "Fold + Call", actions: ["fold", "call"] },
];

function makeSlug(value) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "") || "action";
}

function makeUniqueActionId(label, actions) {
	const base = makeSlug(label);
	const usedIds = new Set(actions.map((action) => action?.id));
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

function withPlaceholderNode(solution, nodeId) {
	if (Object.hasOwn(solution.nodes, nodeId)) return solution;
	return {
		...solution,
		nodes: {
			...solution.nodes,
			[nodeId]: { nodeId, position: getNodeIdPosition(nodeId), actions: [] },
		},
	};
}

function withoutStrategyLabel(node, label) {
	if (!node.strategy || typeof node.strategy !== "object") return node;
	const strategy = { ...node.strategy };
	delete strategy[label];
	const nextNode = { ...node };
	if (Object.keys(strategy).length > 0) nextNode.strategy = strategy;
	else delete nextNode.strategy;
	return nextNode;
}

const expectedTargetOf = (nodeId, action) =>
	getExpectedNextNodeId(nodeId, action)?.nodeId || "";

export default function DagEditor({
	solutionIndex = EMPTY_SOLUTION_INDEX,
	solutionUrls = EMPTY_SOLUTION_URLS,
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
	const groupCardRef = useRef(null);
	const [groupActionsOpen, setGroupActionsOpen] = useState(true);
	const [singleActionOpen, setSingleActionOpen] = useState(false);
	const [newActionKind, setNewActionKind] = useState("raise");
	const [newActionSize, setNewActionSize] = useState("2.5");
	const [newActionOutcome, setNewActionOutcome] = useState("continue");
	const [addActionError, setAddActionError] = useState("");
	const [groupPresetId, setGroupPresetId] = useState("fold-call");
	const [groupSelectedKinds, setGroupSelectedKinds] = useState(["fold", "call"]);
	const [groupSizes, setGroupSizes] = useState({
		raise: "2.5",
		"all-in": "",
	});
	const [groupAddError, setGroupAddError] = useState("");
	const [revision, setRevision] = useState(0);
	const [savedRevision, setSavedRevision] = useState(0);
	const [saveState, setSaveState] = useState({ status: "saved" });
	const [validationReport, setValidationReport] = useState(null);
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
	const selectedActions = useMemo(() => getNodeActions(selectedNode), [selectedNode]);
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
	const nodeRangeCheck = useMemo(() => {
		return solution
			? checkNodeRangeConsistency(solution, selectedNodeId)
			: null;
	}, [solution, selectedNodeId]);
	const selectedActionOutcome = getActionOutcome(selectedAction);
	const selectedActionTarget = getActionTarget(selectedAction);
	const expectedSelectedActionTarget = selectedAction
		? expectedTargetOf(selectedNodeId, selectedAction)
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
	const missingRangeItems = validationReport?.actionsWithoutRange || [];
	const selectedNodeIssues =
		validationReport?.nodeIssues?.[selectedNodeId] || [];
	const validationGroups = validationReport
		? getValidationGroups(validationReport, { compact: true })
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
			? expectedTargetOf(selectedNodeId, previewAction) || null
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
	const groupPreview = useMemo(() => {
		if (!selectedNode) return [];
		return groupSelectedKinds.map((kind) => {
			const size = groupSizes[kind] || "";
			const label = makeActionLabel(kind, size);
			if (!label) {
				return {
					kind,
					label: null,
					target: "",
					outcome: "invalid",
					duplicate: false,
				};
			}
			const target = expectedTargetOf(selectedNodeId, { label });
			const duplicate = selectedActions.some(
				(action) => getActionLabel(action).toLowerCase() === label.toLowerCase()
			);
			return {
				kind,
				label,
				target,
				outcome: target ? "continue" : "terminal",
				duplicate,
			};
		});
	}, [
		groupSelectedKinds,
		groupSizes,
		selectedActions,
		selectedNode,
		selectedNodeId,
	]);

	useEffect(() => {
		if (addFocusTick === 0) return;
		const card = groupCardRef.current || addCardRef.current;
		if (!card) return;
		card.scrollIntoView({ behavior: "smooth", block: "nearest" });
		card.querySelector("select, button")?.focus({ preventScroll: true });
	}, [addFocusTick]);

	useEffect(() => {
		if (!selectedSolutionId) return undefined;

		let cancelled = false;
		const controller = new AbortController();
		const assetUrl = getSolutionAssetUrl(solutionUrls, selectedSolutionId);

		async function loadSolution() {
			try {
				if (!canWriteFiles && !assetUrl) {
					throw new Error(
						`No solution file is registered for "${selectedSolutionId}".`
					);
				}

				const body = await fetchJson(
					canWriteFiles ? editorLoadUrl(selectedSolutionId) : assetUrl,
					{ signal: controller.signal }
				);
				const data = normalizeSolution(canWriteFiles ? body?.solution : body);
				const dataNodes = getSolutionNodes(data);
				if (!dataNodes) {
					throw new Error("The solution must contain a nodes object.");
				}
				if (cancelled) return;

				setLoadState({
					solutionId: selectedSolutionId,
					attempt: loadAttempt,
					status: "ready",
					data,
					error: null,
					diskRevision: canWriteFiles ? body.revision : null,
				});
				const rootNodeId = getRootNodeId(data);
				setSelectedNodeId(
					rootNodeId && Object.hasOwn(dataNodes, rootNodeId)
						? rootNodeId
						: Object.keys(dataNodes)[0] || ""
				);
				setSelectedActionKey("");
				setRevision(0);
				setSavedRevision(0);
				setSaveState({ status: "saved" });
				setValidationReport(null);
				setConflictRevision(null);
				setAddActionError("");
				setGroupPresetId("fold-call");
				setGroupSelectedKinds(["fold", "call"]);
				setGroupAddError("");
				setGroupActionsOpen(true);
				setSingleActionOpen(false);
				setGroupActionsOpen(true);
				setSingleActionOpen(false);
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
				.catch(() => { })
				.then(async () => {
					const report = validateSolutionTree(snapshot);
					setValidationReport(report);

					const structureError = validateBasicSolutionStructure(snapshot);
					if (structureError) {
						throw new Error(`Validation failed: ${structureError}`);
					}

					const response = await fetch(editorSaveUrl(solutionId), {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							solution: snapshot,
							expectedRevision: diskRevision,
						}),
					});
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
		}, 10000);

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
				const actions = [...getNodeActions(node)];
				actions[selectedActionIndex] = {
					...actions[selectedActionIndex],
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
				const actions = [...getNodeActions(node)];
				const updatedAction = { ...actions[selectedActionIndex] };
				delete updatedAction.rawRangeText;
				actions[selectedActionIndex] = updatedAction;
				return withoutStrategyLabel({ ...node, actions }, label);
			})
		);
	}

	function updateSelectedActionOutcome(outcome, targetNodeId = "") {
		if (selectedActionIndex < 0) return;
		const expected = expectedTargetOf(selectedNodeId, selectedAction);
		const existingTarget = getActionTarget(selectedAction);
		const selectedTarget =
			targetNodeId ||
			(existingTarget && Object.hasOwn(solution.nodes, existingTarget)
				? existingTarget
				: expected);

		updateSolution((current) => {
			const next = updateNode(current, selectedNodeId, (node) => {
				const actions = [...getNodeActions(node)];
				const currentAction = actions[selectedActionIndex];
				const tags = Array.isArray(currentAction.tags)
					? currentAction.tags.filter((tag) => tag !== RARE_TAG)
					: [];
				const updatedAction = { ...currentAction };

				delete updatedAction.nextNodeId;
				delete updatedAction.terminal;
				if (tags.length > 0) updatedAction.tags = tags;
				else delete updatedAction.tags;

				if (outcome === "terminal") {
					updatedAction.terminal = true;
				} else if (outcome === "rare") {
					updatedAction.tags = [...tags, RARE_TAG];
				} else if (outcome === "continue" && selectedTarget) {
					updatedAction.nextNodeId = selectedTarget;
				}

				actions[selectedActionIndex] = updatedAction;
				return { ...node, actions };
			});

			return outcome === "continue" && selectedTarget
				? withPlaceholderNode(next, selectedTarget)
				: next;
		});
		setSelectedActionKey(getActionKey(selectedAction, selectedActionIndex));
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
			action.tags = [RARE_TAG];
		}

		updateSolution((current) => {
			const currentNode = current.nodes[selectedNodeId];
			const next = updateNode(current, selectedNodeId, (node) => ({
				...node,
				actions: [...getNodeActions(currentNode), action],
			}));
			return effectiveOutcome === "continue"
				? withPlaceholderNode(next, nextNodePreview)
				: next;
		});
		setSelectedActionKey(action.id);
		setNewActionKind("raise");
		setNewActionSize("2.5");
		setNewActionOutcome("continue");
	}

	function applyGroupPreset(presetId) {
		setGroupAddError("");
		setGroupPresetId(presetId);
		if (presetId === "custom") {
			setGroupSelectedKinds([]);
			return;
		}
		const preset = GROUP_ACTION_PRESETS.find((item) => item.id === presetId);
		if (!preset) return;
		const availableKinds = preset.actions.filter((kind) => {
			const size = groupSizes[kind] || "";
			const label = makeActionLabel(kind, size);
			if (!label) return false;
			return !selectedActions.some(
				(action) =>
					getActionLabel(action).toLowerCase() === label.toLowerCase()
			);
		});
		setGroupSelectedKinds(availableKinds);
	}

	function toggleGroupKind(kind) {
		setGroupPresetId("custom");
		setGroupAddError("");
		setGroupSelectedKinds((current) =>
			current.includes(kind)
				? current.filter((item) => item !== kind)
				: [...current, kind]
		);
	}

	function updateGroupSize(kind, value) {
		setGroupSizes((current) => ({ ...current, [kind]: value }));
		setGroupAddError("");
	}

	function addActionGroup() {
		setGroupAddError("");
		if (!canWriteFiles) {
			setGroupAddError("Editing requires the local Vite development server.");
			return;
		}
		if (!selectedNode || selectedNode.terminal === true) {
			setGroupAddError("Reopen this terminal node before adding actions.");
			return;
		}
		if (groupSelectedKinds.length === 0) {
			setGroupAddError("Select at least one action.");
			return;
		}

		const usedActions = [...selectedActions];
		const additions = [];
		for (const kind of groupSelectedKinds) {
			const size = groupSizes[kind] || "";
			const label = makeActionLabel(kind, size);
			if (!label) {
				setGroupAddError("Enter a valid bet size greater than zero.");
				return;
			}
			if (
				usedActions.some(
					(action) =>
						getActionLabel(action).toLowerCase() === label.toLowerCase()
				)
			) {
				setGroupAddError(`This action already exists: ${label}.`);
				return;
			}

			const action = {
				id: makeUniqueActionId(label, usedActions),
				label,
			};
			const target = expectedTargetOf(selectedNodeId, action);
			if (target) {
				action.nextNodeId = target;
			} else {
				action.terminal = true;
			}
			additions.push(action);
			usedActions.push(action);
		}

		updateSolution((current) => {
			let next = updateNode(current, selectedNodeId, (node) => ({
				...node,
				actions: [...getNodeActions(node), ...additions],
			}));
			const targets = [
				...new Set(
					additions
						.map((action) => action.nextNodeId)
						.filter(Boolean)
				),
			];
			for (const target of targets) {
				next = withPlaceholderNode(next, target);
			}
			return next;
		});

		setSelectedActionKey(additions[0].id);
		setGroupPresetId("custom");
		setGroupSelectedKinds([]);
		setGroupAddError("");
	}

	function reopenNode() {
		updateSolution((current) =>
			updateNode(current, selectedNodeId, (node) => ({
				...node,
				terminal: false,
				actions: getNodeActions(node),
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
					if (action.nextNodeId === nodeId) {
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
		const actions = getNodeActions(node);
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
				const currentActions = [...getNodeActions(currentNode)];
				const currentIndex = currentActions.findIndex(
					(item, index) => getActionKey(item, index) === actionKey
				);
				if (currentIndex < 0) return currentNode;
				const [removedAction] = currentActions.splice(currentIndex, 1);
				return withoutStrategyLabel(
					{ ...currentNode, actions: currentActions },
					getActionLabel(removedAction)
				);
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
		downloadJson(solution, `${selectedSolutionId}-local-backup.json`);
	}

	function selectNode(id) {
		setSelectedNodeId(id);
		setSelectedActionKey("");
		setAddActionError("");
		setGroupPresetId("fold-call");
		setGroupSelectedKinds(["fold", "call"]);
		setGroupAddError("");
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
							setGroupActionsOpen(true);
							setAddFocusTick((current) => current + 1);
						}}
						onDeleteNode={deleteNode}
						onDeleteAction={deleteAction}
					/>

					<main className="range-editor-main">
						{selectedNode ? (
							<>
								<section className="range-editor-card">
									<div className="range-editor-node-heading">
										<div>
											<div className="range-editor-section-heading">
												{solution.rootNodeId === selectedNodeId
													? "Root Decision"
													: "Decision Node"}
											</div>
											<h2>{selectedNode.position || getNodeIdPosition(selectedNodeId)}</h2>
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
											<TrashIcon />
											<span>Delete node</span>
										</button>
									</div>
									<code className="range-editor-node-path">{selectedNodeId}</code>
									{selectedNode.terminal !== true && selectedActions.length > 0 && (
										<>
											{nodeRangeCheck && (() => {
												const { tone, text } = describeRangeCheck(nodeRangeCheck);
												return (
													<div
														className={`range-editor-range-check ${tone === "warning" ? "warning" : "ok"}`}
													>
														{text}
													</div>
												);
											})()}
											<ActionSummary
												freq={nodeRangeCheck?.rangeData?.freq || {}}
											/>
										</>
									)}
									{selectedNode.terminal !== true && selectedActions.length > 0 && (
										<div className="range-editor-action-list">
											{getOrderedActions(selectedActions).map(({ action, key }) => {
												const label = getActionLabel(action);
												const target = getActionTarget(action);
												const terminal = isTerminalAction(action);
												const rare = isRareAction(action);
												const missingNextNode = !terminal && !rare && !target.trim();
												const selected = key === selectedActionKey;
												return (
													<div
														key={key}
														className={
															selected
																? "range-editor-action-item active"
																: "range-editor-action-item"
														}
														style={{
															"--dag-action-color": actionColor(label),
														}}
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
																	{terminal && (
																		<span className="range-editor-action-badge terminal">
																			Terminal
																		</span>
																	)}
																	{rare && (
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
																{target
																	? `Next: ${target}`
																	: terminal
																		? "Ends the hand"
																		: rare
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
															<TrashIcon />
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

								<section
									className="range-editor-card range-editor-group-card"
									ref={groupCardRef}
								>
									<button
										type="button"
										className="range-editor-collapse-toggle"
										onClick={() => setGroupActionsOpen((open) => !open)}
										aria-expanded={groupActionsOpen}
									>
										<span className="range-editor-section-heading">Add actions</span>
										<span className="toggle-arrow" aria-hidden="true">
											{groupActionsOpen ? "▼" : "▶"}
										</span>
									</button>
									{groupActionsOpen && (selectedNode.terminal === true ? (
										<p className="range-editor-help">
											Reopen this node before adding actions.
										</p>
									) : (
										<>
											<div className="range-editor-group-presets">
												<span>Presets</span>
												<div className="range-editor-preset-buttons">
													{GROUP_ACTION_PRESETS.map((preset) => (
														<button
															key={preset.id}
															type="button"
															className={
																groupPresetId === preset.id
																	? "range-editor-preset-button active"
																	: "range-editor-preset-button"
															}
															onClick={() => applyGroupPreset(preset.id)}
															disabled={!canWriteFiles}
														>
															{preset.label}
														</button>
													))}
													<button
														type="button"
														className={
															groupPresetId === "custom"
																? "range-editor-preset-button active"
																: "range-editor-preset-button"
														}
														onClick={() => applyGroupPreset("custom")}
														disabled={!canWriteFiles}
													>
														Custom
													</button>
												</div>
											</div>

											<div className="range-editor-group-actions">
												{ACTION_TYPES.map((type) => {
													const size = groupSizes[type.id] || "";
													const label = makeActionLabel(type.id, size);
													const selected = groupSelectedKinds.includes(type.id);
													const existing = Boolean(
														label &&
														selectedActions.some(
															(action) =>
																getActionLabel(action).toLowerCase() ===
																label.toLowerCase()
														)
													);
													return (
														<div
															key={type.id}
															className={[
																"range-editor-group-action",
																selected ? "selected" : "",
																existing ? "existing" : "",
															].filter(Boolean).join(" ")}
															style={{
																"--dag-action-color": actionColor(label || type.label),
															}}
														>
															<input
																type="checkbox"
																checked={selected}
																onChange={() => toggleGroupKind(type.id)}
																disabled={!canWriteFiles || existing}
															/>
															<span className="range-editor-group-action-label">
																{type.label}
															</span>
															{existing && (
																<span className="range-editor-group-existing">
																	Already exists
																</span>
															)}
															{type.hasSize && selected && !existing && (
																<input
																	type="number"
																	min="0.01"
																	step="0.01"
																	className="range-editor-group-size"
																	value={size}
																	onChange={(event) =>
																		updateGroupSize(type.id, event.target.value)
																	}
																	placeholder={
																		type.optionalSize ? "Optional" : "2.5"
																	}
																	aria-label={`${type.label} size in big blinds`}
																/>
															)}
														</div>
													);
												})}
											</div>

											{groupPreview.length > 0 && (
												<div className="range-editor-group-preview">
													<span>Preview</span>
													{groupPreview.map((item) => (
														<div
															key={item.kind}
															className={
																item.duplicate || item.outcome === "invalid"
																	? "range-editor-group-preview-row warning"
																	: "range-editor-group-preview-row"
															}
														>
															<strong>{item.label || "Invalid size"}</strong>
															<span>
																{item.duplicate
																	? "Already exists"
																	: item.outcome === "invalid"
																		? "Enter a valid size"
																		: item.target
																			? `Continue to ${item.target}`
																			: "Terminal fallback"}
															</span>
														</div>
													))}
												</div>
											)}

											{groupAddError && (
												<p className="range-editor-group-error" role="alert">
													{groupAddError}
												</p>
											)}

											<div className="range-editor-group-footer">
												<button
													type="button"
													className="range-editor-secondary"
													onClick={() => {
														setGroupPresetId("custom");
														setGroupSelectedKinds([]);
														setGroupAddError("");
													}}
													disabled={!canWriteFiles}
												>
													Cancel
												</button>
												<button
													type="button"
													className="range-editor-primary"
													onClick={addActionGroup}
													disabled={
														!canWriteFiles ||
														groupSelectedKinds.length === 0 ||
														groupPreview.some(
															(item) =>
																!item.label ||
																item.duplicate
														)
													}
												>
													<svg
														className="range-editor-button-icon"
														viewBox="0 0 24 24"
														aria-hidden="true"
													>
														<path d="M12 5v14M5 12h14" />
													</svg>
													<span>
														Add {groupSelectedKinds.length} action
														{groupSelectedKinds.length === 1 ? "" : "s"}
													</span>
												</button>
											</div>
										</>
									))}
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
													<TrashIcon />
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
									<button
										type="button"
										className="range-editor-collapse-toggle"
										onClick={() => setSingleActionOpen((open) => !open)}
										aria-expanded={singleActionOpen}
									>
										<span className="range-editor-section-heading">Add an action</span>
										<span className="toggle-arrow" aria-hidden="true">
											{singleActionOpen ? "▼" : "▶"}
										</span>
									</button>
									{singleActionOpen && (selectedNode.terminal === true ? (
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
									))}
								</section>
								{selectedNodeIssues.length > 0 && (
									<details className="range-editor-node-issues">
										<summary>
											⚠ {selectedNodeIssues.length} validation issue
											{selectedNodeIssues.length === 1 ? "" : "s"}
										</summary>
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
									</details>
								)}
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
										: `⚠ ${[
											otherTreeIssueCount > 0
												? `${otherTreeIssueCount} tree issue${otherTreeIssueCount === 1 ? "" : "s"}`
												: null,
											missingRangeItems.length > 0
												? `${missingRangeItems.length} action range${missingRangeItems.length === 1 ? "" : "s"} needed`
												: null,
										]
											.filter(Boolean)
											.join(" · ")}`}
								</summary>
								{validationGroups.length > 0 && (
									<ul>
										{validationGroups.map(({ title, items }) => (
											<li key={title}>
												<strong>{title}:</strong> {items.length}
												<span>
													{" "}
													({items.slice(0, 3).join(", ")}
													{items.length > 3 ? ", …" : ""})
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
