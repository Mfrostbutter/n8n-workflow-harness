#!/usr/bin/env python3
"""Check an n8n workflow's sticky layout: overlaps, truncation, and row alignment.

Construction-time verification for canvas documentation, no render needed.
- Sticky vs sticky overlap  -> ERROR (they collide; ok only if intentional nesting)
- Sticky vs node overlap    -> info  (expected for the zone/background pattern)
- Sticky height < estimated -> ERROR (text will clip)
- Row not aligned           -> ERROR (tops/bottoms not level, or gutters uneven)

A "row" is a set of stickies whose tops are within ROW_TOL of each other (the
zone-background pattern). For each row it checks: tops equal, bottoms equal
(uniform height), gutters equal.

Usage: python layout_check.py <workflow.json>
"""
import json, sys, math

NODE_W, NODE_H = 100, 100          # n8n regular node footprint (approx)
CHAR_PX = 9.5                      # px per char in a sticky at default zoom
LINE_PX = 22                       # px per wrapped line
HEADER_EXTRA = 12                  # extra px for a '### ' header line
PAD = 40                          # vertical padding inside a sticky
ROW_TOL = 40                      # stickies within this top-y delta are one row

def box(n):
    x, y = n["position"]
    if n["type"].endswith("stickyNote"):
        p = n["parameters"]
        return x, y, p.get("width", 240), p.get("height", 240)
    return x, y, NODE_W, NODE_H

def overlap(a, b):
    ax, ay, aw, ah = a; bx, by, bw, bh = b
    return not (ax + aw <= bx or bx + bw <= ax or ay + ah <= by or by + bh <= ay)

def est_height(content, width):
    cpl = max(8, int(width / CHAR_PX))
    lines = 0
    for raw in content.split("\n"):
        if raw == "":
            lines += 1; continue
        lines += max(1, math.ceil(len(raw) / cpl))
    extra = HEADER_EXTRA if ("##" in content) else 0
    return lines * LINE_PX + PAD + extra

wf = json.load(open(sys.argv[1], encoding="utf-8"))
nodes = wf["nodes"]
stickies = [n for n in nodes if n["type"].endswith("stickyNote")]
regular = [n for n in nodes if not n["type"].endswith("stickyNote")]
errors, warns, infos = [], [], []

# --- overlaps ---
for i in range(len(stickies)):
    for j in range(i + 1, len(stickies)):
        a, b = box(stickies[i]), box(stickies[j])
        if overlap(a, b):
            # nesting (one fully inside the other) is intentional; side overlap is not
            ax, ay, aw, ah = a; bx, by, bw, bh = b
            nested = (ax >= bx and ay >= by and ax+aw <= bx+bw and ay+ah <= by+bh) or \
                     (bx >= ax and by >= ay and bx+bw <= ax+aw and by+bh <= ay+ah)
            (warns if nested else errors).append(
                f"{'nested' if nested else 'STICKY OVERLAP'}: '{stickies[i]['name']}' x '{stickies[j]['name']}'")

for s in stickies:
    sb = box(s)
    for r in regular:
        if overlap(sb, box(r)):
            infos.append(f"sticky '{s['name']}' contains node '{r['name']}' (zone/background pattern)")
    _, _, w, h = sb
    need = est_height(s["parameters"].get("content", ""), w)
    if h < need:
        errors.append(f"TRUNCATION: '{s['name']}' height {h} < needs ~{need} (width {w})")

# --- row alignment (zone pattern) ---
rows = []
for s in sorted(stickies, key=lambda n: n["position"][1]):
    placed = False
    for row in rows:
        if abs(row[0]["position"][1] - s["position"][1]) <= ROW_TOL:
            row.append(s); placed = True; break
    if not placed:
        rows.append([s])

for row in rows:
    if len(row) < 2:
        continue
    row.sort(key=lambda n: n["position"][0])
    tops = {n["position"][1] for n in row}
    bottoms = {n["position"][1] + box(n)[3] for n in row}
    gutters = [row[i]["position"][0] - (row[i-1]["position"][0] + box(row[i-1])[2]) for i in range(1, len(row))]
    names = ", ".join(n["name"].replace("sticky-", "") for n in row)
    if len(tops) > 1:
        errors.append(f"ROW TOPS NOT LEVEL ({names}): tops {sorted(tops)}")
    if len(bottoms) > 1:
        errors.append(f"ROW BOTTOMS NOT LEVEL ({names}): bottoms {sorted(bottoms)} (unify heights)")
    if len(set(gutters)) > 1:
        errors.append(f"GUTTERS UNEVEN ({names}): {gutters}")

print(f"stickies: {len(stickies)}  nodes: {len(regular)}  rows: {sum(1 for r in rows if len(r) > 1)}")
for e in errors: print("  ERROR:", e)
for w in warns: print("  warn :", w)
for i in infos[:3]: print("  info :", i)
if len(infos) > 3: print(f"  info : ... +{len(infos)-3} more zone containments")
print("RESULT:", "FAIL" if errors else "ok")
sys.exit(1 if errors else 0)
