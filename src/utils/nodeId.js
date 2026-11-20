import { POSITION_IDS } from "./positions";
import { getActionLabel } from "./solutionAccessors";

export function getNodeIdPosition(nodeId) {
	return typeof nodeId === "string" ? nodeId.split("_").pop() : undefined;
}

// "EP_F_MP_R_CO" -> history [EP F, MP R], current position CO.
export function parseNodeId(nodeId) {
	if (typeof nodeId !== "string") return null;
	const parts = nodeId.split("_");
	if (parts.length % 2 === 0 || !POSITION_IDS.has(parts[parts.length - 1])) {
		return null;
	}

	const history = [];
	for (let index = 0; index < parts.length - 1; index += 2) {
		if (!POSITION_IDS.has(parts[index]) || !parts[index + 1]) return null;
		history.push({
			position: parts[index],
			actionToken: parts[index + 1],
			sourceNodeId: parts.slice(0, index + 1).join("_"),
		});
	}

	return { history, currentPosition: parts[parts.length - 1] };
}

export function isAggressiveToken(actionToken) {
	return /^(?:R|AI)$/i.test(actionToken);
}

export function getActionToken(action) {
	const label = (getActionLabel(action) || "").trim();
	if (/^fold\b/i.test(label)) return "F";
	if (/^call\b/i.test(label)) return "C";
	if (/^check\b/i.test(label)) return "X";
	if (/^(?:all[\s-]*in|jam|AI)\b/i.test(label)) return "AI";
	if (/^open\b/i.test(label) || /^raise\b/i.test(label)) return "R";

	return null;
}

export function actionMatchesToken(action, token) {
	const label = getActionLabel(action) ?? "";
	if (token === "F") return /^fold\b/i.test(label);
	if (token === "C") return /^call\b/i.test(label);
	if (token === "X") return /^check\b/i.test(label);
	if (token === "AI") return /^all[\s-]?in\b|^jam\b/i.test(label);
	if (/^R$/i.test(token)) return /^raise\b|^open\b/i.test(label);
	return false;
}
