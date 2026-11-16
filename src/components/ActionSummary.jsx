import { actionColor } from "../utils/actions";

function combosFor(hand) {
	if (hand.length === 2) return 6;
	return hand.endsWith("s") ? 4 : 12;
}

function actionSortKey(action) {
	const raise = action.match(
		/^(raise|all[\s-]?in|jam|[345][\s-]?bet|squeeze)\s*([\d.]+)?\s*(?:bb)?/i
	);
	if (raise) {
		const size = Number(raise[2]);
		return [0, Number.isFinite(size) ? size : /^(all[\s-]?in|jam)/i.test(action) ? Infinity : 0];
	}
	if (/^call(?:\s|$)/i.test(action)) return [1, 0];
	if (/^fold(?:\s|$)/i.test(action)) return [2, 0];
	return [3, 0];
}

export default function ActionSummary({ freq = {} }) {
	const actions = {};

	if (!freq || typeof freq !== "object") {
		return <div className="rv-action-summary rv-empty-msg">No actions in this spot</div>;
	}

	for (const [hand, handActions] of Object.entries(freq)) {
		const max = combosFor(hand);
		for (const [action, frequency] of Object.entries(handActions)) {
			if (frequency <= 0) continue;
			if (!actions[action]) actions[action] = { combos: 0 };
			actions[action].combos += frequency * max;
		}
	}

	const entries = Object.entries(actions).sort(([a], [b]) => {
		const [aGroup, aSize] = actionSortKey(a);
		const [bGroup, bSize] = actionSortKey(b);
		return aGroup - bGroup || bSize - aSize;
	});
	const totalCombos = entries.reduce((sum, [, { combos }]) => sum + combos, 0);

	if (entries.length === 0) {
		return (
			<div className="rv-action-summary rv-empty-msg">No actions in this spot</div>
		);
	}

	return (
		<div className="rv-action-summary">
			<h3 className="rv-sidebar-heading">Actions</h3>
			<div className="rv-action-cards">
				{entries.map(([action, { combos }]) => {
					const pct = totalCombos > 0 ? (combos / totalCombos) * 100 : 0;
					return (
						<div
							key={action}
							className="rv-action-card"
							style={{ backgroundColor: actionColor(action) }}
						>
							<span className="rv-action-name">{action}</span>
							<span className="rv-action-pct">{pct.toFixed(1)}%</span>
							<span className="rv-action-combos">
								{combos.toFixed(1)} combos
							</span>
						</div>
					);
				})}
			</div>
			<div className="rv-action-bar-row">
				{entries.map(([action, { combos }]) => {
					const pct = totalCombos > 0 ? (combos / totalCombos) * 100 : 0;
					return (
						<div
							key={action}
							className="rv-action-bar-seg"
							style={{
								width: `${pct}%`,
								backgroundColor: actionColor(action),
							}}
						/>
					);
				})}
			</div>
		</div>
	);
}
