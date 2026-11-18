export default function FilterGroup({ label, options = [], value, onChange }) {
	return (
		<div className="rv-filter-group">
			<span className="rv-filter-label">{label}</span>
			<div className="rv-filter-buttons">
				{options.map((option) => (
					<button
						key={option}
						className={`rv-fbtn ${value === option ? "active" : ""}`}
						onClick={() => onChange(option)}
					>
						{option}
					</button>
				))}
			</div>
		</div>
	);
}
