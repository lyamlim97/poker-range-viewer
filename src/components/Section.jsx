import { useState } from "react";
import ButtonRow from "./ButtonRow";
import CollapsibleHeader from "./CollapsibleHeader";
import { columnsFor } from "../utils/positions";
import { SPOT_SEPARATOR, isRangeLeaf } from "../utils/flaggedSpots";

export default function Section({ title, data = {}, selected, onSelect }) {
	const [open, setOpen] = useState(true);

	// A leaf is a spot's actions: { Raise: "...", Call: "...", Fold: "..." }.
	// flat data = one row of buttons whose values are leaves (RFI, BB def)
	// nested data = several rows of buttons (vs 3bet/5bet, 3bet/5bet)
	const first = Object.values(data)[0];
	const nested = first !== undefined && !isRangeLeaf(first);
	const rows = nested ? Object.entries(data) : [[title, data]];
	const columns = columnsFor(rows.map(([, buttons]) => buttons));

	return (
		<section className="section">
			<CollapsibleHeader
				className="section-toggle"
				open={open}
				onToggle={() => setOpen(!open)}
			>
				{title}
			</CollapsibleHeader>

			{open && (
				<div className="section-content">
					{rows.map(([rowKey, buttons]) => (
						<ButtonRow
							key={rowKey}
							label={nested ? `${rowKey} vs` : title}
							columns={columns}
							buttons={buttons}
							columnWidth={52}
							getId={(col) =>
								(nested ? [title, rowKey, col] : [title, col]).join(SPOT_SEPARATOR)
							}
							selected={selected}
							onSelect={onSelect}
						/>
					))}
				</div>
			)}
		</section>
	);
}
