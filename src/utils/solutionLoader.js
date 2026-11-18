import { normalizeSolution } from "./normalizeSolution";

export const EMPTY_SOLUTION_INDEX = [];
export const EMPTY_SOLUTION_URLS = {};

export function getSolutionAssetUrl(solutionUrls, id) {
	return id ? solutionUrls?.[`./data/solutions/${id}.json`] : undefined;
}

export async function fetchJson(url, { signal } = {}) {
	const response = await fetch(url, { cache: "no-cache", signal });
	if (!response.ok) {
		throw new Error(`The solution file could not be loaded (HTTP ${response.status}).`);
	}
	return response.json();
}

export async function fetchSolutionJson(url, { signal } = {}) {
	const data = await fetchJson(url, { signal });
	if (!data || typeof data !== "object") {
		throw new Error("The solution file must contain a JSON object.");
	}
	return normalizeSolution(data);
}
