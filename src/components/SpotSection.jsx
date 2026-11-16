import { useState } from "react";
import Btn from "./Btn";
import { columnsFor } from "../utils/positions";

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
			<h2 className="section-toggle" onClick={() => setSectionOpen(!sectionOpen)}>
				<span>
					{title} <span className="h2-note">{note}</span>
				</span>
				<span className="toggle-arrow">{sectionOpen ? "▼" : "▶"}</span>
			</h2>

			{sectionOpen && (
				<div className="section-content">
					{openerEntries.map(([opener, rows]) => {
						const isOpen = isOpenerOpen(opener);
						return (
							<div className="opener-group" key={opener}>
								<h3 className="opener-label" onClick={() => toggleOpen(opener)}>
									<span>{opener} RFI</span>
									<span className="toggle-arrow">{isOpen ? "▼" : "▶"}</span>
								</h3>

								{isOpen && (
									<div className="opener-content">
										{Object.entries(rows).map(([row, buttons], i, all) => {
											const size = (name) => name.split("+").length;
											const newGroup = i > 0 && size(row) !== size(all[i - 1][0]);
											return (
												<div className={newGroup ? "row group-start" : "row"} key={row}>
													<span className="row-label">{rowLabel(row)}</span>
													<div
														className="buttons"
														style={{ gridTemplateColumns: `repeat(${columns.length}, 44px)` }}
													>
														{columns.map((col) =>
															buttons && col in buttons ? (
																<Btn
																	key={col}
																	id={`${title} > ${opener} > ${row} > ${col}`}
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
