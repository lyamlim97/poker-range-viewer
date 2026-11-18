import { useState } from "react";
import ButtonRow from "./ButtonRow";
import CollapsibleHeader from "./CollapsibleHeader";
import { columnsFor } from "../utils/positions";
import { SPOT_SEPARATOR } from "../utils/flaggedSpots";

export default function SpotSection({
	title,
	note,
	rowLabel,
	className = "",
	data = {},
	selected,
	onSelect,
	defaultClosedOpeners = ["EP", "MP", "CO", "BU"],
}) {
	const [sectionOpen, setSectionOpen] = useState(true);
	const [open, setOpen] = useState({});

	const openerEntries = Object.entries(data ?? {}).filter(
		([, rows]) => rows && typeof rows === "object"
	);

	const isOpenerOpen = (opener) => open[opener] ?? !defaultClosedOpeners.includes(opener);

	const toggleOpen = (opener) => {
		setOpen((prev) => ({ ...prev, [opener]: !isOpenerOpen(opener) }));
	};

	const allButtons = openerEntries.flatMap(([, rows]) =>
		Object.values(rows).filter((buttons) => buttons && typeof buttons === "object")
	);

	const columns = columnsFor(allButtons);

	return (
		<section className={`section ${className}`}>
			<CollapsibleHeader
				className="section-toggle"
				open={sectionOpen}
				onToggle={() => setSectionOpen(!sectionOpen)}
			>
				<span>
					{title} <span className="h2-note">{note}</span>
				</span>
			</CollapsibleHeader>

			{sectionOpen && (
				<div className="section-content">
					{openerEntries.map(([opener, rows]) => {
						const isOpen = isOpenerOpen(opener);
						return (
							<div className="opener-group" key={opener}>
								<CollapsibleHeader
									as="h3"
									className="opener-label"
									open={isOpen}
									onToggle={() => toggleOpen(opener)}
								>
									<span>{opener} RFI</span>
								</CollapsibleHeader>

								{isOpen && (
									<div className="opener-content">
										{Object.entries(rows).map(([row, buttons], i, all) => {
											const size = (name) => name.split("+").length;
											const newGroup = i > 0 && size(row) !== size(all[i - 1][0]);
											return (
												<ButtonRow
													key={row}
													className={newGroup ? "row group-start" : "row"}
													label={rowLabel(row)}
													columns={columns}
													buttons={buttons}
													columnWidth={44}
													getId={(col) =>
														[title, opener, row, col].join(SPOT_SEPARATOR)
													}
													selected={selected}
													onSelect={onSelect}
												/>
											);
										})}
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}
