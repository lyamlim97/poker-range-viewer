import { memo } from "react";
import { RANKS } from "../utils/parseRange";
import { actionColor } from "../utils/actions";
import { checkHand, checkHandAgainstRange } from "../utils/checkRange";

const EMPTY_ACTIONS = {};
const EMPTY_FREQ = {};

function handAt(row, col) {
	if (row === col) return RANKS[row] + RANKS[col];
	if (col > row) return RANKS[row] + RANKS[col] + "s";
	return RANKS[col] + RANKS[row] + "o";
}

const HANDS = Array.from({ length: 13 }, (_, row) =>
	Array.from({ length: 13 }, (_, col) => handAt(row, col))
).flat();

function isCallAction(action) {
	return /^call(?:\s|$)/i.test(action);
}

function actionPriority(action) {
	if (/^(raise|bet|all[\s-]?in|jam|[345][\s-]?bet|squeeze)(?:\s|$)/i.test(action)) return 0;
	if (isCallAction(action)) return 1;
	if (/^check(?:\s|$)/i.test(action)) return 2;
	if (/^fold(?:\s|$)/i.test(action)) return 3;
	return 4;
}

const Cell = memo(function Cell({
	hand,
	actions = EMPTY_ACTIONS,
	comboFreq = EMPTY_FREQ,
	referenceComboFreq,
	referenceAction,
	isSelected = false,
	onHover,
	onSelect,
}) {
	const type = hand.length === 2 ? "pair" : hand.endsWith("s") ? "suited" : "offsuit";

	// Put aggressive actions first so their segments start at the left edge.
	const entries = Object.entries(actions)
		.filter(([, freq]) => freq > 0)
		.sort(([a], [b]) => actionPriority(a) - actionPriority(b));

	// Compare against the prior action range when one is available.
	const { total, expected, status } = referenceComboFreq
		? checkHandAgainstRange(hand, comboFreq, referenceComboFreq, referenceAction)
		: checkHand(actions);

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
	referenceAction,
	className = "",
}) {
	const cells = HANDS.map((hand) => (
		<Cell
			key={hand}
			hand={hand}
			actions={freq[hand] || EMPTY_ACTIONS}
			comboFreq={comboFreq}
			referenceComboFreq={referenceComboFreq}
			referenceAction={referenceAction}
			isSelected={selectedHand === hand}
			onHover={onHoverHand}
			onSelect={onSelectHand}
		/>
	));
	return <div className={`range-grid ${className}`}>{cells}</div>;
}
