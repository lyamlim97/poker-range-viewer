import { RANKS } from "../utils/parseRange";
import { actionColor } from "../utils/actions";
import { checkHand, checkHandAgainstRange } from "../utils/checkRange";

function handAt(row, col) {
	if (row === col) return RANKS[row] + RANKS[col];
	if (col > row) return RANKS[row] + RANKS[col] + "s";
	return RANKS[col] + RANKS[row] + "o";
}

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

function Cell({
	hand,
	actions = {},
	comboFreq = {},
	referenceComboFreq,
	isSelected = false,
	onHover,
	onSelect,
}) {
	const type = hand.length === 2 ? "pair" : hand.endsWith("s") ? "suited" : "offsuit";

	// Put aggressive actions first so their segments start at the left edge.
	const entries = Object.entries(actions)
		.filter(([, freq]) => freq > 0)
		.sort(([a], [b]) => actionPriority(a) - actionPriority(b));

	// does this hand's total add up to 100%?
	const { total, expected, status } = referenceComboFreq
		? checkHandAgainstRange(hand, comboFreq, referenceComboFreq)
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
}

export default function RangeGrid({
	freq = {},
	selectedHand,
	onHoverHand,
	onSelectHand,
	comboFreq = {},
	referenceComboFreq,
	className = "",
}) {
	const cells = [];
	for (let row = 0; row < 13; row++) {
		for (let col = 0; col < 13; col++) {
			const hand = handAt(row, col);
			cells.push(
				<Cell
					key={hand}
					hand={hand}
					actions={freq[hand] || {}}
					comboFreq={comboFreq}
					referenceComboFreq={referenceComboFreq}
					isSelected={selectedHand === hand}
					onHover={onHoverHand}
					onSelect={onSelectHand}
				/>
			);
		}
	}
	return <div className={`range-grid ${className}`}>{cells}</div>;
}
