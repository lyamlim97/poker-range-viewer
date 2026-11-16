# Poker Range Viewer

For use as quick reference of poker ranges across all scenarios.

## Solution tree node IDs

Solution files link decision nodes with `rootNodeId`, node-map keys, and each action's `nextNodeId`. A node's `nodeId` must match its map key. IDs describe the action sequence and end with the position to act:

- `EP`: EP acts first.
- `EP_F_MP_F_CO_RFI_BU`: EP and MP folded, CO opened, and BU acts.
- `EP_F_MP_F_CO_RFI_BU_C_SB_F_BB`: EP and MP folded, CO opened, BU called, SB folded, and BB acts.

Use positions `EP`, `MP`, `CO`, `BU`, `SB`, and `BB`. Action tokens are `F` (fold), `C` (call), `RFI` (first-in raise), `SQZ` (squeeze), `3B`/`4B`/`5B` (later raises), `X` (check), and `AI` (all-in). Combine the raise level with an all-in when both are relevant, such as `5B_AI`. Omit sizes unless two branches would otherwise have the same ID; then suffix that action token with the size, such as `RFI-2.5`.

The viewer infers the acting position from the final ID token and checks it against the node's `position` field. Keep that field consistent. Action labels and `nextNodeId` links remain the source of truth for the actual action, range, and pot calculation.

Terminal states have `terminal: true` and `actions: []`. For example, a walk can end at `EP_F_MP_F_CO_F_BU_F_SB_F_BB`, with position `BB` and a title such as `BB wins uncontested`. The viewer calculates the pot from the actions in the path; do not store a fixed pot size in the JSON. Every action should include `rawRangeText`, even when the range is empty.

Nodes whose strategy was omitted because the line is reached in fewer than 1 in 10,000 hands can use the `almost-never-reached` tag:

```json
{
  "nodeId": "EP_RFI_MP_3B_CO_4B_BU_AI_SB_C_BB_C_EP",
  "position": "EP",
  "tags": ["almost-never-reached"],
  "actions": []
}
```

This is not a terminal node: the viewer shows an “Almost never reached” badge, explains that no strategy was saved, and stops offering or previewing actions beyond that node. Do not add the tag to nodes that have saved strategy data.

The ranges in `src/data/solutions/example-solution.json` are illustrative examples, not solver output.