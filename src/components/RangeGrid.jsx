import { memo } from "react";
import { actionColor, compareActionsDescending } from "../utils/actions";
import { checkRangeConsistency } from "../utils/checkRange";
import { RANKS, getHandType, handAt } from "../utils/hands";

const EMPTY_ACTIONS = {};
const EMPTY_FREQ = {};

const HANDS = Array.from({ length: RANKS.length }, (_, row) =>
	Array.from({ length: RANKS.length }, (_, col) => handAt(row, col))
).flat();

const Cell = memo(function Cell({
	hand,
	actions = EMPTY_ACTIONS,
	comboFreq = EMPTY_FREQ,
	referenceComboFreq,
	isSelected = false,
	onHover,
	onSelect,
}) {
	const type = getHandType(hand);

	// Reverse the action hierarchy for horizontal range-bar segments.
	const entries = Object.entries(actions)
		.filter(([, freq]) => freq > 0)
		.sort(([a], [b]) => compareActionsDescending(a, b));

	// Compare against the prior action range when one is available.
	const { total, expected, status } = checkRangeConsistency({
		hand,
		freq: actions,
		comboFreq,
		referenceComboFreq,
	});

	const tip = (entries.length > 0
		? `${hand} · ` + entries.map(([act, f]) => `${act}: ${Math.round(f * 100)}%`).join(", ")
		: `${hand} · Not in range`)
		+ (status
			? ` · ⚠ total ${+(total * 100).toFixed(1)}%${
					referenceComboFreq
						? ` (expected ${+(expected * 100).toFixed(1)}%)`
						: ""
				}`
			: "");

	return (
		<div
			className={`cell ${type} ${entries.length === 0 ? "inactive" : ""} ${status ? `warn-${status}` : ""} ${isSelected ? "selected" : ""}`}
			data-tip={tip}
			onMouseEnter={() => onHover?.(hand)}
			onClick={() => onSelect?.(hand)}
		>
			<div className="cell-bar-container">
				{entries.map(([action, freq]) => (
					<div
						key={action}
						className="action-bar"
						style={{
							width: `${freq * 100}%`,
							backgroundColor: actionColor(action),
						}}
					/>
				))}
			</div>
			{type === "pair" && <div className="pair-ring" />}
			<span className="cell-hand">{hand}</span>
			{status && <span className="cell-warn">!</span>}
		</div>
	);
});

export default function RangeGrid({
	freq = EMPTY_FREQ,
	selectedHand,
	onHoverHand,
	onSelectHand,
	comboFreq = EMPTY_FREQ,
	referenceComboFreq,
	className = "",
}) {
	const cells = HANDS.map((hand) => (
		<Cell
			key={hand}
			hand={hand}
			actions={freq[hand] || EMPTY_ACTIONS}
			comboFreq={comboFreq}
			referenceComboFreq={referenceComboFreq}
			isSelected={selectedHand === hand}
			onHover={onHoverHand}
			onSelect={onSelectHand}
		/>
	));
	return <div className={`range-grid ${className}`}>{cells}</div>;
}
