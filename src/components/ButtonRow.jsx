import Btn from "./Btn";

// One labelled row of position buttons; columns without a button are left blank.
export default function ButtonRow({
	className = "row",
	label,
	columns,
	buttons,
	columnWidth,
	getId,
	selected,
	onSelect,
}) {
	return (
		<div className={className}>
			<span className="row-label">{label}</span>

			<div
				className="buttons"
				style={{ gridTemplateColumns: `repeat(${columns.length}, ${columnWidth}px)` }}
			>
				{columns.map((col) =>
					buttons && col in buttons ? (
						<Btn key={col} id={getId(col)} selected={selected} onSelect={onSelect}>
							{col}
						</Btn>
					) : (
						<span key={col} />
					)
				)}
			</div>
		</div>
	);
}
