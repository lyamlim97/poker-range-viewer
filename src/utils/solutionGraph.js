import { getOrderedActions } from "./actionHelpers";

export const NODE_WIDTH = 210;
export const HEADER_HEIGHT = 30;
export const ROW_HEIGHT = 24;
export const FOOTER_HEIGHT = 28;
const COLUMN_GAP = 110;
const ROW_GAP = 28;

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
	const layoutOrder = new Map();

	if (rootId) {
		depth.set(rootId, 0);
		layoutOrder.set(0, [rootId]);
		const queue = [rootId];
		for (let head = 0; head < queue.length; head += 1) {
			const id = queue[head];
			for (const { action } of getOrderedActions(getActions(nodes[id]))) {
				const target = getTarget(action);
				if (target && Object.hasOwn(nodes, target) && !depth.has(target)) {
					const targetDepth = depth.get(id) + 1;
					depth.set(target, targetDepth);
					queue.push(target);
					if (!layoutOrder.has(targetDepth)) layoutOrder.set(targetDepth, []);
					layoutOrder.get(targetDepth).push(target);
				}
			}
		}
	}

	const orphanDepth = Math.max(-1, ...depth.values()) + 1;
	for (const id of ids) {
		if (!depth.has(id)) {
			depth.set(id, orphanDepth);
			if (!layoutOrder.has(orphanDepth)) layoutOrder.set(orphanDepth, []);
			layoutOrder.get(orphanDepth).push(id);
		}
	}

	const layout = {};
	for (const [column, orderedIds] of layoutOrder) {
		let nextY = 0;
		for (const id of orderedIds) {
			layout[id] = {
				x: column * (NODE_WIDTH + COLUMN_GAP),
				y: nextY,
			};
			nextY += getNodeHeight(getActions(nodes[id]).length) + ROW_GAP;
		}
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
