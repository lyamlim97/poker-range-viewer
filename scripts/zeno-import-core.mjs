const POSITIONS = ["EP", "MP", "CO", "BU", "SB", "BB"];
const POSITION_SET = new Set(POSITIONS);
const RANKS = [..."23456789TJQKA"];
const SUITS = [..."cdhs"];

export const ZENO_POSITION_MAP = Object.freeze({
	UTG: "EP",
	HJ: "MP",
	CO: "CO",
	BTN: "BU",
	SB: "SB",
	BB: "BB",
});

const META_FIELDS = [
	"title",
	"game",
	"stack",
	"type",
	"format",
	"rake",
	"openSize",
	"threeBet",
	"betSize",
];

const INDEX_FIELDS = [
	"id",
	"title",
	"game",
	"stack",
	"type",
	"format",
	"rake",
	"open",
	"threeBet",
	"cashDrop",
	"betSizeText",
	"rootPosition",
];

const POSTFLOP_PARAMETERS = [
	"board",
	"cards",
	"flop",
	"turn",
	"river",
	"street",
];
const RARE_ACTION_TAG = "almost-never-reached";

function makeComboOrder() {
	const combos = [];
	for (let highRank = 0; highRank < RANKS.length; highRank += 1) {
		for (let highSuit = 0; highSuit < SUITS.length; highSuit += 1) {
			for (let lowRank = 0; lowRank <= highRank; lowRank += 1) {
				for (let lowSuit = 0; lowSuit < SUITS.length; lowSuit += 1) {
					if (lowRank === highRank && highSuit <= lowSuit) continue;
					combos.push(
						`${RANKS[highRank]}${SUITS[highSuit]}${RANKS[lowRank]}${SUITS[lowSuit]}`,
					);
				}
			}
		}
	}
	return combos;
}

export const ZENO_COMBO_ORDER = Object.freeze(makeComboOrder());
export const getZenoComboOrder = () => [...ZENO_COMBO_ORDER];

function fail(message) {
	throw new Error(message);
}

function asPlainObject(value, name) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		fail(`${name} must be an object.`);
	}
	return value;
}

function postflopUrlSignal(url) {
	for (const parameter of POSTFLOP_PARAMETERS) {
		if (url.searchParams.has(parameter)) return `URL parameter "${parameter}"`;
	}
	const raw = `${url.search}${url.hash}`.toLowerCase();
	if (
		/(?:[?&#])(node|hand|solve|report)=/.test(raw)
		|| /#(?:share|report|rpt)=/.test(raw)
	) {
		return "a solve, share, report, or hand route";
	}

	let hash;
	try {
		hash = decodeURIComponent(url.hash.replace(/^#/, ""));
	} catch {
		return null;
	}
	if (!hash.startsWith("b=")) return null;
	const colon = hash.indexOf(":");
	if (colon < 0) return null;
	const history = hash.slice(colon + 1);
	return /^(?:\d+(?:,\d+)*)?$/.test(history)
		? null
		: "a mobile route containing a postflop history";
}

function cleanNumber(value) {
	if (Object.is(value, -0)) return "0";
	return String(value);
}

export function normalizeZenoStudyUrl(value) {
	if (typeof value !== "string" || !value.trim()) {
		fail("A Zeno study URL is required.");
	}

	const input = value.trim();
	let url;
	try {
		url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`);
	} catch {
		fail("Invalid Zeno study URL.");
	}

	const allowedHost = /^(?:www\.)?zenosolver\.com$/i.test(url.hostname);
	if (!allowedHost || url.username || url.password) {
		fail("URL must be a Zeno study URL.");
	}
	if (url.protocol !== "https:") {
		fail("Zeno study URLs must use HTTPS.");
	}
	const postflopSignal = postflopUrlSignal(url);
	if (postflopSignal) {
		fail(`Postflop Zeno URLs cannot be converted: ${postflopSignal}.`);
	}

	const tree = url.searchParams.get("tree");
	if ((url.pathname !== "/study" && url.pathname !== "/m.html") || !tree) {
		fail("URL must identify a zenosolver.com study with a tree query.");
	}
	const normalized = new URL("https://zenosolver.com/study");
	normalized.searchParams.set("tree", tree);
	for (const parameter of ["pf", "r", "lang", "icm"]) {
		const parameterValue = url.searchParams.get(parameter);
		if (parameterValue !== null) normalized.searchParams.set(parameter, parameterValue);
	}
	return normalized.href;
}

export function requirePreflopOnly(state) {
	const PRE_FLOP_ERROR = "Only preflop Zeno states can be converted.";
	if (typeof state === "string") {
		if (!/^pre\s*-?flop$/i.test(state.trim())) fail(PRE_FLOP_ERROR);
		return state;
	}

	const record = asPlainObject(state, "Zeno state");
	const phaseFields = ["street", "stage", "round", "gameState"];
	let explicitlyPreflop = false;
	for (const field of phaseFields) {
		if (record[field] == null) continue;
		if (typeof record[field] !== "string") fail(PRE_FLOP_ERROR);
		if (!/^pre\s*-?flop$/i.test(record[field].trim())) fail(PRE_FLOP_ERROR);
		explicitlyPreflop = true;
	}
	if (Object.hasOwn(record, "isPreflop") && record.isPreflop !== true) {
		fail(PRE_FLOP_ERROR);
	}
	if (!explicitlyPreflop && record.isPreflop !== true) fail(PRE_FLOP_ERROR);

	for (const field of ["board", "boardCards", "cards"]) {
		if (!Object.hasOwn(record, field)) continue;
		if (!Array.isArray(record[field])) fail("Zeno board state must be an array.");
		if (record[field].length > 0) fail(PRE_FLOP_ERROR);
	}
	return state;
}

export function mapZenoPosition(position) {
	const key = typeof position === "string"
		? position.trim().toUpperCase().replaceAll("_", "")
		: "";
	const aliases = {
		UTG: "EP",
		EP: "EP",
		HJ: "MP",
		MP: "MP",
		CO: "CO",
		BTN: "BU",
		BU: "BU",
		SB: "SB",
		BB: "BB",
	};
	if (!aliases[key]) fail(`Unknown Zeno position "${position}".`);
	return aliases[key];
}

function actionAmount(record, label = "") {
	const candidates = [
		record?.amount,
		record?.size,
		record?.betSize,
		record?.to_bb,
		record?.value,
	];
	const direct = candidates.find((candidate) =>
		(typeof candidate === "number" && Number.isFinite(candidate))
		|| (typeof candidate === "string" && candidate.trim()),
	);
	if (direct != null) {
		const amount = Number(String(direct).replace(/\s*bb$/i, ""));
		if (!Number.isFinite(amount) || amount < 0) fail("Action amount must be a finite non-negative number.");
		return cleanNumber(amount);
	}
	const match = String(label).match(/(?:^|[ _-])(\d+(?:\.\d+)?)\s*(?:bb)?\s*$/i);
	return match ? cleanNumber(Number(match[1])) : null;
}

function actionKind(record) {
	if (typeof record === "string") return record;
	if (!record || typeof record !== "object" || Array.isArray(record)) {
		fail("Zeno action records must be strings or objects.");
	}
	const nested = record.action;
	return [
		record.type,
		record.kind,
		record.name,
		record.label,
		record.id,
		typeof nested === "string" ? nested : nested?.type ?? nested?.name ?? nested?.id,
	].find((value) => typeof value === "string" && value.trim()) ?? "";
}

function normalizeActionKind(value) {
	const compact = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
	const withoutAmount = compact
		.replace(/to(?=\d)/, "")
		.replace(/\d+(?:\.\d+)?(?:bb)?$/, "");
	if (/^(?:f|fold)$/.test(withoutAmount)) return "fold";
	if (/^(?:c|call)$/.test(withoutAmount)) return "call";
	if (/^(?:x|check)$/.test(withoutAmount)) return "check";
	if (/^(?:r|raise|bet|open|rfi)$/.test(withoutAmount)) return "raise";
	if (/^(?:ai|allin|jam)$/.test(withoutAmount)) return "allin";
	return null;
}

export function mapZenoAction(record) {
	const text = actionKind(record);
	const kind = normalizeActionKind(text);
	if (!kind) fail(`Unknown Zeno action "${text}".`);

	const amount = actionAmount(record, text);
	const labelBase = {
		fold: "Fold",
		call: "Call",
		check: "Check",
		raise: "Raise",
		allin: "Allin",
	}[kind];
	const idAmount = amount == null ? "" : `-${amount.replaceAll(".", "-")}`;
	return {
		id: `${kind}${idAmount}`,
		label: `${labelBase}${amount == null ? "" : ` ${amount}`}`,
	};
}

function getActionToken(action) {
	const label = typeof action === "string" ? action : action?.label ?? action?.id ?? "";
	if (/^fold\b/i.test(label)) return "F";
	if (/^call\b/i.test(label)) return "C";
	if (/^check\b/i.test(label)) return "X";
	if (/^(?:allin|jam|ai)\b/i.test(label)) return "AI";
	if (/^(?:raise|open)\b/i.test(label)) return "R";
	return null;
}

function isAggressiveToken(token) {
	return /^(?:R|AI)$/i.test(token);
}

function parseNodeId(nodeId) {
	if (typeof nodeId !== "string") return null;
	const parts = nodeId.split("_");
	if (parts.length % 2 === 0 || !POSITION_SET.has(parts.at(-1))) return null;

	const history = [];
	for (let index = 0; index < parts.length - 1; index += 2) {
		if (!POSITION_SET.has(parts[index]) || !parts[index + 1]) return null;
		history.push({
			position: parts[index],
			actionToken: parts[index + 1],
		});
	}
	return { history, currentPosition: parts.at(-1) };
}

export function getExpectedNextNodeId(sourceNodeId, action) {
	const parsedSource = parseNodeId(sourceNodeId);
	if (!parsedSource) return null;
	const actionToken = getActionToken(action);
	if (!actionToken) return null;

	const events = [
		...parsedSource.history,
		{ position: parsedSource.currentPosition, actionToken },
	];
	const folded = new Set();
	const allIn = new Set();
	let actedSinceRaise = new Set();
	let lastAggressor = null;

	for (const event of events) {
		if (event.actionToken === "F") folded.add(event.position);
		if (event.actionToken === "AI") allIn.add(event.position);
		if (isAggressiveToken(event.actionToken)) {
			lastAggressor = event.position;
			actedSinceRaise = new Set([event.position]);
		} else {
			actedSinceRaise.add(event.position);
		}
	}

	const currentIndex = POSITIONS.indexOf(parsedSource.currentPosition);
	for (let offset = 1; offset <= POSITIONS.length; offset += 1) {
		const nextPosition = POSITIONS[(currentIndex + offset) % POSITIONS.length];
		if (folded.has(nextPosition) || allIn.has(nextPosition)) continue;
		if (actedSinceRaise.has(nextPosition)) continue;
		if (lastAggressor && nextPosition === lastAggressor) continue;
		return { nodeId: `${sourceNodeId}_${actionToken}_${nextPosition}` };
	}
	return { nodeId: null };
}

function discoveryLine(decision, fallback) {
	if (decision.line != null) {
		if (typeof decision.line !== "string") fail("Discovery line must be a string.");
		return decision.line;
	}
	if (typeof decision.url === "string") {
		try {
			return new URL(decision.url).searchParams.get("pf") ?? fallback;
		} catch {
			fail(`Invalid discovery URL "${decision.url}".`);
		}
	}
	return fallback;
}

function actionAtIndex(actions, value) {
	const requested = Number(value);
	if (!Number.isInteger(requested) || requested < 0) {
		fail(`Invalid viaActionIndex "${value}".`);
	}
	const byDeclaredIndex = actions.findIndex(
		(action) => action && typeof action === "object"
			&& Number(action.actionIndex) === requested,
	);
	return {
		index: byDeclaredIndex >= 0
			? byDeclaredIndex
			: (actions.some((action) => action?.actionIndex != null)
				? -1
				: requested),
	};
}

function discoveryActionOutcome(action) {
	const terminal = action?.terminal === true
		|| action?.apiAction?.terminal === true
		|| action?.apiAction?.end === true;
	const rare = action?.outcome === "rare"
		|| action?.apiAction?.outcome === "rare"
		|| (Array.isArray(action?.tags) && action.tags.includes(RARE_ACTION_TAG));
	const rawOutcome = action?.outcome ?? action?.apiAction?.outcome;
	if (rawOutcome != null && !["continue", "terminal", "rare"].includes(rawOutcome)) {
		fail(`Unknown Zeno action outcome "${rawOutcome}".`);
	}
	if (terminal && rare) fail("A Zeno action cannot be both terminal and rare.");
	if (rawOutcome === "terminal" || terminal) return "terminal";
	if (rawOutcome === "rare" || rare) return "rare";
	return "continue";
}

function pathEventsFromPf(url) {
	const pf = new URL(url).searchParams.get("pf") || "";
	if (!pf) return [];
	return pf
		.split(/[,;_]/)
		.map((item) => item.trim())
		.filter(Boolean)
		.map((item) => {
			const match = item.match(/^([A-Za-z]+)\s*[-:=]\s*(.+)$/);
			if (!match) fail(`Unsupported pf path segment "${item}".`);
			return { actor: match[1], action: match[2] };
		});
}

function nodeIdFromInitialDecision(sourceUrl, decision) {
	const tokens = [];
	for (const event of pathEventsFromPf(sourceUrl)) {
		const mapped = mapZenoAction(event.action);
		const token = getActionToken(mapped);
		if (!token) fail(`Unsupported Zeno action "${mapped.label}".`);
		tokens.push(mapZenoPosition(event.actor), token);
	}
	tokens.push(mapZenoPosition(decision.actor ?? decision.position));
	return tokens.join("_");
}

function strategyForDiscoveryAction(discovery, decision, action, actionIndex) {
	const strategy = decision.preflopResponse?.data?.strategy;
	if (!Array.isArray(strategy)) return null;
	const declaredIndex = Number.isInteger(action?.actionIndex)
		? action.actionIndex
		: actionIndex;
	if (strategy.length === 1326 && decision.actions.length === 1) return strategy;
	const candidate = strategy[declaredIndex];
	return Array.isArray(candidate) ? candidate : null;
}

/**
 * Adapts only visible browser decisions into conversion records. Browser
 * traversal must link each child decision to its parent's visible action.
 */
export function adaptZenoDiscovery(
	discovery,
	sourceUrl,
	existing = new Map(),
	options = {},
) {
	const decisions = discovery?.decisions;
	if (!Array.isArray(decisions) || decisions.length === 0) {
		fail(`No decisions were discovered from ${sourceUrl}.`);
	}
	if (!(existing instanceof Map)) fail("Existing decisions must be a Map.");
	const allowIncomplete = options.allowIncomplete === true;

	const sourceLine = new URL(sourceUrl).searchParams.get("pf") ?? "";
	const records = decisions.map((rawDecision, recordIndex) => {
		const decision = asPlainObject(rawDecision, `Discovery decision ${recordIndex}`);
		const actions = decisionActions(decision);
		return {
			decision,
			actions,
			line: discoveryLine(decision, recordIndex === 0 ? sourceLine : undefined),
		};
	});
	const byLine = new Map();
	for (const record of records) {
		if (record.line === undefined || record.line === null) {
			fail(`Discovery decision at ${record.decision.url} is missing line.`);
		}
		if (byLine.has(record.line)) {
			fail(`Duplicate Zeno discovery line "${record.line}".`);
		}
		byLine.set(record.line, record);
	}

	records[0].nodeId = nodeIdFromInitialDecision(sourceUrl, records[0].decision);
	records[0].root = true;
	const childLinks = new Map(records.map((record) => [record, new Map()]));

	let progressed = true;
	while (progressed) {
		progressed = false;
		for (const child of records.slice(1)) {
			if (child.nodeId) continue;
			if (child.decision.parentLine == null) {
				fail(`Discovery decision "${child.line}" is missing parentLine.`);
			}
			const parent = byLine.get(String(child.decision.parentLine));
			if (!parent || !parent.nodeId) continue;
			const located = actionAtIndex(parent.actions, child.decision.viaActionIndex);
			if (located.index < 0 || located.index >= parent.actions.length) {
				fail(
					`Discovery decision "${child.line}" references missing action ` +
					`"${child.decision.viaActionIndex}" on line "${parent.line}".`,
				);
			}
			const links = childLinks.get(parent);
			if (links.has(located.index)) {
				fail(`Action ${located.index} on line "${parent.line}" has multiple child decisions.`);
			}
			const action = parent.actions[located.index];
			const expected = getExpectedNextNodeId(
				parent.nodeId,
				mapZenoAction(action.apiAction || action),
			);
			if (!expected?.nodeId) {
				fail(
					`Zeno action "${action.label ?? action.id}" on line "${parent.line}" ` +
					"cannot continue to a child decision.",
				);
			}
			child.nodeId = expected.nodeId;
			links.set(located.index, child);
			progressed = true;
		}
	}

	for (const record of records) {
		if (!record.nodeId) {
			fail(`Could not link Zeno decision "${record.line}" to a parent line/action.`);
		}
		const links = childLinks.get(record);
		const convertedActions = record.actions.map((action, actionIndex) => {
			const outcome = discoveryActionOutcome(action);
			const child = links.get(actionIndex);
			if (outcome !== "continue" && child) {
				fail(`Zeno action "${action.label ?? action.id}" is marked ${outcome} but has a child.`);
			}
			const resolvedOutcome = outcome === "terminal"
				&& action.terminal !== true
				&& action.endpointTerminal !== true
				? "continue"
				: outcome;
			if (resolvedOutcome === "continue" && !child && !allowIncomplete) {
				fail(
					`Continuing Zeno action "${action.label ?? action.id}" on line ` +
					`"${record.line}" has no discovered child.`,
				);
			}

			let copiedRange = action.copiedRange;
			const needsFallback = copiedRange == null
				|| (typeof copiedRange === "object"
					&& copiedRange.source === "unavailable"
					&& copiedRange.strategy == null
					&& copiedRange.text == null
					&& copiedRange.rangeText == null
					&& copiedRange.range == null);
			const fallback = needsFallback
				? strategyForDiscoveryAction(discovery, record.decision, action, actionIndex)
				: null;
			if (fallback) {
				copiedRange = {
					source: "api-preflop",
					strategy: fallback,
				};
			}
			return {
				...action,
				outcome: resolvedOutcome,
				terminal: resolvedOutcome === "terminal" ? true : undefined,
				tags: resolvedOutcome === "rare" ? [RARE_ACTION_TAG] : undefined,
				...(copiedRange != null ? { copiedRange } : {}),
				...(child ? { nextNodeId: child.nodeId } : {}),
			};
		});
		const converted = {
			nodeId: record.nodeId,
			actor: record.decision.actor,
			path: record.nodeId,
			actions: convertedActions,
			...(record.root && existing.size === 0 ? { root: true } : {}),
		};
		if (!existing.has(record.nodeId)) existing.set(record.nodeId, converted);
	}

	return records[0].nodeId;
}

function normalizeComboId(value) {
	const match = typeof value === "string"
		&& value.match(/^([2-9TJQKA])([cdhs])([2-9TJQKA])([cdhs])$/i);
	if (!match) fail(`Invalid combo "${value}".`);
	const first = { rank: match[1].toUpperCase(), suit: match[2].toLowerCase() };
	const second = { rank: match[3].toUpperCase(), suit: match[4].toLowerCase() };
	if (first.rank === second.rank && first.suit === second.suit) {
		fail(`Combo "${value}" uses the same card twice.`);
	}
	const firstRank = RANKS.indexOf(first.rank);
	const secondRank = RANKS.indexOf(second.rank);
	const firstSuit = SUITS.indexOf(first.suit);
	const secondSuit = SUITS.indexOf(second.suit);
	const swap = firstRank < secondRank
		|| (firstRank === secondRank && firstSuit < secondSuit);
	const high = swap ? second : first;
	const low = swap ? first : second;
	return `${high.rank}${high.suit}${low.rank}${low.suit}`;
}

function normalizeFrequency(value, combo) {
	const frequency = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(frequency) || frequency < 0 || frequency > 1) {
		fail(`Frequency for "${combo}" must be between 0 and 1.`);
	}
	return cleanNumber(frequency);
}

export function parseZenoStrategyArray(strategy) {
	if (!Array.isArray(strategy) || strategy.length !== 1326) {
		fail("Each Zeno strategy must contain exactly 1326 combos.");
	}

	const entries = strategy.map((entry, index) => {
		if (typeof entry === "number" || typeof entry === "string") {
			return [ZENO_COMBO_ORDER[index], normalizeFrequency(entry, ZENO_COMBO_ORDER[index])];
		}
		if (Array.isArray(entry) && entry.length === 2) {
			const combo = normalizeComboId(entry[0]);
			return [combo, normalizeFrequency(entry[1], combo)];
		}
		if (entry && typeof entry === "object") {
			const combo = normalizeComboId(entry.combo ?? entry.hand ?? entry.id);
			return [combo, normalizeFrequency(
				entry.frequency ?? entry.value ?? entry.probability,
				combo,
			)];
		}
		fail(`Invalid strategy entry at index ${index}.`);
	});

	const frequencies = new Map();
	for (const [combo, frequency] of entries) {
		if (frequencies.has(combo)) fail(`Duplicate combo "${combo}" in Zeno strategy.`);
		frequencies.set(combo, frequency);
	}
	const missing = ZENO_COMBO_ORDER.find((combo) => !frequencies.has(combo));
	if (missing) fail(`Missing combo "${missing}" from Zeno strategy.`);

	return ZENO_COMBO_ORDER
		.map((combo) => `${combo}: ${frequencies.get(combo)}`)
		.join(",");
}

export const strategyArrayToRangeText = parseZenoStrategyArray;

function sourcePath(decision) {
	const path = decision.path ?? decision.actionPath ?? decision.history ?? [];
	if (Array.isArray(path)) return path;
	if (typeof path === "string") return path;
	fail("Decision path must be an array or node ID.");
}

function pathEvent(event) {
	if (typeof event === "string") {
		const match = event.match(/^([A-Za-z]+)\s*[:=]\s*(.+)$/);
		if (!match) fail(`Invalid path action "${event}".`);
		return { actor: match[1], action: match[2] };
	}
	const record = asPlainObject(event, "Path event");
	return {
		actor: record.actor ?? record.position ?? record.player,
		action: record.action ?? record,
	};
}

function normalizePathNodeId(nodeId) {
	const parts = nodeId.split("_");
	const normalized = [];
	for (let index = 0; index < parts.length; index += 1) {
		if (index % 2 === 0) {
			normalized.push(mapZenoPosition(parts[index]));
		} else {
			const action = mapZenoAction(parts[index]);
			normalized.push(getActionToken(action));
		}
	}
	const result = normalized.join("_");
	if (!parseNodeId(result)) fail(`Invalid decision path "${nodeId}".`);
	return result;
}

function buildNodeId(decision) {
	if (typeof decision.nodeId === "string" && decision.nodeId) {
		return normalizePathNodeId(decision.nodeId);
	}
	const actor = mapZenoPosition(decision.actor ?? decision.position);
	const path = sourcePath(decision);
	if (typeof path === "string") return normalizePathNodeId(path);
	const tokens = [];
	for (const item of path) {
		const event = pathEvent(item);
		tokens.push(mapZenoPosition(event.actor));
		const token = getActionToken(mapZenoAction(event.action));
		if (!token) fail("Path contains an unsupported action.");
		tokens.push(token);
	}
	tokens.push(actor);
	return tokens.join("_");
}

function decisionActions(decision) {
	const actions = decision.actions ?? decision.availableActions;
	if (!Array.isArray(actions) || actions.length === 0) {
		fail("Each decision must contain at least one action.");
	}
	return actions;
}

function rangeCandidates(decision, action, index, mapped) {
	const actionRecord = action && typeof action === "object" ? action : {};
	const copied = actionRecord.copiedRange;
	if (copied != null) {
		if (typeof copied === "string") return copied;
		if (typeof copied === "object") {
			const clipboard = copied.text ?? copied.rangeText ?? copied.range ?? copied.strategy;
			if (clipboard != null) return clipboard;
		}
	}
	const direct = [
		actionRecord.range,
		actionRecord.strategy,
		actionRecord.frequencies,
		actionRecord.rangeText,
	].find((value) => value != null);
	if (direct != null) return direct;

	const ranges = decision.ranges ?? decision.strategies;
	if (Array.isArray(ranges)) {
		if (ranges.length === decisionActions(decision).length) return ranges[index];
		if (ranges.length === 1326 && decisionActions(decision).length === 1) return ranges;
		fail(`Ranges for decision "${decision.actor}" must align with its actions.`);
	}
	if (!ranges || typeof ranges !== "object") {
		fail(`Action "${mapped.label}" is missing a 1326-combo strategy.`);
	}
	const keys = [
		actionRecord.id,
		actionRecord.name,
		actionRecord.type,
		typeof action === "string" ? action : null,
		mapped.id,
		mapped.label,
		index,
	];
	for (const key of keys) {
		if (key != null && Object.hasOwn(ranges, key)) return ranges[key];
	}
	fail(`Action "${mapped.label}" is missing a 1326-combo strategy.`);
}

function explicitTarget(decision, action, actionIndex) {
	const record = action && typeof action === "object" ? action : {};
	return record.nextNodeId
		?? record.targetNodeId
		?? record.target
		?? record.next
		?? decision.targets?.[actionIndex];
}

function convertedActionOutcome(action) {
		const outcome = discoveryActionOutcome(action);
		if (outcome === "rare") {
			const tags = action?.tags;
			if (tags != null && (!Array.isArray(tags)
				|| tags.length !== 1
				|| tags[0] !== RARE_ACTION_TAG)) {
				fail("Rare actions may contain only the almost-never-reached tag.");
			}
		}
		return outcome;
}

function normalizeTarget(target) {
	if (target == null || target === "") return null;
	if (typeof target === "string") return normalizePathNodeId(target);
	const record = asPlainObject(target, "Action target");
	const path = record.path ?? record.actionPath ?? record.history;
	const actor = record.actor ?? record.position;
	if (path != null && actor != null) {
		return buildNodeId({ ...record, path, actor });
	}
	return normalizePathNodeId(record.nodeId);
}

function pickMeta(meta) {
	const result = {};
	for (const field of META_FIELDS) {
		if (meta[field] !== undefined) result[field] = meta[field];
	}
	return result;
}

export function validateConvertedSolution(solution) {
	const data = asPlainObject(solution, "Solution");
	if (Object.keys(data).sort().join("\u0000") !== ["meta", "nodes", "rootNodeId"].sort().join("\u0000")) {
		fail("Converted solution must contain exactly meta, rootNodeId, and nodes.");
	}
	asPlainObject(data.meta, "Solution metadata");
	const nodes = asPlainObject(data.nodes, "Solution nodes");
	if (!Object.hasOwn(nodes, data.rootNodeId)) {
		fail(`Root node "${data.rootNodeId}" is missing.`);
	}

	for (const [nodeId, node] of Object.entries(nodes)) {
		asPlainObject(node, `Node "${nodeId}"`);
		if (node.nodeId !== nodeId) fail(`Node ID "${nodeId}" is duplicated or mismatched.`);
		if (!POSITION_SET.has(node.position)) fail(`Node "${nodeId}" has an invalid position.`);
		if (!Array.isArray(node.actions) || node.actions.length === 0) {
			fail(`Node "${nodeId}" must contain actions.`);
		}
		const actionIds = new Set();
		for (const action of node.actions) {
			asPlainObject(action, `Action on node "${nodeId}"`);
			if (actionIds.has(action.id)) fail(`Duplicate action ID "${action.id}" on node "${nodeId}".`);
			actionIds.add(action.id);
			if (typeof action.id !== "string" || !action.id
				|| typeof action.label !== "string" || !action.label) {
				fail(`Action on node "${nodeId}" must have an id and label.`);
			}
			if (typeof action.rawRangeText !== "string") {
				fail(`Action "${action.id}" on node "${nodeId}" is missing rawRangeText.`);
			}
			parseZenoStrategyRangeText(action.rawRangeText, action.id);
			const isTerminal = action.terminal === true;
			const isRare = Array.isArray(action.tags)
				&& action.tags.includes(RARE_ACTION_TAG);
			if (isTerminal && isRare) {
				fail(`Action "${action.id}" cannot be terminal and rare.`);
			}
			if ((isTerminal || isRare) && action.nextNodeId != null) {
				fail(`Action "${action.id}" cannot have an outcome and a target.`);
			}
			if (isRare && (
				action.tags.length !== 1
				|| action.tags[0] !== RARE_ACTION_TAG
			)) {
				fail(`Action "${action.id}" has an invalid rare tag.`);
			}
			if (action.nextNodeId != null && !Object.hasOwn(nodes, action.nextNodeId)) {
				fail(`Action "${action.id}" on node "${nodeId}" targets missing node "${action.nextNodeId}".`);
			}
			const expected = getExpectedNextNodeId(nodeId, action);
			if (action.nextNodeId != null && expected?.nodeId !== action.nextNodeId) {
				fail(`Action "${action.id}" on node "${nodeId}" has an invalid target.`);
			}
			if (action.nextNodeId == null && !isTerminal && !isRare) {
				fail(`Action "${action.id}" on node "${nodeId}" has unresolved continuing outcome.`);
			}
			const allowedFields = new Set([
				"id",
				"label",
				"rawRangeText",
				...(isTerminal ? ["terminal"] : []),
				...(isRare ? ["tags"] : []),
				...(!isTerminal && !isRare ? ["nextNodeId"] : []),
			]);
			const unexpected = Object.keys(action).find((field) => !allowedFields.has(field));
			if (unexpected) fail(`Action "${action.id}" has unexpected field "${unexpected}".`);
		}
	}
	return solution;
}

function parseZenoStrategyRangeText(text, actionId) {
	if (typeof text !== "string") {
		fail(`Action "${actionId}" rawRangeText must be a string.`);
	}
	const entries = text.split(",");
	if (entries.length !== 1326) {
		fail(`Action "${actionId}" rawRangeText must contain 1326 combos.`);
	}
	const seen = new Set();
	for (const entry of entries) {
		const match = entry.trim().match(
			/^([2-9TJQKA][cdhs][2-9TJQKA][cdhs]):\s*([^ \t\r\n]+)$/,
		);
		if (!match) fail(`Action "${actionId}" contains an invalid combo range entry.`);
		const combo = normalizeComboId(match[1]);
		if (seen.has(combo)) fail(`Action "${actionId}" contains duplicate combo "${combo}".`);
		seen.add(combo);
		normalizeFrequency(match[2], combo);
	}
}

function rangeText(value) {
	return typeof value === "string" ? value : parseZenoStrategyArray(value);
}

export function convertZenoPreflop(payload) {
	const data = asPlainObject(payload, "Zeno payload");
	if (data.url ?? data.studyUrl) normalizeZenoStudyUrl(data.url ?? data.studyUrl);
	const state = data.state ?? data.studyState ?? data.study?.state ?? data;
	requirePreflopOnly(state);
	const meta = pickMeta(asPlainObject(data.meta, "Zeno metadata"));
	const decisions = data.decisions ?? data.nodes ?? data.data?.decisions;
	if (!Array.isArray(decisions) || decisions.length === 0) {
		fail("Zeno payload must contain decision records.");
	}

	const prepared = decisions.map((rawDecision, index) => {
		const decision = asPlainObject(rawDecision, `Decision ${index}`);
		const nodeId = buildNodeId(decision);
		return { decision, nodeId, actions: decisionActions(decision) };
	});

	const nodeIds = new Set();
	for (const item of prepared) {
		if (nodeIds.has(item.nodeId)) fail(`Duplicate decision node ID "${item.nodeId}".`);
		nodeIds.add(item.nodeId);
	}

	const roots = data.rootNodeId
		? prepared.filter((item) => item.nodeId === data.rootNodeId)
		: prepared.filter((item) => {
		const path = sourcePath(item.decision);
		return item.decision.root === true
			|| (Array.isArray(path) && path.length === 0);
	});
	if (roots.length !== 1) fail("Zeno decisions must contain exactly one root decision.");

	const nodes = {};
	for (const { decision, nodeId, actions } of prepared) {
		const convertedActions = actions.map((action, actionIndex) => {
			const mapped = mapZenoAction(action);
			const rawRangeText = rangeText(
				rangeCandidates(decision, action, actionIndex, mapped),
			);
			const target = normalizeTarget(explicitTarget(decision, action, actionIndex));
			const expected = getExpectedNextNodeId(nodeId, mapped);
			const outcome = convertedActionOutcome(action);
			if (outcome !== "continue" && target) {
				fail(`Action "${mapped.label}" on node "${nodeId}" has an outcome and a target.`);
			}
			if (target && target !== expected?.nodeId) {
				fail(`Action "${mapped.label}" on node "${nodeId}" has an invalid target "${target}".`);
			}
			if (target && !nodeIds.has(target)) {
				fail(`Action "${mapped.label}" on node "${nodeId}" targets missing node "${target}".`);
			}
			const derivedTarget = expected?.nodeId;
			const nextNodeId = outcome === "continue"
				? target ?? (derivedTarget && nodeIds.has(derivedTarget) ? derivedTarget : null)
				: null;
			if (outcome === "continue" && !nextNodeId) {
				fail(
					`Action "${mapped.label}" on node "${nodeId}" has an unresolved continuing outcome.`,
				);
			}
			const converted = {
				...mapped,
				...(outcome === "terminal" ? { terminal: true } : {}),
				...(outcome === "rare" ? { tags: [RARE_ACTION_TAG] } : {}),
				...(nextNodeId ? { nextNodeId } : {}),
				rawRangeText,
			};
			return converted;
		});

		nodes[nodeId] = {
			nodeId,
			position: mapZenoPosition(decision.actor ?? decision.position),
			actions: convertedActions,
		};
	}

	return validateConvertedSolution({
		meta,
		rootNodeId: roots[0].nodeId,
		nodes,
	});
}

/**
 * Creates an intentionally incomplete solution snapshot from a checkpoint.
 * Continuing actions are included only when their already-discovered target is
 * also represented by a non-empty draft node.
 */
export function draftZenoPreflop(payload) {
	const data = asPlainObject(payload, "Zeno draft payload");
	const state = data.state ?? data.studyState ?? data.study?.state ?? data;
	requirePreflopOnly(state);
	const meta = pickMeta(asPlainObject(data.meta, "Zeno metadata"));
	const decisions = data.decisions ?? data.nodes ?? data.data?.decisions;
	if (!Array.isArray(decisions) || decisions.length === 0) {
		fail("Zeno payload must contain decision records.");
	}

	const prepared = decisions.map((rawDecision, index) => {
		const decision = asPlainObject(rawDecision, `Decision ${index}`);
		const nodeId = buildNodeId(decision);
		return { decision, nodeId, actions: decisionActions(decision) };
	});
	const nodeIds = new Set();
	for (const item of prepared) {
		if (nodeIds.has(item.nodeId)) fail(`Duplicate decision node ID "${item.nodeId}".`);
		nodeIds.add(item.nodeId);
	}
	const roots = data.rootNodeId
		? prepared.filter((item) => item.nodeId === data.rootNodeId)
		: prepared.filter((item) => item.decision.root === true);
	if (roots.length !== 1) fail("Zeno draft must contain exactly one root decision.");

	const candidates = new Map();
	for (const { decision, nodeId, actions } of prepared) {
		const converted = [];
		for (const [actionIndex, action] of actions.entries()) {
			const outcome = convertedActionOutcome(action);
			const mapped = mapZenoAction(action);
			const target = normalizeTarget(explicitTarget(decision, action, actionIndex));
			const expected = getExpectedNextNodeId(nodeId, mapped);
			if (target && target !== expected?.nodeId) {
				fail(`Action "${mapped.label}" on node "${nodeId}" has an invalid target "${target}".`);
			}
			if (outcome !== "continue" && target) {
				fail(`Action "${mapped.label}" on node "${nodeId}" has an outcome and a target.`);
			}
			converted.push({
				...mapped,
				...(outcome === "terminal" ? { terminal: true } : {}),
				...(outcome === "rare" ? { tags: [RARE_ACTION_TAG] } : {}),
				...(outcome === "continue" && target && nodeIds.has(target)
					? { nextNodeId: target }
					: {}),
				rawRangeText: rangeText(rangeCandidates(
					decision,
					action,
					actionIndex,
					mapped,
				)),
			});
		}
		candidates.set(nodeId, { position: mapZenoPosition(decision.actor), converted });
	}

	const nodes = {};
	for (const [nodeId, candidate] of candidates) {
		const actions = candidate.converted;
		if (actions.length === 0) continue;
		nodes[nodeId] = { nodeId, position: candidate.position, actions };
	}
	return { meta, rootNodeId: roots[0].nodeId, nodes };
}

export const buildZenoSolution = convertZenoPreflop;

export function createIndexEntry(id, solution, overrides = {}) {
	const source = solution?.meta ? solution.meta : solution;
	asPlainObject(source, "Index source metadata");
	const raw = {
		id,
		title: source.title,
		game: source.game,
		stack: source.stack,
		type: source.type,
		format: source.format,
		rake: source.rake,
		open: source.open ?? source.openSize,
		threeBet: source.threeBet,
		cashDrop: source.cashDrop ?? overrides.cashDrop ?? "-",
		betSizeText: source.betSizeText ?? source.betSize,
		rootPosition: source.rootPosition
			?? solution?.nodes?.[solution.rootNodeId]?.position
			?? overrides.rootPosition,
		...overrides,
	};
	if (typeof raw.id !== "string" || !raw.id.trim()) fail("Solution index ID is required.");
	const entry = {};
	for (const field of INDEX_FIELDS) entry[field] = raw[field];
	return entry;
}

export function updateSolutionIndex(index, entryOrId, solution, overrides = {}) {
	if (!Array.isArray(index)) fail("Solution index must be an array.");
	const entry = typeof entryOrId === "string"
		? createIndexEntry(entryOrId, solution, overrides)
		: createIndexEntry(
			entryOrId?.id,
			entryOrId?.solution ?? entryOrId?.meta ?? entryOrId,
			entryOrId?.overrides ?? {},
		);
	for (const existing of index) {
		asPlainObject(existing, "Existing solution index entry");
		if (existing.id === entry.id) {
			return index.map((item) => item.id === entry.id ? entry : { ...item });
		}
	}
	return [...index.map((item) => ({ ...item })), entry];
}

export const updateZenoSolutionIndex = updateSolutionIndex;
