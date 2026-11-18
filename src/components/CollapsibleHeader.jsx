import { ToggleArrow } from "./icons";

export default function CollapsibleHeader({
	as: Tag = "h2",
	className,
	open,
	onToggle,
	children,
}) {
	return (
		<Tag className={className} onClick={onToggle}>
			{children}
			<ToggleArrow open={open} />
		</Tag>
	);
}
