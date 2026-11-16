export const RANKS = "AKQJT98765432";
const R = "[2-9TJQKA]";
const idx = (r) => RANKS.indexOf(r);

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
	const freq = {};
	if (!input) return freq;

	// If input is an object containing actions (e.g. { jam: "...", raise: "...", call: "..." })
	if (typeof input === "object") {
		for (const [action, strVal] of Object.entries(input)) {
			if (typeof strVal !== "string") continue;
			const subFreq = parseSingleString(strVal, action);
			for (const [h, actions] of Object.entries(subFreq)) {
				if (!freq[h]) freq[h] = {};
				for (const [act, val] of Object.entries(actions)) {
					freq[h][act] = (freq[h][act] || 0) + val;
				}
			}
		}
		return freq;
	}

	return parseSingleString(input, "raise");
}

function parseSingleString(str, defaultAction = "raise") {
	const freq = {};
	const partial = {};
	if (!str) return freq;

	function addTokens(text, baseWeight, action) {
		for (let raw of text.split(",")) {
			raw = raw.trim();
			if (!raw) continue;

			let weight = baseWeight;
			const w = raw.match(/^(.+):([\d.]+)$/);
			if (w) {
				raw = w[1];
				weight = parseFloat(w[2]) * baseWeight;
			}

			const c = raw.match(new RegExp(`^(${R})([cdhs])(${R})([cdhs])$`));
			if (c) {
				let [, r1, s1, r2, s2] = c;
				if (idx(r1) > idx(r2)) [r1, r2] = [r2, r1];
				const isPair = r1 === r2;
				const hand = isPair ? r1 + r2 : r1 + r2 + (s1 === s2 ? "s" : "o");
				const total = isPair ? 6 : s1 === s2 ? 4 : 12;

				if (!partial[hand]) partial[hand] = {};
				partial[hand][action] = (partial[hand][action] || 0) + weight / total;
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

	return freq;
}