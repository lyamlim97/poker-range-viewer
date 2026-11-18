import { getOrderedActions } from "./actionHelpers";

export const NODE_WIDTH = 210;
export const HEADER_HEIGHT = 30;
export const ROW_HEIGHT = 24;
export const FOOTER_HEIGHT = 28;
const COLUMN_GAP = 110;
const ROW_GAP = 48;

export function getNodeHeight(actionCount) {
	return HEADER_HEIGHT + Math.max(actionCount, 1) * ROW_HEIGHT + FOOTER_HEIGHT;
}

export function getActionRowCenter(position, actionIndex) {
	return position.y + HEADER_HEIGHT + actionIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
}

function getActions(node) {
	return Array.isArray(node?.actions) ? node.actions : [];
}

function getTarget(action) {
	return typeof action === "object" && typeof action?.nextNodeId === "string"
		? action.nextNodeId
		: "";
}

// Layered left-to-right layout: column = shortest distance from the root.
export function computeAutoLayout(solution) {
	const nodes = solution?.nodes || {};
	const ids = Object.keys(nodes);
	const rootId = Object.hasOwn(nodes, solution?.rootNodeId)
		? solution.rootNodeId
		: ids[0];
	const depth = new Map();

	if (rootId) {
		depth.set(rootId, 0);
		const queue = [rootId];
		for (let head = 0; head < queue.length; head += 1) {
			const id = queue[head];
			for (const { action } of getOrderedActions(getActions(nodes[id]))) {
				const target = getTarget(action);
				if (target && Object.hasOwn(nodes, target) && !depth.has(target)) {
					const targetDepth = depth.get(id) + 1;
					depth.set(target, targetDepth);
					queue.push(target);
				}
			}
		}
	}

	const orphanDepth = Math.max(-1, ...depth.values()) + 1;
	for (const id of ids) {
		if (!depth.has(id)) {
			depth.set(id, orphanDepth);
		}
	}

	const children = new Map(ids.map((id) => [id, []]));
	for (const id of ids) {
		const targets = new Set();
		for (const { action } of getOrderedActions(getActions(nodes[id]))) {
			const target = getTarget(action);
			if (
				target &&
				Object.hasOwn(nodes, target) &&
				target !== id &&
				(depth.get(target) > depth.get(id))
			) {
				targets.add(target);
			}
		}
		children.set(id, [...targets]);
	}

	const layout = {};
	const placed = new Set();
	let nextLeafY = 0;

	const placeSubtree = (id, active = new Set()) => {
		if (placed.has(id) || active.has(id)) return;
		active.add(id);

		const childIds = children
			.get(id)
			.filter((target) => !active.has(target));
		if (childIds.length === 0) {
			const height = getNodeHeight(getActions(nodes[id]).length);
			layout[id] = {
				x: depth.get(id) * (NODE_WIDTH + COLUMN_GAP),
				y: nextLeafY,
			};
			nextLeafY += height + ROW_GAP;
			placed.add(id);
			active.delete(id);
			return;
		}

		for (const childId of childIds) {
			placeSubtree(childId, active);
		}

		const visibleChildIds = childIds.filter((childId) => layout[childId]);
		if (visibleChildIds.length === 0) {
			active.delete(id);
			return;
		}

		const firstChild = layout[visibleChildIds[0]];
		const lastChild = layout[visibleChildIds.at(-1)];
		const firstCenter =
			firstChild.y + getNodeHeight(getActions(nodes[visibleChildIds[0]]).length) / 2;
		const lastCenter =
			lastChild.y + getNodeHeight(getActions(nodes[visibleChildIds.at(-1)]).length) / 2;
		const height = getNodeHeight(getActions(nodes[id]).length);
		layout[id] = {
			x: depth.get(id) * (NODE_WIDTH + COLUMN_GAP),
			y: (firstCenter + lastCenter) / 2 - height / 2,
		};
		placed.add(id);
		active.delete(id);
	};

	if (rootId) placeSubtree(rootId);
	for (const id of ids) {
		if (!placed.has(id)) placeSubtree(id);
	}
	return layout;
}

export function buildEdges(solution) {
	const nodes = solution?.nodes || {};
	const edges = [];
	for (const [from, node] of Object.entries(nodes)) {
		getOrderedActions(getActions(node)).forEach(({ action, visualIndex }) => {
			const to = getTarget(action);
			if (to && Object.hasOwn(nodes, to)) {
				edges.push({ id: `${from}:${visualIndex}`, from, to, actionIndex: visualIndex });
			}
		});
	}
	return edges;
}
