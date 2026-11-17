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

function getActionSize(action) {
	const match = getActionText(action).match(/(\d+(?:\.\d+)?)\s*(?:bb)?\s*$/i);
	if (!match) return 0;
	const size = Number(match[1]);
	return Number.isFinite(size) ? size : 0;
}

function getRaiseRank(action) {
	const text = getActionText(action).toLowerCase();
	if (/^raise\b|^bet\b/i.test(text)) return 0;
	if (/^3[\s-]?bet\b/i.test(text)) return 1;
	if (/^4[\s-]?bet\b/i.test(text)) return 2;
	if (/^5[\s-]?bet\b/i.test(text)) return 3;
	if (/^squeeze\b/i.test(text)) return 4;
	return 5;
}

export function getActionSortDetails(action) {
	const normalized = getActionText(action).toLowerCase();

	if (/^fold\b/i.test(normalized)) {
		return { category: 0, rank: 0, size: 0 };
	}
	if (/^call\b/i.test(normalized)) {
		return { category: 1, rank: 0, size: getActionSize(action) };
	}
	if (
		/^raise\b/i.test(normalized) ||
		/^bet\b/i.test(normalized) ||
		/^3[\s-]?bet\b/i.test(normalized) ||
		/^4[\s-]?bet\b/i.test(normalized) ||
		/^5[\s-]?bet\b/i.test(normalized) ||
		/^squeeze\b/i.test(normalized)
	) {
		return { category: 2, rank: getRaiseRank(action), size: getActionSize(action) };
	}
	if (/^all[\s-]?in\b/i.test(normalized) || /^jam\b/i.test(normalized)) {
		return { category: 3, rank: 0, size: getActionSize(action) };
	}
	return { category: 4, rank: 0, size: 0 };
}

export function compareActions(left, right) {
	const leftDetails = getActionSortDetails(left);
	const rightDetails = getActionSortDetails(right);

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
