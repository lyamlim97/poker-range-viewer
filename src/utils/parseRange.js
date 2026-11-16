export const RANKS = "AKQJT98765432";
const R = "[2-9TJQKA]";
const idx = (r) => RANKS.indexOf(r);
export const SUITS = ["s", "h", "d", "c"];

export function getCombosForHand(hand) {
	if (!hand) return [];
	if (hand.length === 2) {
		const r = hand[0];
		const combos = [];
		for (let i = 0; i < SUITS.length; i++) {
			for (let j = i + 1; j < SUITS.length; j++) {
				const s1 = SUITS[i];
				const s2 = SUITS[j];
				combos.push({
					id: `${r}${s1}${r}${s2}`,
					card1: { rank: r, suit: s1 },
					card2: { rank: r, suit: s2 },
					label: `${r}${s1}${r}${s2}`,
				});
			}
		}
		return combos;
	}

	const r1 = hand[0];
	const r2 = hand[1];
	const isSuited = hand.endsWith("s");

	if (isSuited) {
		return SUITS.map((s) => ({
			id: `${r1}${s}${r2}${s}`,
			card1: { rank: r1, suit: s },
			card2: { rank: r2, suit: s },
			label: `${r1}${s}${r2}${s}`,
		}));
	}

	// Offsuit: 12 combos
	const combos = [];
	for (const s1 of SUITS) {
		for (const s2 of SUITS) {
			if (s1 !== s2) {
				combos.push({
					id: `${r1}${s1}${r2}${s2}`,
					card1: { rank: r1, suit: s1 },
					card2: { rank: r2, suit: s2 },
					label: `${r1}${s1}${r2}${s2}`,
				});
			}
		}
	}
	return combos;
}

function expand(token) {
	let m;
	// pair or pair+: 77, 77+
	m = token.match(new RegExp(`^(${R})\\1(\\+)?$`));
	if (m) {
		const i = idx(m[1]);
		const end = m[2] ? 0 : i;
		const hands = [];
		for (let k = i; k >= end; k--) hands.push(RANKS[k] + RANKS[k]);
		return hands;
	}

	// pair range: QQ-88
	m = token.match(new RegExp(`^(${R})\\1-(${R})\\2$`));
	if (m) {
		const a = idx(m[1]);
		const b = idx(m[2]);
		const hands = [];
		for (let k = Math.min(a, b); k <= Math.max(a, b); k++) hands.push(RANKS[k] + RANKS[k]);
		return hands;
	}

	// non-pair: AKs, AKo, AK, ATs+
	m = token.match(new RegExp(`^(${R})(${R})([so])?(\\+)?$`));
	if (m) {
		let hi = idx(m[1]);
		let lo = idx(m[2]);
		if (hi > lo) [hi, lo] = [lo, hi];
		const suits = m[3] ? [m[3]] : ["s", "o"];
		const end = m[4] ? hi + 1 : lo;
		const hands = [];
		for (let k = lo; k >= end; k--) {
			for (const s of suits) hands.push(RANKS[hi] + RANKS[k] + s);
		}
		return hands;
	}

	// non-pair range: A5s-A2s or T9s-65s
	m = token.match(new RegExp(`^(${R})(${R})([so])?-(${R})(${R})([so])?$`));
	if (m) {
		const hi1 = idx(m[1]), lo1 = idx(m[2]);
		const hi2 = idx(m[4]), lo2 = idx(m[5]);
		const suits = m[3] || m[6] ? [m[3] || m[6]] : ["s", "o"];
		const hands = [];
		if (hi1 === hi2) {
			for (let k = Math.min(lo1, lo2); k <= Math.max(lo1, lo2); k++) {
				for (const s of suits) hands.push(RANKS[hi1] + RANKS[k] + s);
			}
		} else if (lo1 - hi1 === lo2 - hi2) {
			const gap = lo1 - hi1;
			for (let h = Math.min(hi1, hi2); h <= Math.max(hi1, hi2); h++) {
				for (const s of suits) hands.push(RANKS[h] + RANKS[h + gap] + s);
			}
		}
		return hands;
	}

	return null;
}

export function parseRange(input) {
	return parseDetailedRange(input).freq;
}

export function parseDetailedRange(input) {
	const freq = {};
	const comboFreq = {};
	const allActions = [];

	if (!input) return { freq, comboFreq, allActions };

	if (typeof input === "object") {
		for (const [action, strVal] of Object.entries(input)) {
			if (typeof strVal !== "string") continue;
			if (!allActions.includes(action)) allActions.push(action);

			const sub = parseSingleStringWithCombos(strVal, action);
			for (const [h, actions] of Object.entries(sub.freq)) {
				if (!freq[h]) freq[h] = {};
				for (const [act, val] of Object.entries(actions)) {
					freq[h][act] = (freq[h][act] || 0) + val;
				}
			}
			for (const [cId, actions] of Object.entries(sub.comboFreq)) {
				if (!comboFreq[cId]) comboFreq[cId] = {};
				for (const [act, val] of Object.entries(actions)) {
					comboFreq[cId][act] = (comboFreq[cId][act] || 0) + val;
				}
			}
		}
		return { freq, comboFreq, allActions };
	}

	allActions.push("raise");
	const sub = parseSingleStringWithCombos(input, "raise");
	return { freq: sub.freq, comboFreq: sub.comboFreq, allActions };
}

function normalizeComboId(r1, s1, r2, s2) {
	if (idx(r1) > idx(r2)) {
		return `${r2}${s2}${r1}${s1}`;
	}
	if (r1 === r2) {
		const i1 = SUITS.indexOf(s1);
		const i2 = SUITS.indexOf(s2);
		if (i1 > i2) {
			return `${r2}${s2}${r1}${s1}`;
		}
	}
	return `${r1}${s1}${r2}${s2}`;
}

function parseSingleStringWithCombos(str, defaultAction = "raise") {
	const freq = {};
	const comboFreq = {};
	const partial = {};
	if (!str) return { freq, comboFreq };

	function addTokens(text, baseWeight, action) {
		for (let raw of text.split(",")) {
			raw = raw.trim();
			if (!raw) continue;

			let weight = baseWeight;
			const w = raw.match(/^(.+?)\s*:\s*(\d+(?:\.\d+)?)$/);
			if (w) {
				raw = w[1].trim();
				weight = parseFloat(w[2]) * baseWeight;
			}

			const c = raw.match(new RegExp(`^(${R})([cdhs])(${R})([cdhs])$`));
			if (c) {
				let [, r1, s1, r2, s2] = c;
				if (idx(r1) > idx(r2)) {
					[r1, r2] = [r2, r1];
					[s1, s2] = [s2, s1];
				}
				const isPair = r1 === r2;
				const hand = isPair ? r1 + r2 : r1 + r2 + (s1 === s2 ? "s" : "o");
				const total = isPair ? 6 : s1 === s2 ? 4 : 12;

				if (!partial[hand]) partial[hand] = {};
				partial[hand][action] = (partial[hand][action] || 0) + weight / total;

				const normId = normalizeComboId(r1, s1, r2, s2);
				if (!comboFreq[normId]) comboFreq[normId] = {};
				comboFreq[normId][action] = (comboFreq[normId][action] || 0) + weight;
				continue;
			}

			const hands = expand(raw);
			if (!hands) {
				console.warn("Could not read range token:", raw);
				continue;
			}
			for (const h of hands) {
				if (!freq[h]) freq[h] = {};
				freq[h][action] = (freq[h][action] || 0) + weight;

				const combos = getCombosForHand(h);
				for (const cmb of combos) {
					if (!comboFreq[cmb.id]) comboFreq[cmb.id] = {};
					comboFreq[cmb.id][action] = (comboFreq[cmb.id][action] || 0) + weight;
				}
			}
		}
	}

	const rest = str.replace(/\[([\d.]+)%?\](.*?)\[\/[\d.]*%?\]/g, (_, pct, inner) => {
		addTokens(inner, parseFloat(pct) / 100, defaultAction);
		return "";
	});
	addTokens(rest, 1.0, defaultAction);

	for (const h in partial) {
		if (!freq[h]) freq[h] = {};
		for (const act in partial[h]) {
			freq[h][act] = Math.min(1, (freq[h][act] || 0) + partial[h][act]);
		}
	}

	return { freq, comboFreq };
}
