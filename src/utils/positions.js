export const POSITIONS = ["EP", "MP", "CO", "BU", "SB", "BB"];

// The columns a section needs: every position that appears as a key
// in any of the given rows, kept in seat order.
export const columnsFor = (rows) =>
  POSITIONS.filter((p) => rows.some((row) => p in row));
