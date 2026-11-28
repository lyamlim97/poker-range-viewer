#!/usr/bin/env node

import { appendFileSync, constants as fsConstants, mkdirSync } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { format, parseArgs } from "node:util";
import { chromium } from "playwright";

import { discoverZenoPreflop } from "./zeno-browser.mjs";
import {
	adaptZenoDiscovery,
	convertZenoPreflop,
	draftZenoPreflop,
	normalizeZenoStudyUrl,
	updateSolutionIndex,
	validateConvertedSolution,
} from "./zeno-import-core.mjs";
import { validateBasicSolutionStructure } from "../src/utils/saveValidation.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT_INDEX = path.join(PROJECT_ROOT, "src", "data", "solution-index.json");

const HELP = `Usage:
  node scripts/scrape-zeno.mjs [options] <url> [url ...]
  npm run scrape:zeno -- [options] --url <url>

Options:
  --url <url>             Zeno study query URL (repeatable)
  --id <id>               Solution ID (default derived from the tree)
  --title <title>         Solution title
  --output <path>         Output JSON (default src/data/solutions/<id>.json)
  --checkpoint <path>     Discovery checkpoint (default <output>.checkpoint)
  --log <path>            Append logs to a text file (default <id>.log)
  --no-log                Disable file logging
  --resume                Resume from checkpoint (automatic when one exists)
  --no-resume             Start without using an existing checkpoint
  --dry-run               Scrape, convert, and validate without writing
  --force                 Replace an existing solution or index registration
  --headless              Use headless Chromium (default is headed)
  --channel <name>        Use an installed browser channel (chrome, msedge, ...)
  --cdp-url <url>         Attach to an existing normal Chrome/Edge browser
  --login                 Wait for Zeno sign-in and save authenticated state
  --storage-state <path>  Playwright storage state (required with --login)
  --timeout <ms>          Playwright navigation timeout (default 20000)
  --decision-timeout <ms> Maximum normal preflop decision wait (default 8000)
  --action-delay <ms>     Delay baseline between copies/navigation (default 2000)
  --action-jitter <pct>   Random delay variance percentage (default 10, range 0-100)
  --checkpoint-flush-ms <ms>
                          Minimum checkpoint/output flush interval (default 5000)
  --concurrency <count>  Browser-tab concurrency (default 1; only 1 is implemented)
  --max-decisions <count> Maximum decisions to scrape (default 3000)
  --max-depth <depth>     Maximum branch depth (default 32)
  --register              Add or update src/data/solution-index.json
  -h, --help              Show this help
`;

function usageError(message) {
	const error = new Error(message);
	error.code = "USAGE";
	return error;
}

function positiveInteger(value, name, allowZero = false) {
	const parsed = Number(value);
	const minimum = allowZero ? 0 : 1;
	if (!Number.isInteger(parsed) || parsed < minimum) {
		throw usageError(`${name} must be an integer of at least ${minimum}.`);
	}
	return parsed;
}

function parseCommandLine(argv) {
	let parsed;
	try {
		parsed = parseArgs({
			args: argv,
			allowPositionals: true,
			options: {
				url: { type: "string", multiple: true },
				id: { type: "string" },
				title: { type: "string" },
				output: { type: "string" },
				checkpoint: { type: "string" },
				log: { type: "string" },
				"no-log": { type: "boolean", default: false },
				resume: { type: "boolean", default: false },
				"no-resume": { type: "boolean", default: false },
				"dry-run": { type: "boolean", default: false },
				force: { type: "boolean", default: false },
				headless: { type: "boolean", default: false },
				channel: { type: "string" },
				"cdp-url": { type: "string" },
				login: { type: "boolean", default: false },
				"storage-state": { type: "string" },
				timeout: { type: "string", default: "20000" },
				"action-delay": { type: "string", default: "2000" },
				"action-jitter": { type: "string", default: "10" },
				"decision-timeout": { type: "string", default: "8000" },
				"checkpoint-flush-ms": { type: "string", default: "5000" },
				concurrency: { type: "string", default: "1" },
				"max-decisions": { type: "string", default: "3000" },
				"max-depth": { type: "string", default: "32" },
				register: { type: "boolean", default: false },
				help: { type: "boolean", short: "h", default: false },
			},
		});
	} catch (error) {
		throw usageError(error.message);
	}

	const urls = [...(parsed.values.url || []), ...parsed.positionals];
	if (parsed.values.resume && parsed.values["no-resume"]) {
		throw usageError("--resume cannot be combined with --no-resume.");
	}
	if (parsed.values.log && parsed.values["no-log"]) {
		throw usageError("--log cannot be combined with --no-log.");
	}
	return {
		...parsed.values,
		urls,
		dryRun: parsed.values["dry-run"],
		timeout: positiveInteger(parsed.values.timeout, "--timeout"),
		decisionTimeout: positiveInteger(
			parsed.values["decision-timeout"],
			"--decision-timeout",
		),
		actionDelay: positiveInteger(parsed.values["action-delay"], "--action-delay", true),
		actionJitterPercent: (() => {
			const value = positiveInteger(parsed.values["action-jitter"], "--action-jitter", true);
			if (value > 100) throw usageError("--action-jitter must be no greater than 100.");
			return value;
		})(),
		maxDecisions: positiveInteger(parsed.values["max-decisions"], "--max-decisions"),
		maxDepth: positiveInteger(parsed.values["max-depth"], "--max-depth", true),
		checkpointFlushMs: positiveInteger(
			parsed.values["checkpoint-flush-ms"],
			"--checkpoint-flush-ms",
		),
		concurrency: positiveInteger(parsed.values.concurrency, "--concurrency"),
	};
}

function adaptDiscovery(discovery, sourceUrl, existing) {
	return adaptZenoDiscovery(discovery, sourceUrl, existing);
}

function metadataFromUrl(sourceUrl, title) {
	const url = new URL(sourceUrl);
	const tree = url.searchParams.get("tree") || "";
	const stackMatch = tree.match(/^a(\d+)p(\d+)/i);
	const stack = stackMatch ? Number(stackMatch[1]) : null;
	const seats = stackMatch ? Number(stackMatch[2]) : null;
	const rakeMatch = tree.match(/lr(\d+)/i);
	const rake = rakeMatch ? `NL${rakeMatch[1]}` : null;
	const openMatch = tree.match(/o(\d+)(?:$|[^0-9])/i);
	const openSize = openMatch
		? Number(`${openMatch[1][0]}.${openMatch[1].slice(1)}`)
		: stack >= 35
			? 2.5
			: 2;

	if (!stack || !seats || !rake) {
		throw new Error(`Could not determine stack, format, and rake from tree "${tree}".`);
	}
	const open = Number.isInteger(openSize) ? String(openSize) : String(openSize);
	return {
		meta: {
			title: title || `Zeno ${stack}bb ${seats}-Max ${rake} ${open}bb`,
			game: "Cash",
			stack,
			type: `${seats}-Max`,
			format: `${seats}-Max NLHE`,
			rake,
			openSize: `${open}x`,
			threeBet: "GTO",
			betSize: `${open}bb open`,
		},
		stack,
		seats,
		rake,
		open,
		tree,
	};
}

function defaultId(metadata) {
	return `zeno-${metadata.stack}bb-${metadata.rake.toLowerCase()}-${metadata.open.replace(".", "-")}bb`;
}

async function exists(file) {
	try {
		await access(file, fsConstants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function loadTreeValidator() {
	const { registerHooks } = await import("node:module");
	if (typeof registerHooks !== "function") {
		throw new Error("Solution tree validation requires Node.js 22.15 or newer.");
	}
	const hooks = registerHooks({
		resolve(specifier, context, nextResolve) {
			try {
				return nextResolve(specifier, context);
			} catch (error) {
				if (
					error?.code === "ERR_MODULE_NOT_FOUND"
					&& (specifier.startsWith("./") || specifier.startsWith("../"))
					&& !path.extname(specifier)
				) {
					return nextResolve(`${specifier}.js`, context);
				}
				throw error;
			}
		},
	});
	try {
		return (await import("../src/utils/validateSolutionTree.js")).validateSolutionTree;
	} finally {
		hooks.deregister();
	}
}

async function validateSolution(solution) {
	validateConvertedSolution(solution);
	const structureError = validateBasicSolutionStructure(solution);
	if (structureError) throw new Error(`Basic solution validation failed: ${structureError}`);

	const validateTree = await loadTreeValidator();
	const report = validateTree(solution);
	const errors = report.issues.filter((issue) => issue.severity === "error");
	if (errors.length) {
		throw new Error(`Solution tree validation failed: ${errors[0].message}`);
	}
	return report;
}

async function readJson(file) {
	try {
		return JSON.parse(await readFile(file, "utf8"));
	} catch (error) {
		throw new Error(`Could not read ${path.relative(PROJECT_ROOT, file)}: ${error.message}`);
	}
}

async function atomicWrite(file, content) {
	await mkdir(path.dirname(file), { recursive: true });
	const temporary = path.join(
		path.dirname(file),
		`.${path.basename(file)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
	);
	try {
		await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
		for (let attempt = 0; attempt < 3; attempt += 1) {
			try {
				await rename(temporary, file);
				return;
			} catch (error) {
				const replaceError = ["EPERM", "EACCES", "EBUSY"].includes(error?.code);
				if (!replaceError || attempt === 2) throw error;

				// Retry a locked Windows replacement without deleting the last
				// complete file, so an interrupted write cannot destroy resume state.
				await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
			}
		}
	} finally {
		await rm(temporary, { force: true });
	}
}

function displayPath(file) {
	return path.relative(PROJECT_ROOT, file) || path.basename(file);
}

function rawDecisionKey(decision) {
	let line = decision?.line;
	if (!line && decision?.url) {
		try {
			line = new URL(decision.url).searchParams.get("pf") || "";
		} catch {
			line = "";
		}
	}
	return `${decision?.tree || ""}\u0000${line || ""}`;
}

function mergeDiscoveryDecisions(existing, incoming) {
	const merged = new Map(existing.map((decision) => [rawDecisionKey(decision), decision]));
	for (const decision of incoming) merged.set(rawDecisionKey(decision), decision);
	return [...merged.values()];
}

function sameJson(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function checkpointDecoded(data, expectedSourceUrl, expectedMetadata, force) {
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		throw new Error("Checkpoint must contain a JSON object.");
	}
	const expectedFields = ["sourceUrl", "rootNodeId", "decisions", "metadata"];
	const fields = Object.keys(data).sort();
	if (fields.join("\u0000") !== [...expectedFields].sort().join("\u0000")) {
		throw new Error(
			"Checkpoint must contain exactly sourceUrl, rootNodeId, decisions, and metadata.",
		);
	}
	if (typeof data.sourceUrl !== "string") {
		throw new Error("Checkpoint sourceUrl must be a string.");
	}
	const checkpointSource = normalizeZenoStudyUrl(data.sourceUrl);
	const expectedSource = normalizeZenoStudyUrl(expectedSourceUrl);
	const sourceMismatch = checkpointSource !== expectedSource;
	const treeMismatch =
		new URL(checkpointSource).searchParams.get("tree") !==
		new URL(expectedSource).searchParams.get("tree");
	const metadataMismatch = !sameJson(data.metadata, expectedMetadata);
	const mismatches = [
		...(sourceMismatch ? ["source URL"] : []),
		...(treeMismatch ? ["tree"] : []),
		...(metadataMismatch ? ["metadata"] : []),
	];
	if (!Array.isArray(data.decisions)) {
		throw new Error("Checkpoint decisions must be an array.");
	}
	const empty = data.decisions.length === 0;
	if ((!empty && (typeof data.rootNodeId !== "string" || !data.rootNodeId))
		|| (empty && data.rootNodeId !== null)) {
		throw new Error(
			"Checkpoint rootNodeId must be null for an empty checkpoint and non-empty otherwise.",
		);
	}
	if (empty) {
		if (mismatches.length && !force) {
			throw new Error(
				`Checkpoint ${[...new Set(mismatches)].join(", ")} does not match this run; ` +
				"use --force to resume anyway or --no-resume to start over.",
			);
		}
		if (mismatches.length) {
			console.error(
				`warning: resuming despite checkpoint mismatch (${[...new Set(mismatches)].join(", ")}).`,
			);
		}
		return {
			sourceUrl: checkpointSource,
			rootNodeId: null,
			decisions: [],
			metadata: data.metadata,
			adapted: new Map(),
		};
	}

	const adapted = new Map();
	const rootNodeId = adaptZenoDiscovery(
		{ decisions: data.decisions },
		checkpointSource,
		adapted,
		{ allowIncomplete: true },
	);
	if (rootNodeId !== data.rootNodeId) {
		mismatches.push("root node ID");
	}
	const adaptedInOrder = [...adapted.values()];
	for (let index = 0; index < data.decisions.length; index += 1) {
		const declared = data.decisions[index]?.nodeId;
		if (declared != null && declared !== adaptedInOrder[index]?.nodeId) {
			mismatches.push(`node ID ${declared}`);
			break;
		}
	}
	if (mismatches.length && !force) {
		throw new Error(
			`Checkpoint ${[...new Set(mismatches)].join(", ")} does not match this run; ` +
			"use --force to resume anyway or --no-resume to start over.",
		);
	}
	if (mismatches.length) {
		console.error(
			`warning: resuming despite checkpoint mismatch (${[...new Set(mismatches)].join(", ")}).`,
		);
	}
	return {
		sourceUrl: checkpointSource,
		rootNodeId,
		decisions: data.decisions,
		metadata: data.metadata,
		adapted,
	};
}

function progressSummary(decisions) {
	const actions = decisions.flatMap((decision) =>
		Array.isArray(decision?.actions) ? decision.actions : [],
	);
	const byLabel = Object.groupBy(actions, (action) =>
		/^fold\b/i.test(action?.label || "") ? "fold" :
		/^call\b/i.test(action?.label || "") ? "call" :
		/^(?:raise|open)\b/i.test(action?.label || "") ? "raise" :
		/^(?:allin|jam)\b/i.test(action?.label || "") ? "allin" :
		"other",
	);
	const resolved = actions.filter((action) =>
		action?.outcome === "terminal" ||
		action?.outcome === "rare" ||
		(action?.outcome === "continue" && action?.childLine),
	);
	const terminal = actions.filter((action) => action?.outcome === "terminal").length;
	const rare = actions.filter((action) => action?.outcome === "rare").length;
	return {
		nodes: new Set(decisions.map((decision) => rawDecisionKey(decision))).size,
		actions: actions.length,
		resolved: resolved.length,
		unresolved: actions.length - resolved.length,
		terminal,
		rare,
		continuing: actions.length - terminal - rare,
		byLabel: Object.fromEntries(
			["fold", "call", "raise", "allin", "other"].map((name) => [
				name,
				byLabel[name]?.length || 0,
			]),
		),
	};
}

function formatDuration(milliseconds) {
	const seconds = Math.max(0, Math.round(milliseconds / 1000));
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const remaining = seconds % 60;
	return [
		hours ? `${hours}h` : "",
		minutes ? `${minutes}m` : "",
		!hours && remaining ? `${remaining}s` : "",
	].filter(Boolean).join(" ") || "0s";
}

function formatBytes(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function createTimingRecorder(summaryIntervalMs = 30_000) {
	const stats = new Map();
	let lastSummaryAt = Date.now();

	const record = (timing) => {
		const type = typeof timing?.type === "string" ? timing.type : "";
		const duration = Number(timing?.duration);
		if (!type || !Number.isFinite(duration) || duration < 0) return;
		const previous = stats.get(type) || {
			count: 0,
			total: 0,
			min: Infinity,
			max: 0,
		};
		previous.count += 1;
		previous.total += duration;
		previous.min = Math.min(previous.min, duration);
		previous.max = Math.max(previous.max, duration);
		stats.set(type, previous);

		if (Date.now() - lastSummaryAt >= summaryIntervalMs) logSummary("periodic");
	};

	function logSummary(reason = "final", force = false) {
		const now = Date.now();
		if ((!force && now - lastSummaryAt < summaryIntervalMs) || stats.size === 0) return;
		const measurements = [...stats.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([type, value]) =>
				`${type}=${value.count}x avg=${(value.total / value.count).toFixed(1)}ms ` +
				`min=${value.min.toFixed(1)}ms max=${value.max.toFixed(1)}ms`,
			)
			.join(" | ");
		console.error(`performance ${reason}: ${measurements}`);
		lastSummaryAt = now;
	}

	return { record, logSummary };
}

function configureFileLogging(file) {
	mkdirSync(path.dirname(file), { recursive: true });
	const writeToConsole = console.error.bind(console);
	let warned = false;
	console.error = (...args) => {
		const line = format(...args);
		writeToConsole(...args);
		try {
			appendFileSync(
				file,
				`${new Date().toISOString()} ${line.replace(/\r?\n/g, "\n").trimEnd()}\n`,
				"utf8",
			);
		} catch (error) {
			if (!warned) {
				warned = true;
				writeToConsole(
					`warning: could not append scraper log "${displayPath(file)}": ` +
					`${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	};
	console.error(`log file: ${displayPath(file)}`);
}

async function run(options) {
	if (!options.urls.length) throw usageError("At least one positional URL or --url is required.");
	if (options.concurrency > 1) {
		throw usageError("--concurrency values greater than 1 are not implemented.");
	}
	if (options.login && !options["storage-state"]) {
		throw usageError("--login requires --storage-state <path>.");
	}
	if (options.login && options.headless) {
		throw usageError("--login cannot be combined with --headless.");
	}
	if (options["cdp-url"] && options.headless) {
		throw usageError("--cdp-url cannot be combined with --headless.");
	}
	if (options["cdp-url"] && (options.channel || options.login)) {
		throw usageError("--cdp-url cannot be combined with --channel or --login.");
	}
	const urls = options.urls.map(normalizeZenoStudyUrl);
	const metadata = metadataFromUrl(urls[0], options.title);
	for (const url of urls.slice(1)) {
		const other = metadataFromUrl(url, options.title);
		if (other.tree !== metadata.tree) {
			throw usageError("All --url values must reference the same Zeno tree.");
		}
	}

	const id = options.id || defaultId(metadata);
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
		throw usageError("--id must be a safe file-name ID.");
	}
	const output = path.resolve(
		PROJECT_ROOT,
		options.output || path.join("src", "data", "solutions", `${id}.json`),
	);
	const checkpoint = path.resolve(
		PROJECT_ROOT,
		options.checkpoint || `${output}.checkpoint`,
	);
	const defaultLogPath = /\.json$/i.test(output)
		? output.replace(/\.json$/i, ".log")
		: `${output}.log`;
	const logPath = options["no-log"]
		? null
		: path.resolve(PROJECT_ROOT, options.log || defaultLogPath);
	if (path.resolve(output) === path.resolve(DEFAULT_INDEX)) {
		throw usageError("--output cannot collide with the solution index.");
	}
	if (path.resolve(checkpoint) === path.resolve(output)) {
		throw usageError("--checkpoint cannot collide with --output.");
	}
	if (path.resolve(checkpoint) === path.resolve(DEFAULT_INDEX)) {
		throw usageError("--checkpoint cannot collide with the solution index.");
	}
	if (
		logPath &&
		[path.resolve(output), path.resolve(checkpoint), path.resolve(DEFAULT_INDEX)]
			.includes(path.resolve(logPath))
	) {
		throw usageError("--log cannot collide with the output, checkpoint, or solution index.");
	}
	if (logPath) configureFileLogging(logPath);
	console.error(
		`run: id=${options.id || "(auto)"} tree=${metadata.tree} stack=${metadata.stack}bb ` +
		`seats=${metadata.seats} rake=${metadata.rake} open=${metadata.open}bb ` +
		`delay=${options.actionDelay}ms±${options.actionJitterPercent}% ` +
		`checkpointFlush=${options.checkpointFlushMs}ms concurrency=${options.concurrency} ` +
		`mode=${options["cdp-url"] ? "attached-browser" : "playwright-browser"}`,
	);

	const checkpointExists = await exists(checkpoint);
	if (options.resume && !checkpointExists) {
		throw new Error(`${displayPath(checkpoint)} does not exist; cannot --resume.`);
	}
	const resuming = !options["no-resume"] && (options.resume || checkpointExists);
	console.error(
		`checkpoint: path=${displayPath(checkpoint)} exists=${checkpointExists} ` +
		`resume=${resuming}`,
	);
	let discoveryDecisions = [];
	let rootNodeId = null;
	if (resuming) {
		const loaded = checkpointDecoded(
			await readJson(checkpoint),
			urls[0],
			metadata.meta,
			options.force,
		);
		discoveryDecisions = loaded.decisions;
		rootNodeId = loaded.rootNodeId;
		console.error(`resuming from ${displayPath(checkpoint)}`);
	}
	const outputExists = await exists(output);
	if (!options.dryRun && outputExists && !options.force && !resuming) {
		throw new Error(`${displayPath(output)} already exists; use --force to replace it.`);
	}

	const storageStatePath = options["storage-state"]
		? path.resolve(PROJECT_ROOT, options["storage-state"])
		: null;
	if (storageStatePath && !options.login && !await exists(storageStatePath)) {
		throw new Error(
			`${path.relative(PROJECT_ROOT, storageStatePath)} does not exist; ` +
			"use --login to create the storage state.",
		);
	}
	let indexBefore = null;
	let indexAfter = null;
	if (!options.dryRun && options.register) {
		indexBefore = await readJson(DEFAULT_INDEX);
	}
	if (indexBefore) {
		if (indexBefore.some((entry) => entry.id === id) && !options.force && !resuming) {
			throw new Error(`${id} is already registered; use --force to update it.`);
		}
	}
	const browser = options["cdp-url"]
		? await chromium.connectOverCDP(options["cdp-url"])
		: await chromium.launch({
			headless: options.headless,
			...(options.channel ? { channel: options.channel } : {}),
		});
	const decisions = new Map();
	const startedAt = Date.now();
	const timings = createTimingRecorder();
	let lastProgressAt = 0;
	let initialProgress = null;
	let revision = 0;
	let persistedRevision = 0;
	let lastFlushCompletedAt = 0;
	let pendingFlush = null;
	let latestEventRoot = null;
	let latestEventLine = "(root)";

	const flushCheckpoint = async (
		reason,
		{ force = false, flushMs = options.checkpointFlushMs } = {},
	) => {
		while (true) {
			if (pendingFlush) {
				await pendingFlush;
				continue;
			}
			if (
				options.dryRun ||
				(persistedRevision >= revision && (!force || revision === 0))
			) {
				return;
			}
			const now = Date.now();
			if (!force && lastFlushCompletedAt && now - lastFlushCompletedAt < flushMs) return;

			const writingRevision = revision;
			const previousRevision = persistedRevision;
			const snapshotDecisions = discoveryDecisions;
			const snapshotRoot = latestEventRoot;
			const snapshotLine = latestEventLine;
			pendingFlush = (async () => {
				const flushStartedAt = Date.now();
				const adapted = new Map();
				const discoveredRoot = snapshotDecisions.length
					? adaptZenoDiscovery(
						{ decisions: snapshotDecisions },
						urls[0],
						adapted,
						{ allowIncomplete: true },
					)
					: null;
				if (snapshotRoot != null && snapshotRoot !== discoveredRoot) {
					throw new Error(
						`Browser checkpoint root node "${snapshotRoot}" did not match ` +
						`"${discoveredRoot}".`,
					);
				}
				if (rootNodeId && discoveredRoot !== rootNodeId) {
					throw new Error(
						`Browser checkpoint root node "${discoveredRoot}" did not match ` +
						`"${rootNodeId}".`,
					);
				}
				rootNodeId = rootNodeId || discoveredRoot;
				const snapshot = {
					sourceUrl: urls[0],
					rootNodeId: discoveredRoot,
					decisions: snapshotDecisions,
					metadata: metadata.meta,
				};
				const checkpointText = `${JSON.stringify(snapshot, null, "\t")}\n`;
				const checkpointStartedAt = Date.now();
				await atomicWrite(checkpoint, checkpointText);
				timings.record({
					type: "checkpoint-write",
					line: snapshotLine,
					outcome: reason,
					duration: Date.now() - checkpointStartedAt,
				});

				let outputText = null;
				if (snapshotDecisions.length > 0) {
					const draft = draftZenoPreflop({
						state: "preflop",
						meta: metadata.meta,
						rootNodeId: discoveredRoot,
						decisions: [...adapted.values()],
					});
					outputText = `${JSON.stringify(draft, null, "\t")}\n`;
					const outputStartedAt = Date.now();
					await atomicWrite(output, outputText);
					timings.record({
						type: "output-write",
						line: snapshotLine,
						outcome: reason,
						duration: Date.now() - outputStartedAt,
					});
				}

				persistedRevision = writingRevision;
				lastFlushCompletedAt = Date.now();
				const progress = progressSummary(snapshotDecisions);
				const elapsed = Date.now() - startedAt;
				const newNodes = initialProgress
					? Math.max(0, progress.nodes - initialProgress.nodes)
					: progress.nodes;
				const rate = elapsed > 0 ? newNodes / (elapsed / 60_000) : 0;
				const flushDuration = Date.now() - flushStartedAt;
				timings.record({
					type: "checkpoint-flush",
					line: snapshotLine,
					outcome: reason,
					duration: flushDuration,
				});
				console.error(
					`persistence: reason=${reason} mutations=${writingRevision - previousRevision} ` +
					`duration=${flushDuration}ms checkpoint=${formatBytes(Buffer.byteLength(checkpointText))} ` +
					`output=${outputText ? formatBytes(Buffer.byteLength(outputText)) : "(unchanged)"}`,
				);
				console.error(
					[
						"progress:",
						`nodes=${progress.nodes}`,
						`actions=${progress.actions}`,
						`resolved=${progress.resolved}`,
						`unresolved=${progress.unresolved}`,
						`continue=${progress.continuing}`,
						`terminal=${progress.terminal}`,
						`rare=${progress.rare}`,
						`fold=${progress.byLabel.fold}`,
						`call=${progress.byLabel.call}`,
						`raise=${progress.byLabel.raise}`,
						`allin=${progress.byLabel.allin}`,
						`elapsed=${formatDuration(elapsed)}`,
						`rate=${rate.toFixed(1)} nodes/min`,
						`delay=${options.actionDelay}ms±${options.actionJitterPercent}%`,
					].join(" "),
				);
				if (Date.now() - lastProgressAt > 60_000) {
					console.error(`last line: ${snapshotLine}`);
					lastProgressAt = Date.now();
				}
			})();

			try {
				await pendingFlush;
			} finally {
				pendingFlush = null;
			}
			if (!force || persistedRevision >= revision) return;
		}
	};

	const persistCheckpoint = async (event, flushMs) => {
		const incoming = Array.isArray(event)
			? event
			: event?.decisions ?? event?.discovery?.decisions;
		if (!Array.isArray(incoming)) {
			throw new Error("Browser checkpoint did not contain a decisions array.");
		}
		discoveryDecisions = mergeDiscoveryDecisions(discoveryDecisions, incoming);
		latestEventRoot = event?.rootNodeId ?? latestEventRoot;
		latestEventLine = event?.decisions?.at(-1)?.line || latestEventLine;
		revision += 1;
		await flushCheckpoint("interval", { flushMs });
	};

	let interrupting = false;
	const interrupt = (signal) => {
		if (interrupting) return;
		interrupting = true;
		console.error(`interrupted by ${signal}; flushing latest checkpoint...`);
		void (async () => {
			try {
				await flushCheckpoint("interruption", { force: true });
			} catch (error) {
				console.error(
					`warning: could not flush after ${signal}: ` +
					`${error instanceof Error ? error.message : String(error)}`,
				);
			} finally {
				timings.logSummary("interruption", true);
				if (!options["cdp-url"]) {
					await browser.close().catch(() => {});
				}
				process.exit(signal === "SIGINT" ? 130 : 143);
			}
		})();
	};
	const interruptSigint = () => interrupt("SIGINT");
	const interruptSigterm = () => interrupt("SIGTERM");
	process.once("SIGINT", interruptSigint);
	process.once("SIGTERM", interruptSigterm);
	try {
		const attached = Boolean(options["cdp-url"]);
		const context = attached
			? browser.contexts()[0]
			: await browser.newContext({
				permissions: ["clipboard-read", "clipboard-write"],
				...(storageStatePath && await exists(storageStatePath)
					? { storageState: storageStatePath }
					: {}),
			});
		if (!context) {
			throw new Error("No Chrome/Edge browser context was available at the CDP URL.");
		}
		const existingZenoPage = attached
			? context.pages().find((candidate) =>
				candidate.url().startsWith("https://zenosolver.com/")
			)
			: null;
		const page = existingZenoPage || await context.newPage();
		if (attached) {
			await context.grantPermissions(
				["clipboard-read", "clipboard-write"],
				{ origin: "https://zenosolver.com" },
			);
		}
		if (options.login) {
			await page.goto("https://zenosolver.com/study", {
				waitUntil: "domcontentloaded",
				timeout: options.timeout,
			});
			console.error("Waiting for Zeno sign-in in the browser window...");
			await page.waitForFunction(
				() => ![...document.querySelectorAll("button")].some(
					(button) => button.textContent?.trim() === "Sign in",
				),
				null,
				{ timeout: 10 * 60 * 1000 },
			);
			await mkdir(path.dirname(storageStatePath), { recursive: true });
			await context.storageState({ path: storageStatePath });
			console.error(`saved authenticated state to ${storageStatePath}`);
		}
		for (const url of urls) {
			if (!initialProgress) {
				initialProgress = progressSummary(discoveryDecisions);
				console.error(
					`resume baseline: nodes=${initialProgress.nodes} actions=${initialProgress.actions}`,
				);
			}
			const discovery = await discoverZenoPreflop(page, url, {
				timeout: options.timeout,
				actionDelay: options.actionDelay,
				actionJitterPercent: options.actionJitterPercent,
				decisionTimeout: options.decisionTimeout,
				maxDecisions: options.maxDecisions,
				maxDepth: options.maxDepth,
				initialDecisions: discoveryDecisions,
				rootNodeId,
				onCheckpoint: (event) =>
					persistCheckpoint(event, options.checkpointFlushMs),
				onDecision: (decision) => {
					const progress = progressSummary([
						...mergeDiscoveryDecisions(discoveryDecisions, [decision]),
					]);
					console.error(
						`scraped: position=${decision.actor} line="${decision.line || "(root)"}" ` +
						`actions=${decision.actions.length} nodes=${progress.nodes} totalActions=${progress.actions}`,
					);
				},
				onTiming: timings.record,
			});
			discoveryDecisions = mergeDiscoveryDecisions(
				discoveryDecisions,
				discovery.decisions,
			);
			const discoveredRoot = adaptDiscovery(discovery, urls[0], decisions);
			if (rootNodeId && discoveredRoot !== rootNodeId) {
				throw new Error(
					`Discovered root "${discoveredRoot}" does not match checkpoint root "${rootNodeId}".`,
				);
			}
			rootNodeId = rootNodeId || discoveredRoot;
			if (discovery.warnings.length) {
				for (const warning of discovery.warnings) {
					console.error(`warning: ${warning.reason} (${warning.url})`);
				}
			}
		}
		await flushCheckpoint("final", { force: true });
		timings.logSummary("final", true);
	} catch (error) {
		try {
			await flushCheckpoint("fatal-error", { force: true });
		} catch (flushError) {
			console.error(
				`warning: could not flush after fatal error: ` +
				`${flushError instanceof Error ? flushError.message : String(flushError)}`,
			);
		}
		timings.logSummary("fatal-error", true);
		throw error;
	} finally {
		process.removeListener("SIGINT", interruptSigint);
		process.removeListener("SIGTERM", interruptSigterm);
		if (!options["cdp-url"]) await browser.close();
	}

	const solution = convertZenoPreflop({
		state: "preflop",
		meta: metadata.meta,
		rootNodeId,
		decisions: [...decisions.values()],
	});
	const report = await validateSolution(solution);
	const serialized = `${JSON.stringify(solution, null, "\t")}\n`;
	if (indexBefore) {
		indexAfter = updateSolutionIndex(indexBefore, id, solution);
	}

	if (options.dryRun) {
		console.log(serialized);
		console.error(
			`dry-run: validated ${Object.keys(solution.nodes).length} nodes; ` +
			`${report.issueCount} warning(s)`,
		);
		return;
	}

	await atomicWrite(output, serialized);
	console.error(`wrote ${displayPath(output)}`);

	if (options.register) {
		await atomicWrite(
			DEFAULT_INDEX,
			`${JSON.stringify(indexAfter, null, "\t")}\n`,
		);
		console.error(`updated ${displayPath(DEFAULT_INDEX)}`);
	}
	await rm(checkpoint, { force: true });
	console.error(`removed ${displayPath(checkpoint)}`);
	const finalActions = Object.values(solution.nodes).flatMap((node) => node.actions);
	console.error(
		`complete: nodes=${Object.keys(solution.nodes).length} actions=${finalActions.length} ` +
		`terminal=${finalActions.filter((action) => action.terminal === true).length} ` +
		`rare=${finalActions.filter((action) =>
			action.tags?.includes("almost-never-reached")).length} ` +
		`elapsed=${formatDuration(Date.now() - startedAt)}`,
	);
}

let options;
try {
	options = parseCommandLine(process.argv.slice(2));
	if (options.help) {
		console.log(HELP);
		process.exitCode = 0;
	} else {
		await run(options);
	}
} catch (error) {
	if (error?.code === "USAGE") {
		console.error(`error: ${error.message}\n\n${HELP}`);
		process.exitCode = 2;
	} else {
		console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
