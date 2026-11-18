// Match action names with or without sizing amounts, ignoring case, spaces and hyphens.
// The CSS variables are defined at the top of App.css.
const KNOWN = {
	jam: "var(--action-jam)",
	allin: "var(--action-jam)",
	raise: "var(--action-raise)",
	"3bet": "var(--action-3bet)",
	"4bet": "var(--action-4bet)",
	"5bet": "var(--action-5bet)",
	squeeze: "var(--action-squeeze)",
	bet: "var(--action-bet)",
	call: "var(--action-call)",
	fold: "var(--action-fold)",
};

// Any action not listed above gets one of these, picked from its name,
// so it always keeps the same colour.
const PALETTE = ["#f59e0b", "#a855f7", "#14b8a6", "#ec4899", "#84cc16", "#06b6d4"];

export function actionColor(action) {
	const key = action.toLowerCase().replace(/[\s-]+/g, "");
	if (KNOWN[key]) return KNOWN[key];

	const baseAction = key.match(/^(jam|allin|raise|3bet|4bet|5bet|squeeze|bet|call|fold)/)?.[1];
	if (baseAction && KNOWN[baseAction]) return KNOWN[baseAction];

	let hash = 0;
	for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
	return PALETTE[hash % PALETTE.length];
}

const FOLD_RE = /^fold\b/i;
const CALL_RE = /^call\b/i;
const ALL_IN_RE = /^(?:all[\s-]?in|jam)\b/i;
// Index in this list is the rank within the raise family.
const RAISE_RANK_RES = [
	/^5[\s-]?bet\b/i,
	/^4[\s-]?bet\b/i,
	/^3[\s-]?bet\b/i,
	/^squeeze\b/i,
	/^(?:raise|bet)\b/i,
];
const AGGRESSIVE_RE = /^(?:raise|bet|all[\s-]?in|jam|[345][\s-]?bet|squeeze)/i;
const AMOUNT_RE = /([\d.]+)\s*(?:bb)?\s*$/i;

export function getActionLabel(action) {
	return typeof action === "string" ? action : action?.label || action?.id || "Unnamed action";
}

export function getActionKey(action, index) {
	return typeof action === "object" && action?.id
		? action.id
		: `${getActionLabel(action)}-${index}`;
}

function getActionText(action) {
	return getActionLabel(action).trim();
}

export function isFold(action) {
	return FOLD_RE.test(getActionText(action));
}

export function isCall(action) {
	return CALL_RE.test(getActionText(action));
}

export function isAllIn(action) {
	return ALL_IN_RE.test(getActionText(action));
}

export function isAggressive(action) {
	return AGGRESSIVE_RE.test(getActionText(action));
}

export function getActionAmount(action) {
	const match = getActionText(action).match(AMOUNT_RE);
	if (!match) return null;
	const amount = Number(match[1]);
	return Number.isFinite(amount) ? amount : null;
}

export function classifyAction(action) {
	const text = getActionText(action);
	const size = getActionAmount(text) ?? 0;

	if (ALL_IN_RE.test(text)) return { category: 0, rank: 0, size };
	const raiseRank = RAISE_RANK_RES.findIndex((re) => re.test(text));
	if (raiseRank >= 0) return { category: 1, rank: raiseRank, size };
	if (CALL_RE.test(text)) return { category: 2, rank: 0, size };
	if (FOLD_RE.test(text)) return { category: 3, rank: 0, size: 0 };
	return { category: 4, rank: 0, size: 0 };
}

export function compareActions(left, right) {
	const leftDetails = classifyAction(left);
	const rightDetails = classifyAction(right);

	if (leftDetails.category !== rightDetails.category) {
		return leftDetails.category - rightDetails.category;
	}
	if (leftDetails.rank !== rightDetails.rank) {
		return leftDetails.rank - rightDetails.rank;
	}
	if (leftDetails.size !== rightDetails.size) {
		return leftDetails.size - rightDetails.size;
	}
	return getActionText(left).localeCompare(getActionText(right), undefined, {
		numeric: true,
		sensitivity: "base",
	});
}

export function getOrderedActions(actions) {
	if (!Array.isArray(actions)) return [];

	return actions
		.map((action, sourceIndex) => ({ action, sourceIndex }))
		.sort((left, right) =>
			compareActions(left.action, right.action) ||
			left.sourceIndex - right.sourceIndex
		)
		.map((entry, visualIndex) => ({
			...entry,
			visualIndex,
			key: getActionKey(entry.action, entry.sourceIndex),
		}));
}

export function getActionRange(action, node) {
	if (typeof action === "object" && typeof action?.rawRangeText === "string") {
		return action.rawRangeText;
	}
	const label = getActionLabel(action);
	return typeof node?.strategy?.[label] === "string"
		? node.strategy[label]
		: null;
}

export function getRangeStatus(action, node) {
	const rangeText = getActionRange(action, node);
	if (rangeText === null) return "Range needed";
	return rangeText.trim() ? "Range added" : "Empty range";
}

export function getRangeClass(status) {
	if (status === "Range added") return "complete";
	if (status === "Empty range") return "empty";
	return "incomplete";
}
