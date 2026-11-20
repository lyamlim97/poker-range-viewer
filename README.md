# Poker Range Viewer

## 1. Overview

Poker Range Viewer is a browser app for exploring preflop poker ranges. It has two modes:

- **Scenarios** - browse and edit the preset ranges grouped by opening size.
- **Range Viewer** - explore linked solution trees, action frequencies, and individual hand combos.
- **Range DAG** - view the solution tree as a draggable graph, add actions with a **+ Add** button on any node, and paste their ranges into a selected solution file.

### Run locally

```sh
npm install
npm run dev
```

Use `npm run build` to create a production build and `npm run lint` to check the source.

## 2. Scenarios

The **Scenarios** mode uses the legacy range files in `src/data/`, such as `ranges-2x.json` and `ranges-2p5x.json`. Each `ranges-*.json` file supplies an opening-size tab. The viewer groups its ranges into sections such as RFI, BB defense, 3-bet/5-bet, squeeze, and cold 4-bet.

Select a spot to inspect its range. The viewer flags hands whose action frequencies do not add up to 100%. You can edit the range text in the editor; **Download updated ranges.json** exports your edits as a JSON file. The editor does not write changes back to the source file automatically.

To add or update a scenario preset, edit the corresponding `ranges-*.json` file and keep its existing nested structure. For the expected format, use one of the files in `src/data/` as a reference.

## 3. Range Viewer

The **Range Viewer** mode reads solution files from `src/data/solutions/`. To add a solution, place its `.json` file in that folder and add its display metadata to `src/data/solution-index.json` using the file name without the `.json` extension as `id`. The viewer fetches only the selected solution, then parses its node ranges while showing progress. The included [example solution](./src/data/solutions/example-solution.json) demonstrates a small linked tree; its ranges are illustrative, not solver output.

After editing the selected solution file while the app is running, select **Reload** to fetch, parse, and fully validate its latest contents without a full-page refresh. The viewer keeps the current action path if it still resolves; otherwise it returns to the root.

Select **Change** to choose a solution. Select an action in the tree to follow that branch. The tree shows the action history and previews later positions assuming intervening players fold. Select a previous action to rewind and explore a different branch. The range grid and sidebar show the current node's action frequencies and combo details.

When a position acts again later in the tree, the viewer checks that node's combined action frequencies against that position's most recent prior action range. For example, EP's later response is checked against EP's earlier raise range. Positions with no prior action range continue to be checked against 100%.

The **Tree validation** section at the bottom shows the full report generated when the selected solution loads or reloads. It checks actions without `rawRangeText`, missing node targets, actions without `nextNodeId`, unreachable nodes, cycles, invalid node IDs or positions, and branches that do not end at a terminal or almost-never-reached node. Continuing actions must link to an explicit node; terminal and almost-never-reached actions are endpoints and do not link to another decision.

## 4. Range DAG

The **Range DAG** tab shows the selected solution as a directed graph: each node is a decision, each action row is an output port, and arrows lead to the next decision. Drag a node's header to move it, drag the background to pan, and scroll to zoom (**Fit** and **Auto layout** reset the view). Node positions are remembered per solution in the browser. Click a node or action to inspect it, or use **+ Add** on a node to open the action builder.

The action builder supports Fold, Call, Raise, and All-in actions. Select one or more actions, choose the optional sizes, and review the live preview before adding them. Each preview shows whether the action will continue to a generated decision node, end the hand, needs a valid size, or duplicates an existing action. A continuing action automatically creates and links its next decision node using the established path-style `NodeId` convention and next-position rules; terminal actions do not create a decision node. Advanced continuing, terminal, and almost-never-reached outcomes remain available from the individual **Add an action** form.

Select an action to paste its range. The editor stores the pasted text unchanged as that action's `rawRangeText`. New actions start without a range; paste one or use **Mark empty range** when the action intentionally has no combos. Use **Delete range** to remove only the selected action's range, or **Delete action** to remove the action and range from the node. Delete controls are also available directly on each action row in the graph and action list. Actions are displayed visually in this order everywhere: All-in/Jam, Raise family, Call, Fold, then unknown actions. Raise family actions sort 5-Bet, 4-Bet, 3-Bet, Squeeze, Raise/Bet, then numeric size. This sorting does not change the saved JSON. Auto layout uses the same visual action order to arrange future nodes vertically. The node list highlights actions still needing range text.

Changes are autosaved to the selected `src/data/solutions/<id>.json` file after a short pause, but only when running the local Vite development server (`npm run dev`). The save endpoint writes only existing solution files. If the file changes outside the editor while it is open, autosave stops rather than overwriting the external edit; choose **Overwrite file** to keep the editor's version or **Reload from disk** to discard editor changes and load the external version. In the Range Viewer, use **Reload** to load the latest saved solution.

The editor intentionally selects from existing solutions; add new solution files and their metadata to `src/data/solution-index.json` before editing them here, then restart the dev server so the asset list and save allowlist are refreshed.

## 5. Solution file structure

A solution has three top-level properties:

- `meta` - information shown for the solution, such as title, game, stack, format, rake, open size, and 3-bet setup.
- `rootNodeId` - the ID of the first decision node.
- `nodes` - an object mapping node IDs to decision or terminal nodes.

Each decision node has a matching `nodeId`, a `position`, and an `actions` array. Each action has a unique `id`, a user-facing `label`, and a `rawRangeText` range. Add `nextNodeId` when that action links to another node; its value must match a key in `nodes`.

For example, this action puts the `AA` range on a raise and links it to the MP decision:

```json
{
  "id": "raise-2",
  "label": "Raise 2bb",
  "nextNodeId": "EP_RFI_MP",
  "rawRangeText": "AA"
}
```

When adding a branch, define its target node in `nodes` and ensure its `nodeId` matches the map key. Keep each action's range with that action; different actions at the same node have separate ranges.

## 6. Other notes

### Node IDs and positions

Node IDs encode the action history and normally end with the position to act. Use the canonical positions `EP`, `MP`, `CO`, `BU`, `SB`, and `BB`.

Action tokens used in IDs:

| Token | Meaning |
| --- | --- |
| `F` | Fold |
| `C` | Call |
| `RFI` | First-in raise |
| `SQZ` | Squeeze |
| `3B`, `4B`, `5B` | 3-bet, 4-bet, 5-bet |
| `AI` | All-in |

Examples:

- `EP` - EP acts first.
- `EP_F_MP_F_CO_RFI_BU` - EP and MP folded, CO raised first-in, and BU acts.
- `EP_F_MP_F_CO_RFI_BU_C_SB_F_BB` - CO raised, BU called, SB folded, and BB acts.
- `EP_RFI_MP_3B_CO_4B_BU_AI_SB` - EP raised, MP 3-bet, CO 4-bet, BU went all-in, and SB acts.

If the root decision follows earlier folds, include those folds in `rootNodeId`. For example, `EP_F_MP_F_CO_F_BU` starts with BU after EP, MP, and CO have folded.

The `rootNodeId` and every `nextNodeId` must point to a key in `nodes`. Each node's `nodeId` must exactly match its key, and its `position` must match the final position token in its ID.

### Range text

`rawRangeText` accepts hand notation such as `QQ+`, `AKs`, and `A5s-A2s`, weighted blocks such as `[75]A9s[/75]`, and individual card combos such as `AsKd: 0.5`. Frequencies are between `0` and `1`; for example, `AsKd: 0.5` assigns that combo at 50% frequency. Use an empty string when an action has no combos, but keep the `rawRangeText` property on the action.

### Terminal and unavailable nodes

A terminal node ends a hand branch. Set `terminal` to `true` and `actions` to an empty array. The viewer calculates the pot from the actions in the path; do not store a fixed pot amount.

If a line is reached in fewer than 1 in 10,000 hands and its strategy was not saved, tag the node:

```json
{
  "nodeId": "EP_RFI_MP_3B_CO_4B_BU_AI_SB_C_BB_C_EP",
  "position": "EP",
  "tags": ["almost-never-reached"],
  "actions": []
}
```

This is not a terminal node. The viewer displays an **Almost never reached** badge and stops offering or previewing actions at that node. Only use this tag when the strategy was omitted; do not use it for nodes with saved ranges.
