import { POSITION_IDS } from "./positions";
import { getActionLabel } from "./solutionAccessors";

export function getNodeIdPosition(nodeId) {
	return typeof nodeId === "string" ? nodeId.split("_").pop() : undefined;
}

// "EP_F_MP_RFI_CO" -> history [EP F, MP RFI], current position CO.
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
	return /^(?:RFI|SQZ|AI|\d+B)$/i.test(actionToken);
}

export function getActionToken(action, history) {
	const label = (getActionLabel(action) || "").trim();
	if (/^fold\b/i.test(label)) return "F";
	if (/^call\b/i.test(label)) return "C";
	if (/^check\b/i.test(label)) return "X";
	if (/^(?:all[\s-]*in|jam|AI)\b/i.test(label)) return "AI";
	if (/\b(?:squeeze|SQZ)\b/i.test(label)) return "SQZ";

	let lastAggressionIndex = -1;
	for (let index = history.length - 1; index >= 0; index--) {
		if (isAggressiveToken(history[index].actionToken)) {
			lastAggressionIndex = index;
			break;
		}
	}
	const callsAfterLastAggression = history
		.slice(lastAggressionIndex + 1)
		.some(({ actionToken }) => actionToken === "C");
	const raiseCount = history.filter(({ actionToken }) =>
		isAggressiveToken(actionToken)
	).length;
	const isSqueeze = raiseCount === 1 && callsAfterLastAggression;

	const numberedBet = label.match(/\b(\d+)\s*[- ]?\s*bet\b/i);
	if (numberedBet) {
		if (numberedBet[1] === "3" && isSqueeze) return "SQZ";
		return `${numberedBet[1]}B`;
	}
	const wordBet = label.match(/\b(three|four|five|six|seven|eight|nine)[\s-]*bet\b/i);
	if (wordBet) {
		const betNumbers = {
			three: 3,
			four: 4,
			five: 5,
			six: 6,
			seven: 7,
			eight: 8,
			nine: 9,
		};
		if (wordBet[1].toLowerCase() === "three" && isSqueeze) return "SQZ";
		return `${betNumbers[wordBet[1].toLowerCase()]}B`;
	}

	if (/^open\b/i.test(label)) return "RFI";
	if (/^raise\b/i.test(label)) {
		if (raiseCount === 0) return "RFI";
		if (isSqueeze) return "SQZ";
		return `${raiseCount + 2}B`;
	}

	return null;
}

export function actionMatchesToken(action, token) {
	const label = getActionLabel(action) ?? "";
	if (token === "F") return /^fold\b/i.test(label);
	if (token === "C") return /^call\b/i.test(label);
	if (token === "X") return /^check\b/i.test(label);
	if (token === "AI") return /^all[\s-]?in\b|^jam\b/i.test(label);
	if (token === "SQZ") return /^squeeze\b/i.test(label);
	if (/^RFI$/i.test(token)) return /^raise\b|^open\b/i.test(label);
	const bet = token.match(/^(\d+)B$/i);
	return bet ? new RegExp(`^${bet[1]}[ -]?bet\\b|^raise\\b`, "i").test(label) : false;
}
