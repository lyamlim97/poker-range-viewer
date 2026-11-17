import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getActionKey, getActionLabel, getRangeClass, getRangeStatus } from "../utils/actionHelpers";
import {
	HEADER_HEIGHT,
	NODE_WIDTH,
	buildEdges,
	computeAutoLayout,
	getActionRowCenter,
	getNodeHeight,
} from "../utils/solutionGraph";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
const DRAG_THRESHOLD = 4;

const clampZoom = (value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

function loadPositions(storageKey) {
	try {
		return JSON.parse(localStorage.getItem(storageKey)) || {};
	} catch {
		return {};
	}
}

export default function DagCanvas({
	solution,
	layoutKey,
	selectedNodeId,
	selectedActionKey,
	canDeleteActions = false,
	problemNodeIds = new Set(),
	nodeIssues = {},
	onSelectNode,
	onSelectAction,
	onAddAction,
	onDeleteNode,
	onDeleteAction,
}) {
	const storageKey = `dag-positions:${layoutKey}`;
	const containerRef = useRef(null);
	const dragRef = useRef(null);
	const dragFrameRef = useRef(null);
	const pendingDragRef = useRef(null);
	const [positions, setPositions] = useState(() => loadPositions(storageKey));
	const [view, setView] = useState({ x: 40, y: 40, k: 1 });
	const [search, setSearch] = useState("");

	const nodes = solution.nodes;
	const nodeIds = useMemo(() => Object.keys(nodes), [nodes]);
	const autoLayout = useMemo(() => computeAutoLayout(solution), [solution]);
	const edges = useMemo(() => buildEdges(solution), [solution]);
	const getPosition = useCallback(
		(id) => positions[id] || autoLayout[id] || { x: 0, y: 0 },
		[positions, autoLayout]
	);

	const fitView = useCallback(
		(ids = nodeIds, layout = null) => {
			const container = containerRef.current;
			if (!container || ids.length === 0) return;
			let minX = Infinity;
			let minY = Infinity;
			let maxX = -Infinity;
			let maxY = -Infinity;
			for (const id of ids) {
				const position = layout?.[id] || getPosition(id);
				const height = getNodeHeight(nodes[id]?.actions?.length || 0);
				minX = Math.min(minX, position.x);
				minY = Math.min(minY, position.y);
				maxX = Math.max(maxX, position.x + NODE_WIDTH);
				maxY = Math.max(maxY, position.y + height);
			}
			const pad = 40;
			const { width, height } = container.getBoundingClientRect();
			const k = clampZoom(
				Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY), 1)
			);
			setView({
				k,
				x: (width - (maxX - minX) * k) / 2 - minX * k,
				y: (height - (maxY - minY) * k) / 2 - minY * k,
			});
		},
		[nodeIds, nodes, getPosition]
	);

	useLayoutEffect(() => {
		fitView();
		// Fit once when a solution is first shown; later edits must not move the camera.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return undefined;
		const onWheel = (event) => {
			event.preventDefault();
			const rect = container.getBoundingClientRect();
			const px = event.clientX - rect.left;
			const py = event.clientY - rect.top;
			setView((current) => {
				const k = clampZoom(current.k * Math.exp(-event.deltaY * 0.0015));
				const ratio = k / current.k;
				return { k, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
			});
		};
		container.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			container.removeEventListener("wheel", onWheel);
			if (dragFrameRef.current !== null) {
				cancelAnimationFrame(dragFrameRef.current);
			}
		};
	}, []);

	const centerOn = (id) => {
		const container = containerRef.current;
		if (!container) return;
		const position = getPosition(id);
		const height = getNodeHeight(nodes[id]?.actions?.length || 0);
		const rect = container.getBoundingClientRect();
		setView((current) => ({
			...current,
			x: rect.width / 2 - (position.x + NODE_WIDTH / 2) * current.k,
			y: rect.height / 2 - (position.y + height / 2) * current.k,
		}));
	};

	const handlePointerDown = (event) => {
		if (event.button !== 0 || event.target.closest("button, input")) return;
		const nodeElement = event.target.closest("[data-node-id]");
		if (nodeElement && !event.target.closest("[data-drag-handle]")) return;
		const id = nodeElement?.dataset.nodeId || null;
		if (id) onSelectNode(id);
		event.preventDefault();
		containerRef.current?.setPointerCapture(event.pointerId);
		dragRef.current = {
			id,
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			origin: id ? getPosition(id) : { x: view.x, y: view.y },
			active: false,
			zoom: view.k,
		};
	};

	const applyDrag = (pointer) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== pointer.pointerId) return;
		const dx = pointer.clientX - drag.startX;
		const dy = pointer.clientY - drag.startY;
		if (!drag.active) {
			if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
			drag.active = true;
		}
		if (drag.id) {
			setPositions((current) => {
				const next = {
					...current,
					[drag.id]: {
						x: drag.origin.x + dx / drag.zoom,
						y: drag.origin.y + dy / drag.zoom,
					},
				};
				return next;
			});
		} else {
			setView((current) => ({ ...current, x: drag.origin.x + dx, y: drag.origin.y + dy }));
		}
	};

	const handlePointerMove = (event) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		const dx = event.clientX - drag.startX;
		const dy = event.clientY - drag.startY;
		if (!drag.active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

		pendingDragRef.current = {
			pointerId: event.pointerId,
			clientX: event.clientX,
			clientY: event.clientY,
		};
		if (dragFrameRef.current === null) {
			dragFrameRef.current = requestAnimationFrame(() => {
				dragFrameRef.current = null;
				const pending = pendingDragRef.current;
				pendingDragRef.current = null;
				if (pending) applyDrag(pending);
			});
		}
	};

	const savePositions = (next) => {
		try {
			localStorage.setItem(storageKey, JSON.stringify(next));
		} catch {
			// Layout persistence is best-effort.
		}
	};

	const handlePointerUp = (event) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		if (dragFrameRef.current !== null) {
			cancelAnimationFrame(dragFrameRef.current);
			dragFrameRef.current = null;
		}
		const pending = pendingDragRef.current;
		pendingDragRef.current = null;
		if (pending) applyDrag(pending);
		dragRef.current = null;
		if (containerRef.current?.hasPointerCapture(event.pointerId)) {
			containerRef.current.releasePointerCapture(event.pointerId);
		}
		if (drag.active && drag.id) {
			setPositions((current) => {
				savePositions(current);
				return current;
			});
		}
	};

	const resetLayout = () => {
		setPositions({});
		savePositions({});
		fitView(nodeIds, autoLayout);
	};

	const query = search.trim().toLowerCase();
	const matches = (id) =>
		!query ||
		id.toLowerCase().includes(query) ||
		String(nodes[id]?.position || "").toLowerCase().includes(query);

	const zoomBy = (factor) => {
		const rect = containerRef.current.getBoundingClientRect();
		setView((current) => {
			const k = clampZoom(current.k * factor);
			const ratio = k / current.k;
			const px = rect.width / 2;
			const py = rect.height / 2;
			return { k, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
		});
	};

	return (
		<div className="dag-panel">
			<div className="dag-toolbar">
				<input
					type="search"
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== "Enter") return;
						const first = nodeIds.find(matches);
						if (first) {
							onSelectNode(first);
							centerOn(first);
						}
					}}
					placeholder="Find node, press Enter to jump"
					aria-label="Find a node or position"
				/>
				<span className="dag-toolbar-count">{nodeIds.length} nodes</span>
				<button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in">+</button>
				<button type="button" onClick={() => zoomBy(0.8)} aria-label="Zoom out">−</button>
				<button type="button" onClick={() => fitView()}>Fit</button>
				<button type="button" onClick={resetLayout}>Auto layout</button>
			</div>
			<div
				ref={containerRef}
				className="dag-canvas"
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerCancel={handlePointerUp}
			>
				<div
					className="dag-world"
					style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
				>
					<svg className="dag-edges" width="1" height="1">
						<defs>
							<marker id="dag-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
								<path d="M0 0L10 5L0 10z" fill="#5b6675" />
							</marker>
							<marker id="dag-arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
								<path d="M0 0L10 5L0 10z" fill="#f75454" />
							</marker>
						</defs>
						{edges.map((edge) => {
							const from = getPosition(edge.from);
							const to = getPosition(edge.to);
							const x1 = from.x + NODE_WIDTH;
							const y1 = getActionRowCenter(from, edge.actionIndex);
							const x2 = to.x;
							const y2 = to.y + HEADER_HEIGHT / 2;
							const bend = Math.max(50, Math.abs(x2 - x1) / 2);
							const active = edge.from === selectedNodeId || edge.to === selectedNodeId;
							return (
								<path
									key={edge.id}
									className={active ? "dag-edge active" : "dag-edge"}
									d={`M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`}
									markerEnd={`url(#${active ? "dag-arrow-active" : "dag-arrow"})`}
								/>
							);
						})}
					</svg>

					{nodeIds.map((id) => {
						const node = nodes[id];
						const actions = Array.isArray(node?.actions) ? node.actions : [];
						const position = getPosition(id);
						const classes = ["dag-node"];
						if (id === selectedNodeId) classes.push("selected");
						if (node?.terminal) classes.push("terminal");
						if (!matches(id)) classes.push("dimmed");
						if (problemNodeIds.has(id)) classes.push("problem");
						return (
							<div
								key={id}
								data-node-id={id}
								className={classes.join(" ")}
								style={{
									left: position.x,
									top: position.y,
									width: NODE_WIDTH,
									height: getNodeHeight(actions.length),
								}}
							>
								<div className="dag-node-header" data-drag-handle title={id}>
									<strong>{node?.position || id.split("_").pop()}</strong>
									{solution.rootNodeId === id && <span className="dag-tag">Root</span>}
									{node?.terminal && <span className="dag-tag muted">End</span>}
									{problemNodeIds.has(id) && (
										<span
											className="dag-tag warning"
											title={(nodeIssues[id] || [])
												.map((issue) => issue.message)
												.join("\n")}
										>
											⚠ {nodeIssues[id]?.length || 0}
										</span>
									)}
									<span className="dag-node-id">{id}</span>
								</div>
								<div className="dag-node-actions">
									{actions.length === 0 && (
										<div className="dag-node-empty" data-drag-handle>
											No actions yet
										</div>
									)}
									{actions.map((action, index) => {
										const key = getActionKey(action, index);
										const status = getRangeStatus(action, node);
										const target =
											action && typeof action === "object"
												? action.nextNodeId
												: "";
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
										return (
											<div
												key={key}
												className={
													id === selectedNodeId && key === selectedActionKey
														? "dag-action-row active"
														: "dag-action-row"
												}
											>
												<button
													type="button"
													className="dag-action"
													title={`${status}${target ? ` → ${target}` : ""}`}
													onClick={() => onSelectAction(id, key)}
												>
													<span className={`dag-dot ${getRangeClass(status)}`} />
													<span className="dag-action-label">{getActionLabel(action)}</span>
													{missingNextNode && (
														<span
															className="dag-action-badge warning"
															title="This range has no nextNodeId"
														>
															!
														</span>
													)}
													{isTerminalAction && (
														<span
															className="dag-action-badge terminal"
															title="Terminal action"
														>
															T
														</span>
													)}
													{isRareAction && (
														<span
															className="dag-action-badge rare"
															title="Almost never reached"
														>
															Rare
														</span>
													)}
													{target && <span className="dag-port" />}
												</button>
												<button
													type="button"
													className="dag-action-delete"
													onClick={() => onDeleteAction?.(id, key)}
													disabled={!canDeleteActions}
													aria-label={`Delete ${getActionLabel(action)} action`}
													title={`Delete ${getActionLabel(action)} action and range`}
												>
													×
												</button>
											</div>
										);
									})}
								</div>
								<div className="dag-node-footer">
									<button
										type="button"
										className="dag-add"
										onClick={() => onAddAction(id)}
										title="Add an action to this node"
									>
										+ Add
									</button>
									{solution.rootNodeId !== id && (
										<button
											type="button"
											className="dag-delete"
											onClick={() => onDeleteNode(id)}
											title="Delete this node"
										>
											Delete
										</button>
									)}
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
