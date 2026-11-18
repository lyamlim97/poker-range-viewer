export const EDITOR_API_BASE = "/__range-editor";

export function editorLoadUrl(solutionId) {
	return `${EDITOR_API_BASE}/load/${encodeURIComponent(solutionId)}`;
}

export function editorSaveUrl(solutionId) {
	return `${EDITOR_API_BASE}/save/${encodeURIComponent(solutionId)}`;
}
