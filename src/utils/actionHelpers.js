export function getActionLabel(action) {
	return typeof action === "string" ? action : action?.label || action?.id || "Unnamed action";
}

export function getActionKey(action, index) {
	return typeof action === "object" && action?.id
		? action.id
		: `${getActionLabel(action)}-${index}`;
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
