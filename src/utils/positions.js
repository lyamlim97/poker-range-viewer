export const POSITIONS_6MAX = [
  { id: "EP", defaultStack: 100 },
  { id: "MP", defaultStack: 100 },
  { id: "CO", defaultStack: 100 },
  { id: "BU", defaultStack: 100 },
  { id: "SB", defaultStack: 99.5 },
  { id: "BB", defaultStack: 99 },
];

// Seat ids in order, for indexing and iteration.
export const POSITIONS = POSITIONS_6MAX.map(({ id }) => id);

// The same ids as a Set, for membership checks.
export const POSITION_IDS = new Set(POSITIONS);

export const getSeat = (id) => POSITIONS_6MAX.find((seat) => seat.id === id);

// Accepts [{position, action}] or {EP: action, ...}; returns [{position, action}]
// with string actions, array order kept and object form in seat order.
export function normalizeActionPath(actionHistory = {}) {
  if (Array.isArray(actionHistory)) {
    return actionHistory
      .filter((event) => event && POSITION_IDS.has(event.position) && event.action)
      .map((event) => ({ position: event.position, action: String(event.action) }));
  }

  return POSITIONS
    .filter((position) => actionHistory?.[position])
    .map((position) => ({ position, action: String(actionHistory[position]) }));
}

// The columns a section needs: every position that appears as a key
// in any of the given rows, kept in seat order.
export const columnsFor = (rows) =>
  POSITIONS.filter((p) => rows.some((row) => p in row));
