import { RANKS } from "../utils/parseRange";
import { actionColor } from "../utils/actions";
import { checkHand } from "../utils/checkRange";

function handAt(row, col) {
	if (row === col) return RANKS[row] + RANKS[col];
	if (col > row) return RANKS[row] + RANKS[col] + "s";
	return RANKS[col] + RANKS[row] + "o";
}

function Cell({ hand, actions = {} }) {
	const type = hand.length === 2 ? "pair" : hand.endsWith("s") ? "suited" : "offsuit";

	// actions this hand takes, in the order they appear in ranges.json
	const entries = Object.entries(actions).filter(([, freq]) => freq > 0);

	// does this hand's total add up to 100%?
	const { total, status } = checkHand(actions);

	const tip = (entries.length > 0
		? `${hand} · ` + entries.map(([act, f]) => `${act}: ${Math.round(f * 100)}%`).join(", ")
		: `${hand} · Not in range`)
		+ (status ? ` · ⚠ total ${+(total * 100).toFixed(1)}%` : "");

	return (
		<div
			className={`cell ${type} ${entries.length === 0 ? "inactive" : ""} ${status ? `warn-${status}` : ""}`}
			data-tip={tip}
		>
			<div className="cell-bar-container">
				{entries.map(([action, freq]) => (
					<div
						key={action}
						className="action-bar"
						style={{ width: `${freq * 100}%`, backgroundColor: actionColor(action) }}
					/>
				))}
			</div>
			{type === "pair" && <div className="pair-ring" />}
			<span className="cell-hand">{hand}</span>
			{status && <span className="cell-warn">!</span>}
		</div>
	);
}

export default function RangeGrid({ freq }) {
	const cells = [];
	for (let row = 0; row < 13; row++) {
		for (let col = 0; col < 13; col++) {
			const hand = handAt(row, col);
			cells.push(<Cell key={hand} hand={hand} actions={freq[hand] || {}} />);
		}
	}
	return <div className="range-grid">{cells}</div>;
}
