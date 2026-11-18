import { useContext } from "react";
import { FlaggedContext } from "../utils/flaggedSpots";

export default function Btn({ id, selected, onSelect, children }) {
	const flagged = useContext(FlaggedContext).has(id);

	return (
		<button
			className={`${selected === id ? "active" : ""} ${flagged ? "flagged" : ""}`}
			onClick={() => onSelect(id)}
		>
			{children}
		</button>
	);
}
