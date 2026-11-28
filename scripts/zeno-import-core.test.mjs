import assert from "node:assert/strict";
import test from "node:test";

import {
	classifyPreflopResponse,
	classifyZenoOutcomeText,
	randomizeActionDelay,
} from "./zeno-browser.mjs";
import {
	ZENO_COMBO_ORDER,
	adaptZenoDiscovery,
	convertZenoPreflop,
	draftZenoPreflop,
	getExpectedNextNodeId,
	mapZenoAction,
	mapZenoPosition,
	normalizeZenoStudyUrl,
	parseZenoStrategyArray,
	requirePreflopOnly,
	updateSolutionIndex,
} from "./zeno-import-core.mjs";

const META = {
	title: "Imported study",
	game: "Cash",
	stack: 100,
	type: "6-Max",
	format: "6-Max NLHE",
	rake: "NL50",
	openSize: "2x",
	threeBet: "GTO",
	betSize: "2bb open",
};

function zeros() {
	return Array.from({ length: 1326 }, () => 0);
}

function decision(actor, path, actionRanges) {
	return {
		actor,
		path,
		actions: actionRanges.map(({ action }) => action),
		ranges: actionRanges.map(({ range }) => range),
	};
}

test("normalizes only Zeno study URLs", () => {
	assert.equal(
		normalizeZenoStudyUrl(
			"https://www.zenosolver.com/m.html?tree=a100p6lr500&pf=UTG-f&r=test",
		),
		"https://zenosolver.com/study?tree=a100p6lr500&pf=UTG-f&r=test",
	);
	assert.equal(
		normalizeZenoStudyUrl(
			"https://zenosolver.com/study?tree=a100p6lr500&pf=UTG-f&r=Xbe2aDHT",
		),
		"https://zenosolver.com/study?tree=a100p6lr500&pf=UTG-f&r=Xbe2aDHT",
	);
	assert.throws(() => normalizeZenoStudyUrl("https://example.com/study?tree=abc"), /Zeno study URL/);
	assert.throws(() => normalizeZenoStudyUrl("https://zeno.poker/study/abc"), /Zeno study URL/);
	assert.throws(() => normalizeZenoStudyUrl("http://zenosolver.com/study?tree=abc"), /HTTPS/);
	assert.throws(() => normalizeZenoStudyUrl("https://zenosolver.com/study?a=1"), /tree query/);
	assert.throws(
		() => normalizeZenoStudyUrl("https://zenosolver.com/study?tree=abc&board=AsKh2c"),
		/Postflop/,
	);
	assert.throws(
		() => normalizeZenoStudyUrl(
			"https://zenosolver.com/study?tree=a100p6lr500&street=flop&board=AhKs2d",
		),
		/Postflop/,
	);
	assert.throws(() => normalizeZenoStudyUrl("javascript:alert(1)"), /Zeno study URL/);
});

test("requires an explicitly preflop state", () => {
	assert.equal(requirePreflopOnly("PRE-FLOP"), "PRE-FLOP");
	assert.equal(requirePreflopOnly({ stage: "preflop", board: [] }).stage, "preflop");
	assert.throws(() => requirePreflopOnly({ street: "flop" }), /Only preflop/);
	assert.throws(() => requirePreflopOnly({ isPreflop: true, cards: ["Ah"] }), /board|preflop/);
	assert.throws(() => requirePreflopOnly({}), /Only preflop/);
});

test("distinguishes almost-never-reached from terminal outcomes", () => {
	const rareMessage =
		"Almost never reached: the solution plays this line in fewer than 1 in 10,000 hands, so its strategy is not saved.";
	assert.equal(classifyZenoOutcomeText(rareMessage), "rare");
	assert.equal(
		classifyZenoOutcomeText(
			"Rare line: the solver almost never reaches this spot",
		),
		"unknown",
	);
	assert.equal(
		classifyPreflopResponse({
			status: 400,
			data: { error: rareMessage },
		}),
		"rare",
	);

	assert.equal(classifyZenoOutcomeText("Hand over"), "terminal");
	assert.equal(classifyZenoOutcomeText("Select a flop"), "terminal");
	assert.equal(classifyZenoOutcomeText("FLOP"), "terminal");
	assert.equal(
		classifyZenoOutcomeText("SB Call BB Raise 3.5 SB Call FLOP"),
		"terminal",
	);
	assert.equal(
		classifyPreflopResponse({
			status: 200,
			data: { flop: true },
		}),
		"terminal",
	);
	assert.equal(classifyZenoOutcomeText("Strategy is loading"), "unknown");
	assert.throws(
		() => requirePreflopOnly({ stage: "preflop", street: "flop" }),
		/Only preflop/,
	);
	assert.throws(
		() => requirePreflopOnly({ stage: "preflop", board: "AhKs2d" }),
		/must be an array/,
	);
});

test("randomizes action delay within ten percent jitter", () => {
	assert.equal(randomizeActionDelay(2000, 10, () => 0), 1800);
	assert.equal(randomizeActionDelay(2000, 10, () => 0.5), 2000);
	assert.equal(randomizeActionDelay(2000, 10, () => 1), 2200);
	assert.equal(randomizeActionDelay(0, 10, () => 0), 0);
	assert.equal(randomizeActionDelay(2000, 0, () => 0), 2000);
});

test("maps positions and API actions to repository conventions", () => {
	assert.deepEqual(
		["UTG", "HJ", "CO", "BTN", "SB", "BB"].map(mapZenoPosition),
		["EP", "MP", "CO", "BU", "SB", "BB"],
	);
	assert.throws(() => mapZenoPosition("UTG+1"), /Unknown Zeno position/);
	assert.deepEqual(mapZenoAction({ type: "RAISE", amount: 2.5 }), {
		id: "raise-2-5",
		label: "Raise 2.5",
	});
	assert.deepEqual(mapZenoAction({ action: "call", amount: 12.6 }), {
		id: "call-12-6",
		label: "Call 12.6",
	});
	assert.deepEqual(mapZenoAction("ALL_IN 100"), {
		id: "allin-100",
		label: "Allin 100",
	});
	assert.deepEqual(mapZenoAction({ label: "raise_to_2.5", to_bb: 2.5 }), {
		id: "raise-2-5",
		label: "Raise 2.5",
	});
	assert.deepEqual(mapZenoAction({ label: "allin", to_bb: 100 }), {
		id: "allin-100",
		label: "Allin 100",
	});
	assert.deepEqual(mapZenoAction("fold"), { id: "fold", label: "Fold" });
});

test("serializes all 1326 fallback frequencies in repository combo order", () => {
	assert.equal(ZENO_COMBO_ORDER.length, 1326);
	assert.equal(new Set(ZENO_COMBO_ORDER).size, 1326);
	assert.deepEqual(ZENO_COMBO_ORDER.slice(0, 8), [
		"2d2c",
		"2h2c",
		"2h2d",
		"2s2c",
		"2s2d",
		"2s2h",
		"3c2c",
		"3c2d",
	]);
	const range = zeros();
	range[0] = 0.25;
	range.at(-1);
	assert.match(parseZenoStrategyArray(range), /^2d2c: 0\.25,2h2c: 0/);
	assert.equal(parseZenoStrategyArray(range).split(",").length, 1326);
	assert.equal(parseZenoStrategyArray(range).split(",").at(-1), "AsAh: 0");

	assert.throws(() => parseZenoStrategyArray(range.slice(1)), /exactly 1326/);
	const missingLast = range.map((frequency, index) => [
		ZENO_COMBO_ORDER[index],
		frequency,
	]);
	missingLast[1325][0] = ZENO_COMBO_ORDER[1324];
	assert.throws(() => parseZenoStrategyArray(missingLast), /Duplicate combo/);
	const duplicate = range.map((frequency, index) => [
		index === 1 ? ZENO_COMBO_ORDER[0] : ZENO_COMBO_ORDER[index],
		frequency,
	]);
	assert.throws(() => parseZenoStrategyArray(duplicate), /Duplicate combo/);
	assert.throws(() => parseZenoStrategyArray([2, ...range.slice(1)]), /between 0 and 1/);
});

test("uses repository preflop node traversal conventions", () => {
	assert.deepEqual(getExpectedNextNodeId("EP_R_MP", { label: "Raise 6" }), {
		nodeId: "EP_R_MP_R_CO",
	});
	assert.deepEqual(getExpectedNextNodeId("EP_R_MP_F_CO", { label: "Fold" }), {
		nodeId: "EP_R_MP_F_CO_F_BU",
	});
	assert.deepEqual(getExpectedNextNodeId("EP_R_MP_C_CO_R_BU_AI_SB", { label: "Fold" }), {
		nodeId: "EP_R_MP_C_CO_R_BU_AI_SB_F_BB",
	});
});

test("builds only the current exact solution and node/action schema", () => {
	const root = decision("UTG", [], [
		{ action: { type: "raise", amount: 2 }, range: zeros() },
		{ action: { type: "fold", terminal: true }, range: zeros() },
	]);
	const child = decision("HJ", [{ actor: "UTG", action: { type: "raise", amount: 2 } }], [
		{ action: "fold", range: zeros() },
	]);
	child.actions[0] = { type: "fold", terminal: true };
	const solution = convertZenoPreflop({
		url: "https://zenosolver.com/study?tree=import1&pf=UTG-f",
		state: { street: "preflop" },
		meta: { ...META, ignoredApiField: true },
		decisions: [root, child],
	});

	assert.deepEqual(Object.keys(solution), ["meta", "rootNodeId", "nodes"]);
	assert.deepEqual(Object.keys(solution.meta), Object.keys(META));
	assert.equal(solution.rootNodeId, "EP");
	assert.deepEqual(Object.keys(solution.nodes.EP), ["nodeId", "position", "actions"]);
	assert.deepEqual(solution.nodes.EP.actions[0], {
		id: "raise-2",
		label: "Raise 2",
		nextNodeId: "EP_R_MP",
		rawRangeText: parseZenoStrategyArray(zeros()),
	});
	assert.deepEqual(solution.nodes.EP.actions[1], {
		id: "fold",
		label: "Fold",
		terminal: true,
		rawRangeText: parseZenoStrategyArray(zeros()),
	});
	assert.equal(solution.nodes.EP_R_MP.position, "MP");
	assert.equal(solution.nodes.EP_R_MP.actions[0].terminal, true);
});

test("links visible discovery actions and preserves terminal and rare outcomes", () => {
	const copied = parseZenoStrategyArray(zeros());
	const discovery = {
		decisions: [
			{
				line: "",
				parentLine: null,
				viaActionIndex: null,
				actor: "UTG",
				actions: [
					{
						actionIndex: 0,
						label: "Fold",
						frequency: "0%",
						terminal: true,
						copiedRange: { source: "clipboard", text: copied },
					},
					{
						actionIndex: 2,
						label: "Raise 2",
						frequency: "25%",
						copiedRange: { source: "clipboard", text: copied },
					},
					{
						actionIndex: 5,
						label: "Call 100",
						frequency: "0%",
						outcome: "rare",
						copiedRange: { source: "clipboard", text: copied },
					},
				],
			},
			{
				line: "UTG-r2",
				parentLine: "",
				viaActionIndex: 2,
				actor: "HJ",
				actions: [{
					actionIndex: 1,
					label: "Fold",
					terminal: true,
					copiedRange: { source: "clipboard", text: copied },
				}],
			},
		],
	};
	const existing = new Map();
	assert.equal(
		adaptZenoDiscovery(
			discovery,
			"https://zenosolver.com/study?tree=a100p6lr500",
			existing,
		),
		"EP",
	);
	assert.deepEqual(existing.get("EP").actions.map((action) => action.actionIndex), [0, 2, 5]);
	assert.equal(existing.get("EP").actions[1].nextNodeId, "EP_R_MP");
	assert.equal(existing.get("EP").actions[0].terminal, true);
	assert.deepEqual(existing.get("EP").actions[2].tags, ["almost-never-reached"]);

	const solution = convertZenoPreflop({
		state: "preflop",
		meta: META,
		decisions: [...existing.values()],
	});

	test("parses full underscore-delimited Zeno pf histories", () => {
		const copied = parseZenoStrategyArray(zeros());
		const discovery = {
			decisions: [{
				line: "UTG-f_HJ-f_CO-f_BTN-r2.5_SB-c_BB-r13.75_BTN-r31.63",
				parentLine: null,
				viaActionIndex: null,
				actor: "SB",
				actions: [{
					actionIndex: 0,
					label: "Fold",
					outcome: "terminal",
					endpointTerminal: true,
					copiedRange: { source: "clipboard", text: copied },
				}],
			}],
		};
		const existing = new Map();
		adaptZenoDiscovery(
			discovery,
			"https://zenosolver.com/study?tree=a100p6lr500" +
			"&pf=UTG-f_HJ-f_CO-f_BTN-r2.5_SB-c_BB-r13.75_BTN-r31.63",
			existing,
			{ allowIncomplete: true },
		);
		assert.equal(
			[...existing.keys()][0],
			"EP_F_MP_F_CO_F_BU_R_SB_C_BB_R_BU_R_SB",
		);
	});

	test("keeps the first source URL stable for merged multi-URL discovery", () => {
		const copied = parseZenoStrategyArray(zeros());
		const decisions = [{
			line: "UTG-f",
			parentLine: null,
			viaActionIndex: null,
			actor: "HJ",
			actions: [{
				actionIndex: 0,
				label: "Fold",
				outcome: "terminal",
				terminal: true,
				copiedRange: { source: "clipboard", text: copied },
			}],
		}];
		const first = new Map();
		assert.equal(
			adaptZenoDiscovery(
				{ decisions },
				"https://zenosolver.com/study?tree=a100p6lr500&pf=UTG-f",
				first,
			),
			"EP_F_MP",
		);

		const second = new Map();
		assert.equal(
			adaptZenoDiscovery(
				{ decisions },
				"https://zenosolver.com/study?tree=a100p6lr500&pf=UTG-f",
				second,
			),
			"EP_F_MP",
		);
		const alternate = new Map();
		assert.equal(
			adaptZenoDiscovery(
				{ decisions },
				"https://zenosolver.com/study?tree=a100p6lr500&pf=UTG-r2.5",
				alternate,
			),
			"EP_R_MP",
		);
	});

	test("rechecks legacy guessed terminal outcomes without discarding rare tags", () => {
		const copied = parseZenoStrategyArray(zeros());
		const stale = {
			decisions: [{
				line: "",
				parentLine: null,
				viaActionIndex: null,
				actor: "UTG",
				actions: [{
					actionIndex: 0,
					label: "Fold",
					outcome: "terminal",
					terminal: false,
					copiedRange: { source: "clipboard", text: copied },
				}],
			}],
		};
		const staleMap = new Map();
		adaptZenoDiscovery(
			stale,
			"https://zenosolver.com/study?tree=a100p6lr500",
			staleMap,
			{ allowIncomplete: true },
		);
		assert.equal(staleMap.get("EP").actions[0].terminal, undefined);

		const rare = structuredClone(stale);
		rare.decisions[0].actions[0].outcome = "rare";
		rare.decisions[0].actions[0].tags = ["almost-never-reached"];
		const rareMap = new Map();
		adaptZenoDiscovery(
			rare,
			"https://zenosolver.com/study?tree=a100p6lr500",
			rareMap,
			{ allowIncomplete: true },
		);
		assert.deepEqual(
			rareMap.get("EP").actions[0].tags,
			["almost-never-reached"],
		);
		assert.equal(rareMap.get("EP").actions[0].terminal, undefined);
	});
	assert.equal(solution.nodes.EP.actions[1].nextNodeId, "EP_R_MP");
	assert.equal(solution.nodes.EP.actions[0].terminal, true);
	assert.deepEqual(solution.nodes.EP.actions[2].tags, ["almost-never-reached"]);
	assert.equal(solution.nodes.EP.actions[0].rawRangeText, copied);
	assert.equal(solution.nodes.EP.actions[1].rawRangeText, copied);
	assert.equal(solution.nodes.EP.actions[2].rawRangeText, copied);

	delete existing.get("EP").actions[1].nextNodeId;
	existing.delete("EP_R_MP");
	assert.throws(
		() => convertZenoPreflop({
			state: "preflop",
			meta: META,
			decisions: [...existing.values()],
		}),
		/unresolved continuing outcome/,
	);
});

test("rejects duplicate decision/action IDs and missing explicit targets", () => {
	const record = decision("UTG", [], [
		{ action: { type: "fold", terminal: true }, range: zeros() },
	]);
	assert.throws(
		() => convertZenoPreflop({
			state: "preflop",
			meta: META,
			decisions: [record, record],
		}),
		/Duplicate decision node ID/,
	);
	assert.throws(
		() => convertZenoPreflop({
			state: "preflop",
			meta: META,
			decisions: [decision("UTG", [], [
				{ action: { type: "fold", terminal: true }, range: zeros() },
				{ action: { type: "fold", terminal: true }, range: zeros() },
			])],
		}),
		/Duplicate action ID/,
	);
	const missingTarget = decision("UTG", [], [
		{ action: { type: "raise", amount: 2, nextNodeId: "EP_R_MP" }, range: zeros() },
	]);
	assert.throws(
		() => convertZenoPreflop({
			state: "preflop",
			meta: META,
			decisions: [missingTarget],
		}),
		/targets missing node/,
	);
});

test("drafts only actions with resolved outcomes and existing child nodes", () => {
	const range = zeros();
	const root = {
		nodeId: "EP",
		actor: "UTG",
		actions: [
			{ type: "fold", terminal: true, range },
			{ type: "raise", amount: 2, nextNodeId: "EP_R_MP", range },
			{ type: "call", range },
		],
		root: true,
	};
	const child = {
		nodeId: "EP_R_MP",
		actor: "HJ",
		actions: [
			{ type: "fold", outcome: "terminal", range },
			{ type: "raise", amount: 6, nextNodeId: "EP_R_MP_R_CO", range },
		],
	};
	const draft = draftZenoPreflop({
		state: "preflop",
		meta: META,
		rootNodeId: "EP",
		decisions: [root, child],
	});

	assert.deepEqual(Object.keys(draft), ["meta", "rootNodeId", "nodes"]);
	assert.deepEqual(draft.nodes.EP.actions.map((action) => action.id), [
		"fold",
		"raise-2",
		"call",
	]);
	assert.equal(draft.nodes.EP.actions[2].terminal, undefined);
	assert.equal(draft.nodes.EP.actions[2].nextNodeId, undefined);
	assert.equal(draft.nodes.EP_R_MP.actions.length, 2);
	assert.equal(draft.nodes.EP_R_MP.actions[0].terminal, true);
	assert.equal("terminal" in draft.nodes.EP.actions[1], false);
	assert.equal(draft.nodes.EP_R_MP.actions[1].id, "raise-6");
	assert.equal(draft.nodes.EP_R_MP.actions[1].terminal, undefined);
	assert.equal(draft.nodes.EP_R_MP.actions[1].nextNodeId, undefined);
	assert.equal(draft.nodes.EP_R_MP_R_CO, undefined);
	assert.throws(() => {
		convertZenoPreflop({
			state: "preflop",
			meta: META,
			rootNodeId: "EP",
			decisions: [root, child],
		});
	}, /unresolved continuing outcome/);
});

test("does not fabricate terminal outcomes in an early draft", () => {
	const draft = draftZenoPreflop({
		state: "preflop",
		meta: META,
		rootNodeId: "EP",
		decisions: [{
			nodeId: "EP",
			actor: "UTG",
			root: true,
			actions: [{ type: "raise", amount: 2, range: zeros() }],
		}],
	});
	assert.equal(draft.nodes.EP.actions[0].id, "raise-2");
	assert.equal(draft.nodes.EP.actions[0].terminal, undefined);
	assert.equal(draft.nodes.EP.actions[0].nextNodeId, undefined);
});

test("updates the index without adding fields or mutating inputs", () => {
	const original = [{
		id: "old",
		title: "Old",
		game: "Cash",
		stack: 100,
		type: "6-Max",
		format: "6-Max NLHE",
		rake: "Old rake",
		open: "2x",
		threeBet: "GTO",
		cashDrop: "-",
		betSizeText: "2bb open",
		rootPosition: "EP",
	}];
	const solution = {
		meta: META,
		rootNodeId: "EP",
		nodes: { EP: { position: "EP" } },
	};
	const updated = updateSolutionIndex(original, "old", solution, {
		rake: "NL100",
		extra: "discarded",
	});

	assert.deepEqual(Object.keys(updated[0]), [
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
	]);
	assert.equal(updated[0].rake, "NL100");
	assert.equal(updated[0].extra, undefined);
	assert.equal(original[0].title, "Old");
	assert.equal(updateSolutionIndex(updated, "new", solution).length, 2);
});
