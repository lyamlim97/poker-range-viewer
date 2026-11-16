import { useState } from "react";
import Btn from "./Btn";
import { columnsFor } from "../utils/positions";
import { isRangeLeaf } from "../utils/checkRange";

export default function Section({ title, data, selected, onSelect }) {
	const [open, setOpen] = useState(true);

	// A leaf is a spot's actions: { Raise: "...", Call: "...", Fold: "..." }.
	// flat data = one row of buttons whose values are leaves (RFI, BB def)
	// nested data = several rows of buttons (vs 3bet/5bet, 3bet/5bet)
	const nested = !isRangeLeaf(Object.values(data)[0]);
	const rows = nested ? Object.entries(data) : [[title, data]];
	const columns = columnsFor(rows.map(([, buttons]) => buttons));

	return (
		<section className="section">
			<h2
				className="section-toggle"
				onClick={() => setOpen(!open)}
			>
				{title}
				<span className="toggle-arrow">
					{open ? "▼" : "▶"}
				</span>
			</h2>

			{open && (
				<div className="section-content">
					{rows.map(([rowKey, buttons]) => (
						<div className="row" key={rowKey}>
							<span className="row-label">
								{nested ? `${rowKey} vs` : title}
							</span>

							<div
								className="buttons"
								style={{
									gridTemplateColumns: `repeat(${columns.length}, 52px)`,
								}}
							>
								{columns.map((col) =>
									col in buttons ? (
										<Btn
											key={col}
											id={nested
												? `${title} > ${rowKey} > ${col}`
												: `${title} > ${col}`}
											selected={selected}
											onSelect={onSelect}
										>
											{col}
										</Btn>
									) : (
										<span key={col} />
									)
								)}
							</div>
						</div>
					))}
				</div>
			)}
		</section>
	);
}
