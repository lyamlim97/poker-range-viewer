import { useEffect, useRef } from "react";
import {
	POSITIONS_6MAX,
	computePositionActionOptions,
	computePositionStack,
	getNextPosition,
} from "../utils/preflopTree";
import { actionColor } from "../utils/actions";

function ActionNode({
	index,
	position,
	stack,
	actions,
	selectedAction,
	isCurrent,
	isPreview,
	isSelected,
	isTerminal,
	onSelectAction,
	nodeRef,
}) {
	const stepLabel = isTerminal
		? "TERMINAL"
		: isCurrent
			? "NEXT"
			: isPreview
				? "IF FOLDED TO"
				: `#${index + 1}`;

	return (
		<article
			ref={nodeRef}
			className={`rv-tree-node ${isCurrent ? "current" : ""} ${isSelected ? "selected-position" : ""}`}
		>
			<div className="rv-tree-node-header">
				<span className="rv-tree-node-step">{stepLabel}</span>
				<strong className="rv-tree-node-position">{position}</strong>
				<span className="rv-tree-node-stack">{stack.toFixed(1).replace(/\.0$/, "")}</span>
			</div>
			<div className="rv-tree-node-actions">
				{actions.map((option) => {
					const isSelected = selectedAction === option.label;
					return (
						<button
							type="button"
							key={option.id}
							className={`rv-pos-act-item ${isSelected ? "selected-action" : ""}`}
							aria-pressed={isSelected}
							onClick={() => onSelectAction(index, position, option.label)}
							style={{
								"--node-action-color": actionColor(option.label),
							}}
						>
							{option.label}
						</button>
					);
				})}
			</div>
		</article>
	);
}

export default function PreflopNav({
	solutionInfo = {
		title: "Cash 100bb",
		format: "6max GG R&C",
		betSize: "With cold calls 2x",
	},
	activePosition = "EP",
	onSelectPosition,
	actionPath = [],
	actionablePositions = [],
	onSelectAction,
	onChangeSolution,
	onReloadSolution,
	openSize = "2",
	solutionData,
	isTerminal = false,
	isStrategyUnavailable = false,
}) {
	const currentNodeRef = useRef(null);
	const historyNodes = actionPath.map((node, index) => {
		const prefix = actionPath.slice(0, index);
		const position = POSITIONS_6MAX.find((seat) => seat.id === node.position);
		return {
			...node,
			index,
			actions: computePositionActionOptions(node.position, prefix, openSize, solutionData),
			stack: computePositionStack(node.position, prefix, position?.defaultStack),
		};
	});

	const previewNodes = [];
	let projectedPath = [...actionPath];
	for (let index = 0; index < POSITIONS_6MAX.length; index += 1) {
		const position = getNextPosition(projectedPath, solutionData);
		if (!position) break;

		const seat = POSITIONS_6MAX.find((item) => item.id === position);
		previewNodes.push({
			position,
			index: actionPath.length,
			actions: computePositionActionOptions(position, projectedPath, openSize, solutionData),
			stack: computePositionStack(position, projectedPath, seat?.defaultStack),
			isCurrent: index === 0,
			isPreview: index > 0,
			isSelected: activePosition === position,
		});
		if (isStrategyUnavailable) break;
		projectedPath = [...projectedPath, { position, action: "Fold" }];
	}

	const nodes = [...historyNodes, ...previewNodes];

	useEffect(() => {
		currentNodeRef.current?.scrollIntoView({
			behavior: "smooth",
			block: "nearest",
			inline: "end",
		});
	}, [actionPath.length, activePosition]);

	return (
		<div className="rv-preflop-nav">
			<div className="rv-solution-box">
				<div className="rv-sol-info">
					<div className="rv-sol-title">{solutionInfo.title}</div>
					<div className="rv-sol-bullet">• {solutionInfo.format}</div>
					<div className="rv-sol-bullet">• {solutionInfo.betSize}</div>
				</div>
				<div className="rv-sol-actions">
					<button className="rv-change-btn" onClick={onChangeSolution}>
						<span className="rv-gear-icon" aria-hidden="true">⚙</span> Change
					</button>
					<button
						className="rv-change-btn"
						onClick={onReloadSolution}
						aria-label="Reload selected solution"
						title="Reload selected solution JSON"
					>
						<span aria-hidden="true">↻</span> Reload
					</button>
				</div>
			</div>

			<section className="rv-tree-explorer" aria-label="Preflop action tree">
				<div className="rv-tree-toolbar">
					<div className="rv-tree-heading">
						Action sequence <span>Later seats assume earlier players fold; scroll for more</span>
					</div>
					<div className="rv-tree-seats" aria-label="Select a position">
						{POSITIONS_6MAX.map(({ id: position }) => {
							const isActionable = actionablePositions.includes(position);
							return (
								<button
									type="button"
									key={position}
									className={`rv-tree-seat ${isActionable ? "actionable" : "inactive"} ${activePosition === position ? "active" : ""}`}
									onClick={() => onSelectPosition?.(position)}
									aria-pressed={activePosition === position}
									aria-label={`${position}${isActionable ? ", can act" : ", jump to previous action"}`}
								>
									{position}
								</button>
							);
						})}
						{actionablePositions.length === 0 && (
							<span className="rv-tree-complete">
								{isStrategyUnavailable
									? "No saved actions beyond this node"
									: "No players left to act"}
							</span>
						)}
					</div>
				</div>

				<div className="rv-tree-nodes">
					{nodes.map((node) => (
						<ActionNode
							key={`${node.index}-${node.position}`}
							index={node.index}
							position={node.position}
							stack={node.stack}
							actions={node.actions}
							selectedAction={node.action}
							isCurrent={node.isCurrent}
							isPreview={node.isPreview}
							isSelected={node.isSelected}
							isTerminal={isTerminal && node.isCurrent}
							onSelectAction={onSelectAction}
							nodeRef={node.isCurrent || node.isSelected ? currentNodeRef : null}
						/>
					))}
				</div>
			</section>
		</div>
	);
}
