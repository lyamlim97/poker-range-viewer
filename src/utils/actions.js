// Match action names with or without sizing amounts, ignoring case, spaces and hyphens.
// The CSS variables are defined at the top of App.css.
const KNOWN = {
	jam: "var(--action-jam)",
	allin: "var(--action-jam)",
	raise: "var(--action-raise)",
	bet: "var(--action-bet)",
	call: "var(--action-call)",
	fold: "var(--action-fold)",
};

export function actionColor(action) {
	const key = action.toLowerCase().replace(/[\s-]+/g, "");
	if (KNOWN[key]) return KNOWN[key];

	const baseAction = key.match(/^(jam|allin|raise|bet|call|fold)/)?.[1];
	if (baseAction && KNOWN[baseAction]) return KNOWN[baseAction];

	return "var(--action-other)";
}

const FOLD_RE = /^fold\b/i;
const CALL_RE = /^call\b/i;
const ALL_IN_RE = /^(?:allin|jam)\b/i;
// Actions are displayed from passive play through increasingly aggressive raises.
const ACTION_RANK_RES = [
	/^fold\b/i,
	/^call\b/i,
	/^(?:raise|bet)\b/i,
	/^(?:allin|jam)\b/i,
];
const AGGRESSIVE_RE = /^(?:raise|bet|allin|jam)/i;
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

	const actionRank = ACTION_RANK_RES.findIndex((re) => re.test(text));
	return {
		category: actionRank >= 0 ? actionRank : ACTION_RANK_RES.length,
		rank: 0,
		size: actionRank === 2 ? size : 0,
	};
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

export function compareActionsDescending(left, right) {
	return compareActions(right, left);
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
