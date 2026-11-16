// Colours for the actions in ranges.json (matched ignoring case, spaces and hyphens).
// The CSS variables are defined at the top of App.css.
const KNOWN = {
	jam: "var(--action-jam)",
	allin: "var(--action-jam)",
	raise: "var(--action-raise)",
	"3bet": "var(--action-raise)",
	"4bet": "var(--action-raise)",
	"5bet": "var(--action-raise)",
	squeeze: "var(--action-raise)",
	bet: "var(--action-bet)",
	call: "var(--action-call)",
	fold: "var(--action-fold)",
	check: "var(--action-fold)",
};

// Any action not listed above gets one of these, picked from its name,
// so it always keeps the same colour.
const PALETTE = ["#f59e0b", "#a855f7", "#14b8a6", "#ec4899", "#84cc16", "#06b6d4"];

export function actionColor(action) {
	const key = action.toLowerCase().replace(/[\s-]+/g, "");
	if (KNOWN[key]) return KNOWN[key];

	let hash = 0;
	for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
	return PALETTE[hash % PALETTE.length];
}
