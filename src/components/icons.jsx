export function TrashIcon() {
	return (
		<svg className="range-editor-button-icon" viewBox="0 0 24 24" aria-hidden="true">
			<path d="M3 6h18" />
			<path d="M8 6V4h8v2" />
			<path d="M19 6l-1 14H6L5 6" />
			<path d="M10 10v6M14 10v6" />
		</svg>
	);
}

export function ToggleArrow({ open }) {
	return <span className="toggle-arrow">{open ? "▼" : "▶"}</span>;
}
