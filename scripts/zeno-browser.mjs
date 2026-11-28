const DEFAULT_SELECTORS = Object.freeze({
	actionFilters: "button.afi[data-i][aria-label], button.act-filter[data-i]",
	actionCards: "#aBoxes .abox[data-i], #aBoxes [role='button'][data-i]",
	mobileActions: "#bActs button.act[data-i], button.act[data-i]",
	copyControls:
		"#cRangeBtn[aria-label], button[aria-label='Copy range here'], button[aria-label^='Copy '][aria-label*=' range' i]",
	exactStrategy:
		"#pfRndSw button[data-r='0'], button[data-r='0']",
});

const POSTFLOP_PARAMETERS = [
	"board",
	"cards",
	"flop",
	"turn",
	"river",
	"street",
];

const DEFAULT_OPTIONS = Object.freeze({
	timeout: 20_000,
	decisionTimeout: 8_000,
	endpointTimeout: 2_000,
	maxDecisions: 3_000,
	maxDepth: 32,
	traverse: true,
	actionDelay: 2_000,
	actionJitterPercent: 10,
	initialDecisions: Object.freeze([]),
	onCheckpoint: null,
	rootNodeId: null,
});

export class ZenoPreflopError extends Error {
	constructor(message, code, details) {
		super(message);
		this.name = "ZenoPreflopError";
		this.code = code;
		if (details !== undefined) this.details = details;
	}
}

function requirePage(page) {
	if (
		!page ||
		typeof page.goto !== "function" ||
		typeof page.locator !== "function"
	) {
		throw new TypeError("A Playwright Page is required");
	}
}

function mergeSelectors(selectors) {
	return { ...DEFAULT_SELECTORS, ...(selectors || {}) };
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function randomizeActionDelay(milliseconds, jitterPercent = 10, random = Math.random) {
	if (milliseconds <= 0 || jitterPercent <= 0) return Math.max(0, milliseconds);
	const variation = milliseconds * (jitterPercent / 100);
	const randomized = milliseconds - variation + random() * variation * 2;
	return Math.max(0, Math.round(randomized));
}

function routeFromMobileHash(hash) {
	let raw;
	try {
		raw = decodeURIComponent(String(hash || "").replace(/^#/, ""));
	} catch {
		return null;
	}

	if (!raw.startsWith("b=")) return null;
	const body = raw.slice(2);
	const colon = body.indexOf(":");
	const tree = colon < 0 ? body : body.slice(0, colon);
	const history = colon < 0 ? "" : body.slice(colon + 1);
	return {
		tree,
		history,
		path: history ? history.split(",").filter(Boolean).map(Number) : [],
		validHistory: /^(?:\d+(?:,\d+)*)?$/.test(history),
	};
}

function hasPostflopSignal(url) {
	for (const name of POSTFLOP_PARAMETERS) {
		if (url.searchParams.has(name)) return `URL parameter "${name}"`;
	}

	const raw = `${url.search}${url.hash}`.toLowerCase();
	if (
		/(?:[?&#])(node|hand|solve|report)=/.test(raw) ||
		/#(?:share|report|rpt)=/.test(raw)
	) {
		return "a solve, share, report, or hand route";
	}
	return null;
}

/**
 * Classifies a canonical Zeno study URL without loading it.
 *
 * The returned `kind` is `preflop`, `postflop`, or `unsupported`.
 */
export function classifyZenoStudyUrl(studyUrl) {
	let url;
	try {
		url = new URL(String(studyUrl));
	} catch {
		return {
			kind: "unsupported",
			reason: "invalid URL",
		};
	}

	const host = url.hostname.toLowerCase();
	const allowedHost = host === "zenosolver.com" || host === "www.zenosolver.com";
	const allowedPath = /^\/(?:study|m\.html)\/?$/.test(url.pathname);
	if (url.protocol !== "https:" || !allowedHost || !allowedPath) {
		return {
			kind: "unsupported",
			reason: "not a canonical zenosolver.com study URL",
			url,
		};
	}

	const postflopSignal = hasPostflopSignal(url);
	if (postflopSignal) {
		return {
			kind: "postflop",
			reason: `route contains ${postflopSignal}`,
			url,
		};
	}

	const mobile = routeFromMobileHash(url.hash);
	if (
		mobile &&
		!mobile.validHistory
	) {
		return {
			kind: "postflop",
			reason: "mobile route contains a postflop history suffix",
			url,
		};
	}
	const tree = url.searchParams.get("tree") || (mobile && mobile.tree) || "";
	const history = mobile ? mobile.history : "";
	if (!tree) {
		return {
			kind: "unsupported",
			reason: "study URL has no preflop tree",
			url,
		};
	}

	return {
		kind: "preflop",
		reason: null,
		url,
		tree,
		line: url.searchParams.get("pf") || null,
		history,
		path: mobile ? mobile.path : [],
	};
}

function assertPreflopStudyUrl(studyUrl) {
	const classification = classifyZenoStudyUrl(studyUrl);
	if (classification.kind !== "preflop") {
		throw new ZenoPreflopError(
			classification.reason || "not a preflop study",
			classification.kind === "postflop"
				? "POSTFLOP_ROUTE"
				: "UNSUPPORTED_ROUTE",
		);
	}
	return classification;
}

export async function waitForPreflopDecision(page, timeout) {
	await page.waitForFunction(
		() => {
			const isVisible = (element) =>
				element &&
				!element.hidden &&
				element.getClientRects().length > 0 &&
				getComputedStyle(element).visibility !== "hidden";
			const desktopActor = document.querySelector(
				"#bStrip .ncard.cur .pos, #bStrip .pf.cur .pos",
			);
			const mobileActor = document.querySelector(
				"#bStrip .chip.cur b, button.chip.cur b",
			);
			const actions = [
				...document.querySelectorAll(
					"#aBoxes .abox[data-i], #bActs button.act[data-i], button.act[data-i]",
				),
			].filter(isVisible);
			return !!(desktopActor || mobileActor) && actions.length > 0;
		},
		null,
		{ timeout },
	);
}

async function waitForNavigatedPageState(page, timeout) {
	await page.waitForFunction(
		() => {
			const isVisible = (element) =>
				element &&
				!element.hidden &&
				element.getClientRects().length > 0 &&
				getComputedStyle(element).visibility !== "hidden";
			const actions = [
				...document.querySelectorAll(
					"#aBoxes .abox[data-i], #bActs button.act[data-i], button.act[data-i]",
				),
			].filter(isVisible);
			const text = (document.body.innerText || "").toLowerCase();
			const hasDecision =
				actions.length > 0 &&
				(document.querySelector("#bStrip .ncard.cur .pos") ||
					document.querySelector("#bStrip .pf.cur .pos") ||
					document.querySelector("#bStrip .chip.cur b") ||
					document.querySelector("button.chip.cur b"));
			const hasOutcome =
				text.includes("almost never reached") ||
				/\bhand[\s-]+over\b/.test(text) ||
				/\bflop\b/.test(text) ||
				/\bsign in to see the strategy\b/.test(text) ||
				/\bpaused for today\b/.test(text) ||
				/\bbackground loading\b/.test(text);
			return Boolean(hasDecision || hasOutcome);
		},
		null,
		{ timeout },
	);
}

/**
 * Reads only the visible Zeno decision UI. No range or action is converted to
 * the viewer's solution format.
 */
export async function readVisiblePreflopDecision(page) {
	requirePage(page);
	return page.evaluate(() => {
		const current =
			document.querySelector("#bStrip .ncard.pf.cur") ||
			document.querySelector("#bStrip .pf.cur") ||
			document.querySelector(".ncard.cur");
		const mobileCurrent =
			document.querySelector("#bStrip button.chip.cur") ||
			document.querySelector("button.chip.cur");
		const actorElement =
			(current && current.querySelector(".pos")) ||
			(mobileCurrent && mobileCurrent.querySelector("b"));
		const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

		let actionElements = [...document.querySelectorAll("#aBoxes .abox[data-i]")];
		let mode = "desktop";
		if (
			actionElements.length === 0 ||
			!actionElements.some(
				(element) =>
					!element.hidden &&
					element.getClientRects().length > 0 &&
					getComputedStyle(element).visibility !== "hidden",
			)
		) {
			actionElements = [
				...document.querySelectorAll(
					"#bActs button.act[data-i], button.act[data-i]",
				),
			];
			mode = "mobile";
		}
		actionElements = actionElements.filter(
			(element) =>
				!element.hidden &&
				element.getClientRects().length > 0 &&
				getComputedStyle(element).visibility !== "hidden",
		);

		if (!actorElement || actionElements.length === 0) return null;

		const historyButton =
			(current && current.querySelector("[data-pfh]")) ||
			document.querySelector("#bStrip .pf.cur [data-pfh]");
		let history =
			(historyButton && historyButton.getAttribute("data-pfh")) || null;
		const route = new URL(location.href);
		const hash = decodeURIComponent(route.hash.replace(/^#/, ""));
		let tree = "";
		if (hash.startsWith("b=")) {
			const body = hash.slice(2);
			const colon = body.indexOf(":");
			tree = colon < 0 ? body : body.slice(0, colon);
			if (history === null) {
				history = colon < 0 ? "" : body.slice(colon + 1);
			}
		}
		tree =
			(document.querySelector("#stackSel") &&
				document.querySelector("#stackSel").value) ||
			route.searchParams.get("tree") ||
			tree;
		history = history || "";
		const line = route.searchParams.get("pf");

		const actions = actionElements.map((element) => {
			const label = clean(
				(element.querySelector(".al, [data-action-label]") || element)
					.textContent,
			);
			const comboElement = element.querySelector(".ac");
			const frequencyElement = element.querySelector(".ap");
			return {
				actionIndex: Number(element.getAttribute("data-i")),
				label,
				frequency: frequencyElement
					? clean(frequencyElement.textContent)
					: null,
				combos: comboElement
					? clean(
							comboElement.textContent.replace(
								/\s*combos?\s*$/i,
								"",
							),
						)
					: null,
			};
		});

		return {
			mode,
			url: location.href,
			tree,
			line,
			history,
			path: history
				? history
						.split(",")
						.filter(Boolean)
						.map((value) => {
							const number = Number(value);
							return Number.isNaN(number) ? value : number;
						})
				: [],
			actor: clean(actorElement.textContent),
			actions,
		};
	});
}

function createDefaultClipboard(page) {
	return {
		async clear() {
			await page.bringToFront?.();
			await page.evaluate(async () => {
				await navigator.clipboard.writeText("");
			});
		},
		async read() {
			return page.evaluate(async () => navigator.clipboard.readText());
		},
	};
}

async function visibleLocator(page, selector) {
	const locator = page.locator(selector);
	const count = await locator.count();
	for (let index = 0; index < count; index += 1) {
		const candidate = locator.nth(index);
		if (await candidate.isVisible().catch(() => false)) return candidate;
	}
	return null;
}

async function exactControlIsSelected(locator) {
	const pressed = await locator.getAttribute("aria-pressed");
	if (pressed !== null) return pressed === "true";
	const className = await locator.getAttribute("class");
	return String(className || "").split(/\s+/).includes("on");
}

function withDataIndex(selector, actionIndex) {
	return selector
		.split(",")
		.map((part) => `${part.trim()}[data-i='${actionIndex}']`)
		.join(", ");
}

async function waitForValue(read, predicate, timeout, interval = 75) {
	const started = Date.now();
	let latest;
	while (Date.now() - started < timeout) {
		latest = await read();
		if (predicate(latest)) return latest;
		await delay(interval);
	}
	return latest;
}

/**
 * Selects one visible action's range, clears and verifies the clipboard, then
 * clicks Zeno's own copy control. It never derives range text from the DOM grid.
 */
export async function copyVisibleActionRange(page, action, options = {}) {
	requirePage(page);
	const selectors = mergeSelectors(options.selectors);
	const timeout = options.timeout || DEFAULT_OPTIONS.timeout;
	const clipboard = options.clipboard || createDefaultClipboard(page);

	if (!clipboard || !clipboard.clear || !clipboard.read) {
		throw new TypeError("clipboard must provide clear() and read()");
	}

	const filterSelector = withDataIndex(
		selectors.actionFilters,
		action.actionIndex,
	);
	let exact = await visibleLocator(page, selectors.exactStrategy);
	let filter = await visibleLocator(page, filterSelector);
	const copySelector = selectors.copyControls;
	let copy = await visibleLocator(page, copySelector);

	// Mobile study pages do not expose the action filter. Their API response is
	// the supported fallback and the action buttons are reserved for navigation.
	if (!exact || !filter || !copy) {
		return {
			ok: false,
			source: "unavailable",
			reason: !exact
				? "Exact strategy control is not visible"
				: "copy control or action filter is not visible",
		};
	}

	if (!(await exactControlIsSelected(exact))) {
		await exact.click();
		await waitForValue(
			() => exactControlIsSelected(exact),
			(value) => value === true,
			timeout,
		);
	}

	if ((await filter.getAttribute("aria-pressed")) !== "true") {
		await filter.click();
		await waitForValue(
			() => filter.getAttribute("aria-pressed"),
			(value) => value === "true",
			timeout,
		);
	}

	// Re-resolve all controls after Zeno's state updates. This deliberately
	// rejects stale locators or stale selections rather than copying whatever
	// range happened to be on screen.
	exact = await visibleLocator(page, selectors.exactStrategy);
	filter = await visibleLocator(page, filterSelector);
	copy = await visibleLocator(page, copySelector);
	if (
		!exact ||
		!filter ||
		!copy ||
		!(await exactControlIsSelected(exact)) ||
		(await filter.getAttribute("aria-pressed")) !== "true"
	) {
		return {
			ok: false,
			source: "selection",
			reason:
				"Exact and the requested action were not both selected before Copy",
		};
	}

	try {
		await clipboard.clear();
		const baseline = await clipboard.read();
		if (String(baseline) !== "") {
			return {
				ok: false,
				source: "clipboard",
				reason: "clipboard did not clear",
			};
		}

		// A range rerender can happen while the clipboard is being cleared.
		exact = await visibleLocator(page, selectors.exactStrategy);
		filter = await visibleLocator(page, filterSelector);
		copy = await visibleLocator(page, copySelector);
		if (
			!exact ||
			!filter ||
			!copy ||
			!(await exactControlIsSelected(exact)) ||
			(await filter.getAttribute("aria-pressed")) !== "true"
		) {
			return {
				ok: false,
				source: "selection",
				reason: "strategy selection changed before Copy",
			};
		}

		await copy.click();
		const text = await waitForValue(
			() => clipboard.read().then((value) => String(value)),
			(value) => value.length > 0,
			timeout,
		);
		if (!text) {
			return {
				ok: false,
				source: "clipboard",
				reason: "Zeno copy control did not change the verified empty clipboard",
			};
		}
		return {
			ok: true,
			source: "clipboard",
			text,
		};
	} catch (error) {
		return {
			ok: false,
			source: "clipboard",
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}

function responseKey(tree, lineOrHistory) {
	return `${tree}\u0000${lineOrHistory || ""}`;
}

/**
 * Attaches a listener that preserves the raw JSON from successful public
 * /api/preflop responses. Call `stop()` when discovery finishes.
 */
export function createPreflopResponseCollector(page, options = {}) {
	requirePage(page);
	const responses = new Map();
	const onResponse = options.onResponse;
	let stopped = false;

	const listener = (response) => {
		let route;
		try {
			route = new URL(response.url());
		} catch {
			return;
		}
		if (route.hostname !== "zenosolver.com" || route.pathname !== "/api/preflop") {
			return;
		}
		const key = responseKey(
			treeKeyFromPreflopQuery(route.searchParams),
			route.searchParams.get("line") || route.searchParams.get("h") || "",
		);
		const job = (async () => {
			try {
				let data = null;
				try {
					data = await response.json();
				} catch {
					data = null;
				}
				const captured = {
					requestUrl: response.url(),
					status: response.status(),
					data,
				};
				responses.set(key, captured);
				await onResponse?.(captured);
				return captured;
			} catch {
				return null;
			}
		})();
		responses.set(key, { pending: job });
	};

	page.on("response", listener);
	return {
		async get(tree, lineOrHistory) {
			const captured = responses.get(responseKey(tree, lineOrHistory));
			if (!captured) return null;
			return captured.pending ? captured.pending : captured;
		},
		async assertNotRateLimited() {
			const captures = await Promise.all(
				[...responses.values()].map((value) =>
					value.pending ? value.pending : value,
				),
			);
			const blocked = captures.find((value) => value?.status === 429);
			if (blocked) {
				throw new ZenoPreflopError(
					"Zeno rate-limited strategy loading. Rerun after its chart-loading quota resets.",
					"RATE_LIMITED",
					{ status: blocked.status, url: blocked.requestUrl },
				);
			}
		},
		all() {
			return [...responses.entries()].map(([key, value]) => ({
				key,
				value,
			}));
		},
		stop() {
			if (stopped) return;
			stopped = true;
			page.off?.("response", listener);
		},
	};
}

function treeKeyFromPreflopQuery(params) {
	const stack = params.get("stack") || "";
	const format = params.get("format") || "";
	const variant = params.get("variant") || "";
	if (format === "ante") return `a${stack}${variant}`;
	if (format === "hu") return `hu${stack}${variant}`;
	if (format === "9max") return `9max${stack}${variant}`;
	if (format === "fl") return `fl${variant}${stack}`;
	return stack;
}

function setTreeQuery(endpoint, tree) {
	const ante = /^a(\d+)(p\d[a-z0-9]*)$/i.exec(tree);
	const hu = /^hu(\d+)(.*)$/i.exec(tree);
	const nineMax = /^9max(\d+)(a?)$/i.exec(tree);
	const fixedLimit = /^fl([a-z]*)(\d+)(nr)?$/i.exec(tree);
	if (ante) {
		endpoint.searchParams.set("stack", ante[1]);
		endpoint.searchParams.set("format", "ante");
		endpoint.searchParams.set("variant", ante[2]);
		return;
	}
	if (hu) {
		endpoint.searchParams.set("stack", hu[1]);
		endpoint.searchParams.set("format", "hu");
		if (hu[2]) endpoint.searchParams.set("variant", hu[2]);
		return;
	}
	if (nineMax) {
		endpoint.searchParams.set("stack", nineMax[1]);
		endpoint.searchParams.set("format", "9max");
		if (nineMax[2]) endpoint.searchParams.set("variant", nineMax[2]);
		return;
	}
	if (fixedLimit) {
		endpoint.searchParams.set("stack", fixedLimit[2]);
		endpoint.searchParams.set("format", "fl");
		if (fixedLimit[1]) endpoint.searchParams.set("variant", fixedLimit[1]);
		if (fixedLimit[3]) endpoint.searchParams.set("rake", "0");
		return;
	}
	if (/^\d+(?:\.\d+)?$/.test(tree)) {
		endpoint.searchParams.set("stack", tree);
		return;
	}
	throw new ZenoPreflopError(
		`Cannot reconstruct /api/preflop tree query from "${tree}"`,
		"API_FALLBACK_ROUTE",
	);
}

async function fetchDecisionResponse(page, decision) {
	const endpoint = new URL("/api/preflop", page.url());
	setTreeQuery(endpoint, decision.tree);
	if (decision.line) endpoint.searchParams.set("line", decision.line);
	else endpoint.searchParams.set("h", decision.history || "");

	const result = await page.evaluate(async (requestUrl) => {
		const response = await fetch(requestUrl, {
			credentials: "same-origin",
		});
		const text = await response.text();
		return {
			requestUrl,
			status: response.status,
			ok: response.ok,
			text,
		};
	}, endpoint.href);

	if (!result.ok) {
		if (result.status === 429) {
			throw new ZenoPreflopError(
				"Zeno rate-limited strategy loading. Rerun after its chart-loading quota resets.",
				"RATE_LIMITED",
				{ status: result.status, url: result.requestUrl },
			);
		}
		throw new ZenoPreflopError(
			`Zeno /api/preflop fallback returned ${result.status}`,
			"API_FALLBACK_FAILED",
			{ status: result.status },
		);
	}

	try {
		return {
			requestUrl: result.requestUrl,
			status: result.status,
			data: JSON.parse(result.text),
		};
	} catch (error) {
		throw new ZenoPreflopError(
			"Zeno /api/preflop fallback returned invalid JSON",
			"API_FALLBACK_FAILED",
			{ cause: error },
		);
	}
}

async function getDecisionResponse(
	page,
	decision,
	collector,
	fetchResponse = fetchDecisionResponse,
) {
	const routeIdentity = decision.line || decision.history;
	let captured = await collector.get(decision.tree, routeIdentity);
	if (!captured && decision.history && decision.history !== routeIdentity) {
		captured = await collector.get(decision.tree, decision.history);
	}
	const response = captured || await fetchResponse(page, decision);
	if (!response) return null;
	if (response.status === 429) {
		throw new ZenoPreflopError(
			"Zeno rate-limited strategy loading. Rerun after its chart-loading quota resets.",
			"RATE_LIMITED",
			{ status: response.status, url: response.requestUrl || decision.url },
		);
	}
	if (Object.hasOwn(response, "data")) return response;
	return {
		requestUrl: response.requestUrl || null,
		status: response.status || null,
		data: response,
	};
}

async function actionNavigationLocator(page, action, selectors) {
	const desktop = await visibleLocator(
		page,
		withDataIndex(selectors.actionCards, action.actionIndex),
	);
	if (desktop) return desktop;
	return visibleLocator(
		page,
		withDataIndex(selectors.mobileActions, action.actionIndex),
	);
}

async function pageRequiresSignIn(page) {
	return page.evaluate(() => {
		const visible = (element) =>
			element &&
			!element.hidden &&
			element.getClientRects().length > 0 &&
			getComputedStyle(element).visibility !== "hidden";
		const warning = [...document.querySelectorAll("*")].some(
			(element) =>
				visible(element) &&
				element.children.length === 0 &&
				element.textContent?.trim() === "⚠",
		);
		const signInControl = [
			...document.querySelectorAll("button, a, [role='button']"),
		].some(
			(element) =>
				visible(element) &&
				/^(?:sign|log) in$/i.test(element.textContent?.trim() || ""),
		);
		const errorText = document.body.innerText.toLowerCase();
		return (
			errorText.includes("sign in to see the strategy") ||
			(warning && errorText.includes("sign in")) ||
			signInControl
		);
	});
}

async function clickActionAndWait(page, action, selectors, timeout) {
	const locator = await actionNavigationLocator(page, action, selectors);
	if (!locator) return false;
	const beforeUrl = page.url();
	const before = await readVisiblePreflopDecision(page);
	await locator.click();
	try {
		await page.waitForURL((url) => url.href !== beforeUrl, { timeout });
	} catch {
		const current = await readVisiblePreflopDecision(page);
		if (!current) return true;
		return (
			current.url !== before?.url ||
			current.line !== before?.line ||
			current.history !== before?.history ||
			current.actor !== before?.actor ||
			current.actions
				.map((item) => item.actionIndex)
				.join(",") !==
				(before?.actions || []).map((item) => item.actionIndex).join(",")
		);
	}
	return page.url() !== beforeUrl;
}

function decisionKey(decision) {
	return `${decision.tree || ""}\u0000${decision.line || decision.history || ""}`;
}

function recordLine(record) {
	if (record?.line) return String(record.line);
	if (record?.history) return String(record.history);
	if (!record?.url) return "";
	try {
		const url = new URL(record.url);
		const route = routeFromMobileHash(url.hash);
		return url.searchParams.get("pf") || route?.history || "";
	} catch {
		return "";
	}
}

function recordKey(record) {
	return `${record?.tree || ""}\u0000${recordLine(record)}`;
}

function findDecision(decisions, tree, line) {
	return decisions.find(
		(record) => record.tree === tree && recordLine(record) === line,
	);
}

function actionIsResolved(action, decisions, seen) {
	if (isTerminalAction(action) || ["terminal", "rare"].includes(action.outcome)) {
		return true;
	}
	if (!action.childLine) return false;
	const child = findDecision(decisions, action.tree || "", action.childLine);
	const parentlessChild = child || decisions.find(
		(record) => recordLine(record) === action.childLine,
	);
	return Boolean(
		parentlessChild &&
		decisionIsComplete(parentlessChild, decisions, new Set(seen)),
	);
}

function decisionIsComplete(decision, decisions, seen = new Set()) {
	const key = recordKey(decision);
	if (seen.has(key)) return false;
	const nextSeen = new Set(seen);
	nextSeen.add(key);
	return (
		Array.isArray(decision.actions) &&
		decision.actions.length > 0 &&
		decision.actions.every((action) =>
			actionIsResolved(action, decisions, nextSeen),
		)
	);
}

function childLineUrl(currentUrl, childLine) {
	const next = new URL(currentUrl);
	const hashRoute = routeFromMobileHash(next.hash);
	if (hashRoute && hashRoute.validHistory && !next.searchParams.has("pf")) {
		next.hash = `b=${hashRoute.tree}:${childLine}`;
	} else {
		next.searchParams.set("pf", childLine);
	}
	return next.href;
}

async function visibleActionTarget(page, action, selectors) {
	const locator = await actionNavigationLocator(page, action, selectors);
	if (!locator) return null;
	return locator.evaluate((element) => {
		const candidates = [
			element,
			...element.querySelectorAll("a[href], [href], [data-href], [data-url]"),
			element.closest("a[href]"),
		].filter(Boolean);
		const attributes = [
			"href",
			"data-href",
			"data-url",
			"data-target",
			"data-line",
			"data-pfh",
		];
		for (const candidate of candidates) {
			for (const attribute of attributes) {
				const value = candidate.getAttribute(attribute);
				if (value) return { attribute, value };
			}
		}
		return null;
	});
}

function exactActionUrl(currentUrl, action, target) {
	if (!target) return null;
	const { attribute, value } = target;
	const stringValue = String(value).trim();
	if (!stringValue) return null;
	try {
		const url = new URL(stringValue, currentUrl);
		const classification = classifyZenoStudyUrl(url.href);
		if (classification.kind === "preflop") return url.href;
	} catch {
		// A symbolic pf line or mobile history is not a URL.
	}
	if (
		attribute === "href" ||
		attribute === "data-href" ||
		attribute === "data-url" ||
		attribute === "data-target"
	) {
		return null;
	}
	return childLineUrl(currentUrl, stringValue);
}

function apiActionTarget(action) {
	const candidates = action?.apiAction;
	if (!candidates || typeof candidates !== "object") return null;
	for (const key of [
		"childLine",
		"nextLine",
		"line",
		"pf",
		"targetLine",
		"history",
		"url",
		"href",
		"targetUrl",
	]) {
		const value = candidates[key];
		if (typeof value === "string" && value.trim()) {
			return {
				attribute: /url|href/i.test(key) ? key : "data-line",
				value,
			};
		}
	}
	return null;
}

function responseNode(api, decision) {
	if (Array.isArray(api && api.data && api.data.nodes)) {
		const nodes = api.data.nodes;
		if (decision.line) return nodes[nodes.length - 1] || null;
		const historyLength = Array.isArray(decision.path)
			? decision.path.length
			: nodes.length - 1;
		return nodes[Math.min(historyLength, nodes.length - 1)] || null;
	}
	return api && api.data && !Array.isArray(api.data.nodes) ? api.data : null;
}

function isTerminalAction(action) {
	return (
		action.terminal === true ||
		(action.apiAction &&
			(action.apiAction.terminal === true || action.apiAction.end === true))
	);
}

function actionTraversalRank(action) {
	const label = String(action?.label || "").trim();
	if (/^fold\b/i.test(label)) return 0;
	if (/^call\b/i.test(label)) return 1;
	if (/^(?:raise|open|bet)\b/i.test(label)) return 2;
	if (/^(?:allin|jam)\b/i.test(label)) return 3;
	return 4;
}

function classifyCurrentDecision(page, decision, originalUrl) {
	const route = classifyZenoStudyUrl(decision.url);
	if (route.kind === "postflop") {
		return {
			kind: "postflop",
			reason: route.reason,
		};
	}
	if (route.kind === "preflop") {
		return { kind: "preflop" };
	}

	// Zeno's desktop app occasionally changes the query's symbolic `pf` form
	// after it has already been classified as a preflop tree. The visible
	// decision is still authoritative as long as the normalized study origin
	// and path remain unchanged.
	const current = new URL(page.url());
	const original = new URL(originalUrl);
	if (
		current.origin === original.origin &&
		(current.pathname === "/study" || current.pathname === "/m.html") &&
		decision.actor &&
		decision.actions.length > 0
	) {
		return { kind: "preflop" };
	}
	return { kind: "unsupported", reason: route.reason };
}

export function classifyZenoOutcomeText(value) {
	const text = String(value || "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
	const almostNeverReached =
		/almost never reached:\s*the solution plays this line in fewer than 1 in 10,?000 hands,\s*so its strategy is not saved\.?/i
			.test(text);

	if (
		/\b(?:429|rate[\s-]+limit|paused for today|background loading)\b/.test(text)
	) {
		return "blocked";
	}
	if (
		almostNeverReached ||
		/(?:probability|frequency)\s*(?:is|of|:)?\s*0(?:\.0+)?\s*%/.test(text) ||
		/\bline probability below\b/.test(text)
	) {
		return "rare";
	}
	if (
		/\bhand[\s-]+over\b/.test(text) ||
		/\b(?:select|choose|pick|open)\s+(?:a\s+)?flop\b/.test(text) ||
		/\bflop\s+(?:solver|selection|cards?)\b/.test(text) ||
		/\bflop\b/.test(text) ||
		/\b(?:turn|river|showdown|postflop)\b/.test(text)
	) {
		return "terminal";
	}
	return "unknown";
}

async function classifyNoDecisionPage(page) {
	const text = await page.evaluate(() => document.body.innerText);
	return classifyZenoOutcomeText(text);
}

export function classifyPreflopResponse(response) {
	const status = response?.status;
	const data = response?.data;
	const error = String(data?.error || "").toLowerCase();
	if (status === 429) return "blocked";
	if (status === 401 || status === 403) return "auth";
	if (
		status === 400 &&
		(
			/almost never reached:\s*the solution plays this line in fewer than 1 in 10,?000 hands,\s*so its strategy is not saved\.?/i.test(String(data?.error || data?.message || "")) ||
			/line probability below/.test(error) ||
			/strategy (?:was not|is not) saved/.test(error)
		)
	) {
		return "rare";
	}
	if (
		data?.terminal === true ||
		data?.flop != null ||
		data?.spot != null ||
		/hand[\s-]+over/.test(error) ||
		/(?:select|choose|pick)\s+(?:a\s+)?flop/.test(error) ||
		(status === 400 && /-way flop: not available here yet/.test(error))
	) {
		return "terminal";
	}
	return null;
}

function endpointTreeAndLine(pageUrl) {
	const url = new URL(pageUrl);
	const tree = url.searchParams.get("tree")
		|| routeFromMobileHash(url.hash)?.tree
		|| "";
	const line = url.searchParams.get("pf")
		|| routeFromMobileHash(url.hash)?.history
		|| "";
	return { tree, line };
}

function enrichActions(decision, copiedRanges, api) {
	const node = responseNode(api, decision);
	return decision.actions.map((action) => {
		const copiedRange = copiedRanges[action.actionIndex];
		const apiAction =
			(node &&
				Array.isArray(node.actions) &&
				node.actions[action.actionIndex]) ||
			null;
		return {
			actionIndex: action.actionIndex,
			label: action.label,
			...(action.frequency !== null ? { frequency: action.frequency } : {}),
			...(action.combos !== null ? { combos: action.combos } : {}),
			copiedRange,
			terminal: isTerminalAction({ ...action, apiAction }),
			...(apiAction ? { apiAction } : {}),
		};
	});
}

/**
 * Loads and safely traverses the visible preflop action tree under `studyUrl`.
 *
 * `initialDecisions` is a JSON-array snapshot of the raw records returned in
 * `decisions`. `onCheckpoint` is awaited with a detached JSON-serializable
 * `{ sourceUrl, rootNodeId, decisions, metadata }` snapshot; `rootNodeId` is
 * supplied by the caller when it is known.
 *
 * Output is discovery data only: it retains copied strings and, when needed,
 * Zeno's raw /api/preflop JSON. It deliberately does not create solution nodes,
 * IDs, or normalized actions.
 */
export async function discoverZenoPreflop(page, studyUrl, options = {}) {
	requirePage(page);
	const initialRoute = assertPreflopStudyUrl(studyUrl);
	const settings = { ...DEFAULT_OPTIONS, ...(options || {}) };
	const selectors = mergeSelectors(options.selectors);
	const clipboard = options.clipboard || createDefaultClipboard(page);
	const warnings = [];
	if (!Array.isArray(settings.initialDecisions)) {
		throw new TypeError("initialDecisions must be an array");
	}
	const decisions = structuredClone(settings.initialDecisions);
	const visited = new Set(decisions.map(recordKey));
	let limitReached = false;
	const collector =
		options.responseCollector || createPreflopResponseCollector(page, options);

	const warn = (warning) => {
		warnings.push(warning);
		options.onWarning?.(warning);
	};
	const timing = async (event) => {
		await options.onTiming?.(event);
	};
	const limits = () => ({
		maxDecisions: settings.maxDecisions,
		maxDepth: settings.maxDepth,
		visited: visited.size,
		reached: limitReached,
	});
	const checkpoint = async () => {
		if (!settings.onCheckpoint) return;
		const snapshot = structuredClone({
			sourceUrl: initialRoute.url.href,
			rootNodeId: settings.rootNodeId ?? null,
			decisions,
			metadata: {
				warnings,
				limits: limits(),
			},
		});
		const startedAt = Date.now();
		try {
			await settings.onCheckpoint(snapshot);
		} finally {
			await timing({
				type: "checkpoint",
				duration: Date.now() - startedAt,
			});
		}
	};
	const rateLimited = (error) =>
		error?.code === "RATE_LIMITED" ||
		error?.details?.status === 429 ||
		error?.status === 429;
	const assertNotRateLimited = async () => {
		try {
			await collector.assertNotRateLimited?.();
		} catch (error) {
			await checkpoint();
			throw error;
		}
	};
	let navigationCount = 0;
	const navigationDelay = async () => {
		if (navigationCount === 0 || settings.actionDelay <= 0) return;
		await delay(randomizeActionDelay(
			settings.actionDelay,
			settings.actionJitterPercent,
		));
	};
	const navigate = async (
		url,
		waitUntil = "domcontentloaded",
		timingType = "navigation",
	) => {
		await navigationDelay();
		const startedAt = Date.now();
		try {
			const response = await page.goto(url, {
				waitUntil,
				timeout: settings.timeout,
			});
			navigationCount += 1;
			const status =
				typeof response?.status === "function"
					? response.status()
					: response?.status;
			if (status === 429) {
				await checkpoint();
				throw new ZenoPreflopError(
					"Zeno rate-limited strategy loading. Rerun after its chart-loading quota resets.",
					"RATE_LIMITED",
					{ status, url },
				);
			}
			await assertNotRateLimited();
		} finally {
			await timing({
				type: timingType,
				line: (() => {
					try {
						return classifyZenoStudyUrl(url).line || "";
					} catch {
						return "";
					}
				})(),
				outcome: "navigate",
				duration: Date.now() - startedAt,
			});
		}
	};

	try {
		const classifyEndpointImmediately = async () => {
			const startedAt = Date.now();
			const { tree, line } = endpointTreeAndLine(page.url());
			const response = await collector.get(tree, line);
			const responseOutcome = classifyPreflopResponse(response);
			const outcome = responseOutcome ?? await classifyNoDecisionPage(page);
			await options.onTiming?.({
				type: "endpoint-classify",
				line,
				outcome,
				duration: Date.now() - startedAt,
			});
			return { tree, line, response, outcome };
		};

		const readNavigatedDecision = async () => {
			await assertNotRateLimited();
			const startedAt = Date.now();
			const immediateDecision = await readVisiblePreflopDecision(page);
			if (
				immediateDecision?.actor &&
				Array.isArray(immediateDecision.actions) &&
				immediateDecision.actions.length > 0
			) {
				await timing({
					type: "decision-load",
					line: immediateDecision.line || immediateDecision.history || "",
					outcome: "continue",
					duration: Date.now() - startedAt,
				});
				return {
					outcome: "continue",
					decision: immediateDecision,
				};
			}
			let classified = await classifyEndpointImmediately();
			if (["terminal", "rare", "blocked"].includes(classified.outcome)) {
				return { outcome: classified.outcome, decision: null };
			}
			if (classified.outcome === "auth") {
				throw new ZenoPreflopError(
					"Zeno requires sign-in to scrape this preflop branch.",
					"AUTH_REQUIRED",
					{ url: page.url(), status: classified.response?.status },
				);
			}

			try {
				await waitForNavigatedPageState(
					page,
					Math.min(settings.endpointTimeout, settings.decisionTimeout),
				);
			} catch {
				// The remaining decision time is used below for normal strategy loading.
			}
			classified = await classifyEndpointImmediately();
			const loadedDecision = await readVisiblePreflopDecision(page);
			if (
				loadedDecision?.actor &&
				Array.isArray(loadedDecision.actions) &&
				loadedDecision.actions.length > 0
			) {
				return {
					outcome: "continue",
					decision: loadedDecision,
				};
			}
			if (["terminal", "rare", "blocked"].includes(classified.outcome)) {
				return { outcome: classified.outcome, decision: null };
			}
			if (classified.outcome === "auth") {
				throw new ZenoPreflopError(
					"Zeno requires sign-in to scrape this preflop branch.",
					"AUTH_REQUIRED",
					{ url: page.url(), status: classified.response?.status },
				);
			}

			const remaining = Math.max(
				1,
				settings.decisionTimeout - (Date.now() - startedAt),
			);
			try {
				await waitForPreflopDecision(page, remaining);
			} catch {
				const final = await classifyEndpointImmediately();
				if (await pageRequiresSignIn(page)) {
					throw new ZenoPreflopError(
						"Zeno requires sign-in to scrape this preflop branch. Run with --login and provide an authenticated --storage-state.",
						"AUTH_REQUIRED",
						{ url: page.url(), status: final.response?.status },
					);
				}
				if (!["terminal", "rare", "blocked"].includes(final.outcome)) {
					throw new ZenoPreflopError(
						`Zeno did not expose a classifiable outcome at "${final.line}".`,
						"UNKNOWN_OUTCOME",
						{ url: page.url(), status: final.response?.status },
					);
				}
				await options.onTiming?.({
					type: "decision-timeout",
					line: final.line,
					outcome: final.outcome,
					duration: Date.now() - startedAt,
				});
				return { outcome: final.outcome, decision: null };
			}
			await options.onTiming?.({
				type: "decision-load",
				line: classified.line,
				outcome: "continue",
				duration: Date.now() - startedAt,
			});
			return {
				outcome: "continue",
				decision: await readVisiblePreflopDecision(page),
			};
		};

		const queue = [];
		const queued = new Set();
		const enqueue = (item, prepend = false) => {
			if (!item?.url) return;
			const key = [
				new URL(item.url).href,
				item.source?.tree || "",
				item.source?.parentLine || "",
				item.source?.actionIndex ?? "",
				item.probeActionIndexes?.join(",") || "",
			].join("\u0000");
			if (queued.has(key)) return;
			queued.add(key);
			if (prepend) queue.unshift(item);
			else queue.push(item);
		};
		const depthOf = (record) => {
			let depth = 0;
			const seen = new Set();
			let current = record;
			while (current?.parentLine != null && !seen.has(recordKey(current))) {
				seen.add(recordKey(current));
				current = findDecision(decisions, current.tree, current.parentLine);
				if (!current) break;
				depth += 1;
			}
			return depth;
		};
		const getSourceAction = (source) => {
			if (!source) return null;
			return findDecision(decisions, source.tree, source.parentLine)?.actions?.find(
				(action) => action.actionIndex === source.actionIndex,
			) || null;
		};
		const markAction = async (source, outcome, childLine = null) => {
			const action = getSourceAction(source);
			if (!action) return;
			let changed = false;
			if (childLine != null && action.childLine !== childLine) {
				action.childLine = childLine;
				changed = true;
			}
			if (action.outcome !== outcome) {
				action.outcome = outcome;
				changed = true;
			}
			if (outcome === "terminal" && !action.endpointTerminal) {
				action.endpointTerminal = true;
				changed = true;
			}
			if (outcome === "continue" && action.endpointTerminal) {
				delete action.endpointTerminal;
				changed = true;
			}
			if (outcome === "rare") {
				const tags = ["almost-never-reached"];
				if (JSON.stringify(action.tags) !== JSON.stringify(tags)) {
					action.tags = tags;
					changed = true;
				}
			} else if (outcome === "continue" && action.tags?.includes("almost-never-reached")) {
				delete action.tags;
				changed = true;
			}
			if (changed) await checkpoint();
		};
		const isResolved = (action) => isTerminalAction(action) ||
			action.outcome === "rare" ||
			(action.outcome === "terminal" &&
				(action.terminal === true || action.endpointTerminal === true));

		let initializedMutation = false;
		if (decisions.length === 0) {
			enqueue({ url: initialRoute.url.href, depth: 0 });
		} else {
			for (const record of decisions) {
				const probes = [];
				const depth = depthOf(record);
				for (const action of record.actions || []) {
					if (isResolved(action)) {
						if (isTerminalAction(action) && action.outcome !== "terminal") {
							action.outcome = "terminal";
							initializedMutation = true;
						}
						continue;
					}
					const source = {
						tree: record.tree,
						parentLine: recordLine(record),
						actionIndex: action.actionIndex,
					};
					if (!action.childLine) {
						probes.push(action.actionIndex);
						continue;
					}
					const child = findDecision(decisions, record.tree, action.childLine)
						|| decisions.find((item) => recordLine(item) === action.childLine);
					if (!child || !decisionIsComplete(child, decisions)) {
						enqueue({
							url: child?.url || childLineUrl(record.url, action.childLine),
							depth: depth + 1,
							source,
						});
					}
				}
				if (probes.length > 0) {
					enqueue({
						url: record.url || childLineUrl(initialRoute.url.href, recordLine(record)),
						depth,
						probeActionIndexes: probes,
					});
				}
			}
		}
		if (initializedMutation) await checkpoint();

		while (queue.length > 0) {
			const work = queue.shift();
			let state = work.prefetchedState || null;
			if (!state) {
				if (work.depth > settings.maxDepth) {
					limitReached = true;
					warn({
						type: "limit",
						url: work.url,
						reason: `maximum depth ${settings.maxDepth} reached`,
					});
					continue;
				}
				await navigate(work.url, options.waitUntil || "domcontentloaded");
				state = await readNavigatedDecision();
			}
			if (state.outcome === "blocked") {
				await checkpoint();
				throw new ZenoPreflopError(
					"Zeno rate-limited strategy loading. Rerun after its chart-loading quota resets.",
					"RATE_LIMITED",
					{ url: page.url() },
				);
			}
			if (state.outcome === "terminal" || state.outcome === "rare") {
				await markAction(work.source, state.outcome);
				continue;
			}
			if (state.outcome !== "continue" || !state.decision) {
				throw new ZenoPreflopError(
					`Zeno did not expose a classifiable outcome at "${page.url()}".`,
					"UNKNOWN_OUTCOME",
					{ url: page.url() },
				);
			}

			const decision = state.decision;
			const currentClass = classifyCurrentDecision(page, decision, initialRoute.url.href);
			if (currentClass.kind !== "preflop") {
				if (currentClass.kind === "postflop") {
					warn({ type: "postflop", url: page.url(), reason: currentClass.reason });
					await markAction(work.source, "terminal");
					continue;
				}
				throw new ZenoPreflopError(
					currentClass.reason || "navigation left the preflop study",
					"NON_PREFLOP_NAVIGATION",
				);
			}

			const childLine = decision.line ?? decision.history ?? "";
			if (work.source) await markAction(work.source, "continue", childLine);
			const key = decisionKey(decision);
			let record = decisions.find((item) => recordKey(item) === key);
			const existingRecord = Boolean(record);
			if (!existingRecord && decisions.length >= settings.maxDecisions) {
				limitReached = true;
				warn({
					type: "limit",
					url: decision.url,
					reason: `maximum decision count ${settings.maxDecisions} reached`,
				});
				continue;
			}

			if (!record) {
				const copiedRanges = {};
				let copyFailed = false;
				const startedAt = Date.now();
				try {
					for (const action of decision.actions) {
						const copied = await copyVisibleActionRange(page, action, {
							...settings,
							selectors,
							clipboard,
						});
						if (copied.ok) {
							copiedRanges[action.actionIndex] = {
								source: "clipboard",
								text: copied.text,
							};
						} else {
							copyFailed = true;
							copiedRanges[action.actionIndex] = {
								source: "unavailable",
								reason: copied.reason,
							};
						}
					}
				} finally {
					await timing({
						type: "range-copy",
						line: childLine,
						outcome: copyFailed ? "mixed" : "clipboard",
						duration: Date.now() - startedAt,
						actionCount: decision.actions.length,
					});
				}

				let api = null;
				if (copyFailed) {
					try {
						api = await getDecisionResponse(
							page,
							decision,
							collector,
							options.fetchPreflopResponse,
						);
						const node = responseNode(api, decision);
						for (const action of decision.actions) {
							const strategy = node?.strategy?.[action.actionIndex];
							if (
								copiedRanges[action.actionIndex]?.source !== "clipboard" &&
								strategy !== undefined
							) {
								copiedRanges[action.actionIndex] = {
									source: "api-preflop",
									responseUrl: api.requestUrl,
									actionIndex: action.actionIndex,
									strategy,
								};
							}
						}
					} catch (error) {
						if (rateLimited(error)) {
							throw error.code ? error : new ZenoPreflopError(
								"Zeno rate-limited strategy loading. Rerun after its chart-loading quota resets.",
								"RATE_LIMITED",
								{ cause: error },
							);
						}
						warn({
							type: "api",
							url: decision.url,
							reason: error instanceof Error ? error.message : String(error),
						});
					}
				}
				const apiNode = responseNode(api, decision);
				const missingAction = decision.actions.find(
					(action) => !["clipboard", "api-preflop"].includes(
						copiedRanges[action.actionIndex]?.source,
					),
				);
				if ((copyFailed && !apiNode && missingAction) || missingAction) {
					throw new ZenoPreflopError(
						`No copy range or preflop API strategy is available for ${decision.actor} action ${missingAction.label}`,
						"MISSING_RANGE_SOURCE",
					);
				}
				record = {
					url: decision.url,
					tree: decision.tree,
					parentLine: work.source?.parentLine ?? null,
					viaActionIndex: work.source?.actionIndex ?? null,
					line: childLine,
					actor: decision.actor,
					actions: enrichActions(decision, copiedRanges, api),
				};
				if (api) {
					record.preflopResponse = {
						requestUrl: api.requestUrl,
						status: api.status,
						data: api.data,
					};
				}
				decisions.push(record);
				visited.add(key);
				await checkpoint();
				await options.onDecision?.(record);
			}

			if (!settings.traverse || decisionIsComplete(record, decisions)) continue;
			const visibleActions = new Map(
				decision.actions.map((action) => [action.actionIndex, action]),
			);
			const savedActions = new Map(
				record.actions.map((action) => [action.actionIndex, action]),
			);
			const selected = new Set(work.probeActionIndexes || []);
			const traversalActions = [...visibleActions.values()]
				.filter((action) => !selected.size || selected.has(action.actionIndex))
				.sort((left, right) =>
					actionTraversalRank(left) - actionTraversalRank(right) ||
					left.actionIndex - right.actionIndex,
				);
			for (let index = 0; index < traversalActions.length; index += 1) {
				if (limitReached) break;
				const visibleAction = traversalActions[index];
				const action = savedActions.get(visibleAction.actionIndex);
				if (!action) {
					warn({
						type: "checkpoint",
						url: decision.url,
						reason: `checkpoint has no record for visible action ${visibleAction.actionIndex}`,
					});
					continue;
				}
				const source = {
					tree: record.tree,
					parentLine: recordLine(record),
					actionIndex: action.actionIndex,
				};
				if (isResolved(action)) {
					if (isTerminalAction(action)) await markAction(source, "terminal");
					continue;
				}
				if (action.childLine) {
					const child = findDecision(decisions, record.tree, action.childLine)
						|| decisions.find((item) => recordLine(item) === action.childLine);
					if (!child || !decisionIsComplete(child, decisions)) {
						enqueue({
							url: child?.url || childLineUrl(decision.url, action.childLine),
							depth: work.depth + 1,
							source,
						});
					}
					continue;
				}
				if (options.shouldTraverse && !await options.shouldTraverse({
					decision: record,
					action,
					depth: work.depth,
				})) continue;

				const domTarget = await visibleActionTarget(page, visibleAction, selectors);
				let targetUrl = exactActionUrl(decision.url, action, domTarget)
					|| exactActionUrl(decision.url, action, apiActionTarget(action));
				if (!targetUrl && decision.mode === "mobile") {
					targetUrl = childLineUrl(
						decision.url,
						[...decision.path, visibleAction.actionIndex].join(","),
					);
				}
				if (targetUrl) {
					enqueue({ url: targetUrl, depth: work.depth + 1, source });
					continue;
				}

				await navigationDelay();
				const navigationStartedAt = Date.now();
				let moved = false;
				try {
					moved = await clickActionAndWait(
						page,
						visibleAction,
						selectors,
						settings.timeout,
					);
					if (moved) navigationCount += 1;
				} finally {
					await timing({
						type: "navigation",
						line: recordLine(record),
						outcome: moved ? "continue" : "failed",
						duration: Date.now() - navigationStartedAt,
					});
				}
				if (!moved) {
					throw new ZenoPreflopError(
						`Could not navigate the visible ${visibleAction.label} action from line "${record.line}".`,
						"ACTION_NAVIGATION_FAILED",
						{ url: decision.url, actionIndex: visibleAction.actionIndex },
					);
				}
				const discovered = await readNavigatedDecision();
				if (discovered.outcome === "blocked") {
					await checkpoint();
					throw new ZenoPreflopError(
						"Zeno rate-limited strategy loading. Rerun after its chart-loading quota resets.",
						"RATE_LIMITED",
						{ url: page.url() },
					);
				}
				const remaining = traversalActions
					.slice(index + 1)
					.map((item) => item.actionIndex);
				if (remaining.length > 0) {
					enqueue({
						url: decision.url,
						depth: work.depth,
						probeActionIndexes: remaining,
					});
				}
				if (discovered.outcome === "continue" && discovered.decision) {
					const line = discovered.decision.line ?? discovered.decision.history ?? "";
					await markAction(source, "continue", line);
					enqueue({
						url: childLineUrl(decision.url, line),
						depth: work.depth + 1,
						source,
						prefetchedState: discovered,
					}, true);
				} else {
					await markAction(source, discovered.outcome);
				}
				break;
			}
		}
		await checkpoint();

		return {
			studyUrl: initialRoute.url.href,
			finalUrl: page.url(),
			decisions,
			warnings,
			limits: limits(),
		};
	} finally {
		if (!options.responseCollector) collector.stop();
	}
}

export default discoverZenoPreflop;
