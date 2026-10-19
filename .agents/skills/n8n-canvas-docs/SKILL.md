---
name: n8n-canvas-docs
description: >-
  Document an n8n workflow canvas with sticky notes and canvas groups accurately,
  no overlaps and no truncated text. Use whenever adding or fixing sticky notes,
  zone labels, or node groups (nodeGroups) on an n8n workflow (via the REST API
  or n8n-mcp). Covers the groups-vs-stickies routing decision, the two sticky
  layout patterns, the sizing math, the sticky node schema, and a
  construction-time checker plus the screenshot verification loop.
---

# Documenting an n8n canvas with stickies

n8n has **no canvas render API**, so you cannot screenshot the graph from code.
That is exactly why placing stickies "by eye" fails: you guess coordinates, push
them, and only find the overlap or truncation when a human opens the editor. This
skill removes the guessing. Size everything by rule, run the bundled checker on
the workflow JSON, and only then push.

## The two patterns (pick one per group of nodes)

1. **Zone background.** One large sticky sits *behind* a group of nodes; the nodes
   render on top. The sticky title labels the zone (INTAKE, PRICE, ...). Sticky
   overlapping nodes is intentional here. Use for grouping a flow into stages.
2. **Stage caption.** A sticky sits *below* (or above) each node or small node
   group, describing that step. Sticky must NOT overlap any node or its neighbors.
   Use for a linear, step-by-step walkthrough.

For a **linear flow you want to narrate**, the zone-background pattern (1) is
usually the right call: one zone sticky behind each node or small node group, all
on one aligned row, nodes sitting inside. It reads cleaner than captions hanging
below the nodes and it is what a careful operator expects. Reach for captions (2)
only when a zone background would be too busy.

Do not mix them on the same nodes. The checker reports sticky/node containment as
`info` for the zone pattern; a side-by-side sticky overlap is an ERROR.

## Canvas groups vs stickies (n8n 2.28+)

n8n 2.28 added native **canvas groups** (nodeGroups): a named container drawn
around member nodes that follows them when dragged. On modern instances this
changes the zoning decision:

- **Group** = structural zoning. A plain "these nodes are one stage" label with no
  prose. Groups track their nodes, so they survive human rearranging; a background
  sticky does not move with the nodes it frames.
- **Sticky** = everything with content or a color role. Markdown body text, the
  color key (green/red/blue/orange/gray), title banners, runbook/reference panels,
  stage captions. Groups carry only a name.

Routing: on n8n 2.28+ prefer a **group** for bare zoning and drop the orange
background frame for that area (one zoning mechanism per area, group + frame on
the same nodes is redundant). Keep the **zone-background sticky pattern** when the
zone needs a color role or body text, or when the instance is pre-2.28. Stickies
layer fine alongside groups for captions and doc panels.

Authoring goes through the `setNodeGroups` op of `n8n_update_partial_workflow`
(see `n8n-mcp-tools-expert` for the full shape). The behaviors that bite:

- It is a **full replacement**, like `replaceConnections`. Pass every group you
  want to keep; anything omitted is deleted. `nodeGroups: []` ungroups everything.
- Each group takes `nodeNames` **or** `nodeIds`, not both.
- Unmanaged edits are safe. Removing a grouped node prunes it from its group, and
  a group n8n can no longer accept is silently ungrouped; adjustments surface in
  `details.warnings`, so read them after edits to grouped workflows.
- `layout_check.py` only reads sticky nodes. It cannot see groups, so group
  membership is verified by reading back the workflow JSON, not by the checker.

## Sizing math (the whole point)

Measured at default editor zoom:

- **Chars per line** in a sticky ≈ `width / 9.5`.
- **Line height** ≈ `22 px`. Blank lines count. A `###` header adds ~12 px.
- **Required height** ≈ `lines * 22 + 40` padding. Round UP. Truncation clips
  silently with a fade, so err large; empty space at the bottom is harmless.
- **Regular node footprint** ≈ `100 x 100 px`; `position` is the top-left corner.

Rules that follow from the math:

- **Stage-caption pattern:** set the node **pitch** (x-distance between adjacent
  nodes) to at least `sticky_width + 20`. A 260-280 px sticky wants a **300 px
  pitch**. Do not leave nodes at n8n's default ~220 px pitch and hang wide
  stickies under them, they will collide.
- **Gaps:** keep >= 20 px between adjacent stickies.
- **Vertical placement:** stage captions ~150-200 px below the node row
  (`node_y + ~200`). The title sticky goes above the nodes.
- **Width vs height trade:** a wide sticky (spanning 2 nodes) needs little height;
  a narrow one needs more. Compute per sticky, do not reuse one height.

## Aligning a row of zone stickies (the algorithm)

A human dragging stickies gets them *close* but never pixel-perfect: tops look
level but heights differ by a few px (so bottoms are ragged), and one gutter is
off. Snap them with this algorithm, then let the checker confirm it:

1. **Group into a row.** Stickies whose top-y are within ~40 px of each other are
   one row. Sort them left to right by x.
2. **Level the tops.** Set every sticky's `y` to the row's common top (the min, or
   whatever value you want the row to sit at).
3. **Level the bottoms.** Set every sticky's `height` to one value (the max of the
   row, so nothing clips). Equal top + equal height => equal bottom.
4. **Uniform gutter, cascaded.** Pick one gutter G (keep it small and consistent,
   8-16 px is typical). Keep the leftmost sticky's `x` as the anchor, then for each
   next sticky set `x = prev.x + prev.width + G`. **Keep the widths** (they are
   content-driven and different per zone; that is fine, only the gutter must match).
5. **Title banner spans the block.** Set the title sticky's `x` to the row's left
   edge and its `width` to `row_right - row_left`, so its edges are flush with the
   first and last zones. Put the **same gutter G above the zones**: title
   `y = zone_top - title_height - G`. One G value used for every gap (left, right,
   and the title gap) is what "uniform spacing" means to an exacting eye.
6. **Nodes on one row.** Set every flow node's `y` to a single value inside the
   zones (e.g. row_top + ~200), so the node row is level too. Nodes keep their x
   and sit inside their zone.

This is exactly what `align` in practice looks like: keep widths and left anchor,
snap the other four things. Different-width zones with equal gutters and level
tops/bottoms *is* "perfectly aligned"; equal widths are NOT required.

## Sticky node schema (REST API / n8n-mcp)

```json
{
  "parameters": { "content": "## Title\n\nBody markdown.", "width": 280, "height": 300 },
  "type": "n8n-nodes-base.stickyNote",
  "typeVersion": 1,
  "position": [x, y],
  "id": "st-something",
  "name": "sticky-st-something"
}
```

`content` is markdown (headers, bold, `code`). `width`/`height` are in
`parameters`, not top-level. `color` is an integer 1-7 (see the color key below).

## Color key (studio-wide, every workflow)

Color-code sticky notes by the ROLE of what they cover. n8n `color` param → meaning:

- **Green (4)** = human interaction points (form intake, approval gates, anything a person touches).
- **Red (3)** = vitally important infrastructure / critical pieces / configurations.
- **Blue (5)** = routing logic and data transformation.
- **Orange (2, gold)** = borders/frames (a large background sticky behind a group to frame it). n8n has no true orange; gold is the closest.
- **Gray (7, neutral)** = documentation (title banner, runbook/reference doc panels).
- **Purple (6)** = domain-specific accents, used sparingly (not a fixed role).

The n8n palette is `1` yellow, `2` gold, `3` red, `4` green, `5` blue, `6` purple, `7` neutral-gray. A reader should decode a board's shape from color alone. An **orange frame** is a big background sticky (bigger than the group, behind it), the outermost layer of the zone-background pattern.

## The 16px grid (non-negotiable for even gutters)

n8n **snaps every sticky's x/y to a 16px grid on save**. If your gutters or dimensions are not grid-aligned, the moment a human drags anything the editor re-snaps your stickies and your even gutters become uneven (e.g. 8px gutters collapse to 20/4/4/20). So:

- **Gutter G = 16** (or any multiple of 16), used identically for every gap.
- **Every sticky width and height a multiple of 16.** Then bottoms and right edges land on the grid, and the next tile's grid-aligned top/left produces an exact 16px gutter that survives dragging.
- Snap every derived coordinate with `round(v/16)*16`. Nodes are already on the 16-grid.

This is why the earlier "8px everywhere" guidance does not survive an editor session; prefer 16 and grid-align all dimensions.

## The workflow

1. Decide the pattern and the node layout. For stage captions, **spread the nodes
   first** to a 300 px pitch (edit their `position`), then place stickies under them.
2. Build the workflow JSON with the stickies sized by the math above.
3. **Run the checker** (`scripts/layout_check.py <workflow.json>`). It must print
   `RESULT: ok` with zero ERRORs. It flags:
   - `STICKY OVERLAP` (two stickies collide side by side) — always fix.
   - `TRUNCATION` (height < estimated need) — always fix, raise the height.
   - `ROW TOPS/BOTTOMS NOT LEVEL`, `GUTTERS UNEVEN` — run the alignment algorithm.
   - `info: sticky contains node` — expected for the zone-background pattern.
   - `warn: nested` — one sticky fully inside another; intentional only if you meant it.
4. PATCH the workflow to n8n (keep the existing id + form path if editing in place;
   a fresh POST mints a new id and can hit a webhook-path conflict).
5. **Visually confirm.** The checker is construction-time; it cannot see the real
   render. Get a screenshot: ask the user (fastest), or drive the editor with
   Playwright (`<N8N_BASE_URL>/workflow/<id>`). Note: the editor requires n8n
   login; do NOT type a live password into a tool call (it lands in the
   transcript). If you cannot auth without exposing a secret, fall back to the
   user screenshot. Iterate until it reads cleanly.

## Checker

`scripts/layout_check.py` reads a workflow JSON and reports **overlaps,
truncation, and row alignment** (level tops, level bottoms, uniform gutters).
Exit code 1 on any ERROR. Run it every time before pushing, and again on the
exported workflow after. It is the guardrail that replaces eyeballing, but it is
construction-time only, so still get a real screenshot for the final sign-off.

## Gotchas

- **Default pitch is too tight.** n8n places new nodes ~220 px apart. Wide stage
  stickies need a wider pitch; spread the nodes first.
- **Height is the usual failure.** When unsure, over-size height. The estimator is
  conservative but real fonts vary; leave margin.
- **PATCH, don't re-POST**, when fixing an existing workflow, to keep its id and
  webhook/form path (a form-path collision blocks activation with a 409).
- **Reference:** the `figma-design-build` skill covers FigJam/Figma canvases (a
  different tool with its own screenshot loop); this skill is n8n-specific.
