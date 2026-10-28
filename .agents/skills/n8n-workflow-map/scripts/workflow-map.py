#!/usr/bin/env python3
"""Workflow JSON to a Figma map.

Reads exported n8n workflow JSON (nodes, connections, zone stickies) and
writes one Figma Plugin API script per page for the Figma MCP `use_figma`
tool. All layout is computed here; the scripts only draw.

  workflow-map.py model  <workflow.json>... [--zones-dir DIR] -o map.json
  workflow-map.py figma  map.json --pages pages.json [--arch architecture.json]
                         --out-dir DIR [--theme dark|light]

pages.json: {"Intake": ["order-intake.json"], "Agents": ["a.json", "b.json"]}
architecture.json: see ../SKILL.md for the shape.
Standard library only.
"""
import argparse
import json
import os
import re
import sys

# ---- node roles ------------------------------------------------------------

ROLE_BY_TYPE = {
    "webhook": "trigger", "scheduleTrigger": "trigger", "manualTrigger": "trigger",
    "executeWorkflowTrigger": "trigger", "cron": "trigger",
    "code": "code", "set": "code", "function": "code",
    "postgres": "data", "mysql": "data", "microsoftSql": "data", "supabase": "data",
    "googleSheets": "data", "airtable": "data", "dataTable": "data",
    "informationExtractor": "ai", "chainLlm": "ai", "agent": "ai",
    "textClassifier": "ai", "sentimentAnalysis": "ai",
    "if": "decision", "switch": "decision", "filter": "decision", "merge": "decision",
    "executeWorkflow": "subworkflow",
    "httpRequest": "http", "graphql": "http",
    "wait": "wait", "form": "wait",
    "emailSend": "notify", "slack": "notify", "gmail": "notify", "microsoftTeams": "notify",
    "extractFromFile": "file", "convertToFile": "file", "readBinaryFile": "file",
    "respondToWebhook": "http", "html": "code", "splitInBatches": "code", "noOp": "code",
}

LABEL_BY_TYPE = {
    "webhook": "Webhook", "scheduleTrigger": "Schedule trigger", "executeWorkflowTrigger": "Called by workflow",
    "code": "Code", "set": "Set", "postgres": "Postgres", "postgresTool": "Postgres tool",
    "informationExtractor": "Information Extractor", "chainLlm": "LLM chain", "agent": "AI Agent",
    "if": "If", "switch": "Switch", "merge": "Merge", "executeWorkflow": "Execute workflow",
    "httpRequest": "HTTP Request", "httpRequestTool": "HTTP tool", "wait": "Wait",
    "emailSend": "Send email", "extractFromFile": "Extract from file",
    "lmChatOpenAi": "Chat model", "lmChatGoogleGemini": "Gemini model", "lmChatAnthropic": "Claude model",
    "outputParserStructured": "Structured output parser", "outputParserAutofixing": "Auto-fixing parser",
    "respondToWebwook": "Respond", "respondToWebhook": "Respond to webhook", "splitInBatches": "Loop",
    "noOp": "No-op", "html": "HTML",
}

# palette: n8n brand (October 2026), one mode per surface
THEMES = {
    "dark": {
        "bg": "191919", "panel": "242424", "chip": "464646", "text": "FAFAFA",
        "muted": 0.7, "faint": 0.5, "edge": "A4A4A4", "err": "FF91AC", "ai": "FFBCCA",
        "roles": {
            "trigger": "FF91AC", "ai": "FFBCCA", "decision": "BFBFBF", "data": "868686",
            "http": "FAFAFA", "subworkflow": "87003C", "wait": "FFD0D9", "notify": "A4A4A4",
            "code": "676767", "file": "868686", "tool": "FFE8EC", "other": "676767",
        },
    },
    "light": {
        "bg": "FAFAFA", "panel": "F1F1F1", "chip": "FFFFFF", "text": "191919",
        "muted": 0.6, "faint": 0.45, "edge": "676767", "err": "87003C", "ai": "FF91AC",
        "roles": {
            "trigger": "FF91AC", "ai": "FF91AC", "decision": "676767", "data": "A4A4A4",
            "http": "191919", "subworkflow": "87003C", "wait": "FFBCCA", "notify": "868686",
            "code": "BFBFBF", "file": "A4A4A4", "tool": "FFD0D9", "other": "BFBFBF",
        },
    },
}

ROLE_LEGEND = [
    ("trigger", "Trigger / entry"), ("code", "Code or Set"), ("decision", "Decision"),
    ("ai", "Model call"), ("tool", "Agent tool"), ("subworkflow", "Sub-workflow"),
    ("data", "Database"), ("http", "HTTP to another system"), ("file", "File handling"),
    ("wait", "Wait for a person"), ("notify", "Email or message"),
]

NODE_SIZE = 100          # n8n canvas node footprint
CHIP_W, CHIP_H = 176, 48
MARGIN = 48
HEADER_H = 150
LEGEND_H = 150


def short_type(t):
    return t.split(".")[-1]


def role_of(node):
    t = short_type(node["type"])
    if t.endswith("Tool"):
        return "tool"
    if t.startswith("lmChat") or t.startswith("outputParser") or t.startswith("embeddings") or t.startswith("memory"):
        return "ai"
    if t.endswith("Trigger"):
        return "trigger"
    return ROLE_BY_TYPE.get(t, "other")


def type_label(node):
    t = short_type(node["type"])
    if t in LABEL_BY_TYPE:
        return LABEL_BY_TYPE[t]
    words = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", t)
    return words[:1].upper() + words[1:]


def detail_of(node):
    """One short fact from the parameters, for the chip's second line."""
    p = node.get("parameters", {})
    t = short_type(node["type"])
    if t == "webhook":
        return f"{p.get('httpMethod', 'POST')} /{p.get('path', '')}"
    if t == "httpRequest":
        url = str(p.get("url", ""))
        url = re.sub(r"^https?://[^/]+", "", url)
        return f"{p.get('method', 'GET')} {url}"[:40]
    if t == "executeWorkflow":
        wid = p.get("workflowId", {})
        if isinstance(wid, dict):
            return (wid.get("__workflowName") or wid.get("cachedResultName") or "")[:40]
    if t == "wait":
        if p.get("resume") == "webhook":
            return "resume on webhook"
        amount = str(p.get("amount", ""))
        return "computed wait" if "{{" in amount else f"wait {amount} {p.get('unit', '')}".strip()
    if t == "scheduleTrigger":
        try:
            iv = p["rule"]["interval"][0]
            return "every " + " ".join(str(v) for v in iv.values())
        except Exception:
            return "schedule"
    if t.startswith("lmChat"):
        m = p.get("model")
        if isinstance(m, dict):
            m = m.get("value")
        return str(m or "")[:40]
    if t == "postgres":
        return {"executeQuery": "query"}.get(p.get("operation", "query"), p.get("operation", "query"))
    if t == "emailSend":
        subject = str(p.get("subject", "")).lstrip("=")
        return "" if "{{" in subject else subject[:40]
    return ""


# ---- model -----------------------------------------------------------------

def sticky_bounds(s):
    x, y = s["position"]
    w = s["parameters"].get("width", 240)
    h = s["parameters"].get("height", 160)
    return x, y, w, h


def parse_sticky(s):
    content = s["parameters"].get("content", "")
    lines = content.split("\n")
    title = lines[0].lstrip("#").strip() if lines else ""
    body = " ".join(l.strip() for l in lines[1:] if l.strip())
    return title, body


def build_board(wf, zones_dir=None):
    nodes = [n for n in wf["nodes"] if n["type"] != "n8n-nodes-base.stickyNote"]
    stickies = [n for n in wf["nodes"] if n["type"] == "n8n-nodes-base.stickyNote"]
    by_name = {n["name"]: n for n in nodes}

    # the board sticky contains other stickies; it becomes the intro text
    zones, intro = [], ""
    for s in stickies:
        x, y, w, h = sticky_bounds(s)
        contains = sum(1 for o in stickies if o is not s and x <= o["position"][0] and o["position"][0] < x + w
                       and y <= o["position"][1] and o["position"][1] < y + h)
        title, body = parse_sticky(s)
        if contains >= 2 or (len(stickies) > 1 and not any(x <= n["position"][0] < x + w and y <= n["position"][1] < y + h for n in nodes)):
            intro = body
            continue
        zones.append({"title": title, "body": body, "x": x, "y": y, "w": w, "h": h})
    zones.sort(key=lambda z: (z["y"], z["x"]))

    def zone_of(n):
        x, y = n["position"]
        for i, z in enumerate(zones):
            if z["x"] <= x < z["x"] + z["w"] and z["y"] <= y < z["y"] + z["h"]:
                return i
        return None

    # edges
    edges = []
    for src, outs in wf.get("connections", {}).items():
        if src not in by_name:
            continue
        for kind, lists in outs.items():
            for i, lst in enumerate(lists or []):
                for c in lst or []:
                    if c["node"] not in by_name:
                        continue
                    is_err = kind == "main" and i == 1 and by_name[src].get("onError") == "continueErrorOutput"
                    edges.append({"from": src, "to": c["node"], "kind": "error" if is_err else ("ai" if kind != "main" else "main"),
                                  "index": i, "out_count": len(lists)})

    # failure sink: the node most error edges land on
    sink_count = {}
    for e in edges:
        if e["kind"] == "error":
            sink_count[e["to"]] = sink_count.get(e["to"], 0) + 1
    sink = max(sink_count, key=sink_count.get) if sink_count and max(sink_count.values()) >= 3 else None

    # an error output wired to the same node as the main output reads as "continues on error"
    main_pairs = {(e["from"], e["to"]) for e in edges if e["kind"] == "main"}
    edges = [e for e in edges if not (e["kind"] == "error" and (e["from"], e["to"]) in main_pairs)]

    out = []
    for n in nodes:
        p = n.get("parameters", {})
        labels = {}
        t = short_type(n["type"])
        if t == "if":
            labels = {0: "yes", 1: "no"}
        elif t == "switch":
            for i, r in enumerate((p.get("rules", {}) or {}).get("values", []) or []):
                labels[i] = r.get("outputKey", str(i)) if r.get("renameOutput") else str(i)
            if "fallbackOutput" in (p.get("options") or {}):
                labels[len(labels)] = "else"
        out.append({
            "name": n["name"], "type": type_label(n), "role": role_of(n), "detail": detail_of(n),
            "x": n["position"][0], "y": n["position"][1], "zone": zone_of(n),
            "err_to_sink": any(e["from"] == n["name"] and e["kind"] == "error" and e["to"] == sink for e in edges),
            "labels": labels, "sub": n.get("credentials", {}) and list(n["credentials"].values())[0].get("name", ""),
        })

    return {
        "name": wf["name"], "intro": intro, "zones": zones, "nodes": out,
        "edges": [e for e in edges if not (e["kind"] == "error" and e["to"] == sink)],
        "sink": sink, "node_count": len(nodes),
    }


# ---- layout ----------------------------------------------------------------

def layout_board(b):
    """Canvas coordinates to frame coordinates, chips, zone panels, edge paths."""
    zs, ns = b["zones"], b["nodes"]
    if zs:
        minx = min(z["x"] for z in zs); miny = min(z["y"] for z in zs)
        maxx = max(z["x"] + z["w"] for z in zs); maxy = max(z["y"] + z["h"] for z in zs)
    else:
        minx = min(n["x"] for n in ns); miny = min(n["y"] for n in ns)
        maxx = max(n["x"] for n in ns) + NODE_SIZE; maxy = max(n["y"] for n in ns) + NODE_SIZE
    ox, oy = MARGIN - minx, HEADER_H - miny
    w = (maxx - minx) + 2 * MARGIN
    h = HEADER_H + (maxy - miny) + LEGEND_H + MARGIN

    for z in zs:
        z["x"] += ox; z["y"] += oy
    chips = {}
    for n in ns:
        cx = n["x"] + ox + NODE_SIZE / 2
        cy = n["y"] + oy + NODE_SIZE / 2
        n["cx"], n["cy"] = cx, cy
        n["x"], n["y"], n["w"], n["h"] = cx - CHIP_W / 2, cy - CHIP_H / 2, CHIP_W, CHIP_H
        chips[n["name"]] = n

    lane = {}
    for e in b["edges"]:
        s, t = chips[e["from"]], chips[e["to"]]
        if e["kind"] == "ai":
            # sub-node below its parent: vertical up into the parent's bottom edge
            x1, y1 = s["cx"], s["y"]
            x2, y2 = t["cx"], t["y"] + t["h"]
            if abs(x1 - x2) < 4:
                e["path"] = [[x1, y1], [x2, y2]]
            else:
                ym = (y1 + y2) / 2
                e["path"] = [[x1, y1], [x1, ym], [x2, ym], [x2, y2]]
            continue
        n_out = e["out_count"]
        y1 = s["cy"] + (e["index"] - (n_out - 1) / 2) * 10 if n_out > 1 else s["cy"]
        x1 = s["x"] + s["w"]
        x2, y2 = t["x"], t["cy"]
        same_row = abs(s["cy"] - t["cy"]) < CHIP_H
        if x2 >= x1 + 24:
            xm = x1 + (x2 - x1) / 2
            e["path"] = [[x1, y1], [x2, y2]] if same_row else [[x1, y1], [xm, y1], [xm, y2], [x2, y2]]
        elif t["cy"] < s["cy"] - CHIP_H and 0 <= (x1 + 8) - (t["x"] + t["w"]) <= 40:
            # target is above and to the left: short lane up, enter the target from its right edge
            xr = t["x"] + t["w"]
            e["path"] = [[x1, y1], [x1 + 16, y1], [x1 + 16, y2], [xr, y2]]
            e["end"] = "right"
        else:
            # wrap to a lower row or loop back: drop into the gutter between the rows
            zs_s, zs_t = s.get("zone"), t.get("zone")
            if zs_s is not None and zs_t is not None and zs_s != zs_t and zs[zs_t]["y"] > zs[zs_s]["y"]:
                ym = (zs[zs_s]["y"] + zs[zs_s]["h"] + zs[zs_t]["y"]) / 2
            elif t["cy"] > s["cy"] + CHIP_H:
                ym = (s["y"] + s["h"] + t["y"]) / 2
            else:
                k = lane.get((s["zone"]), 0); lane[s["zone"]] = k + 1
                ym = max(s["y"] + s["h"], t["y"] + t["h"]) + 22 + k * 10
            e["path"] = [[x1, y1], [x1 + 16, y1], [x1 + 16, ym], [x2 - 16, ym], [x2 - 16, y2], [x2, y2]]
        if e["index"] in s["labels"]:
            # label sits at the target end, right-aligned to the entry point (distinct targets, no pile-up)
            e["label"] = s["labels"][e["index"]]
            end = e["path"][-1]
            e["label_at"] = [end[0] - 6, end[1] - 16]
    b.update({"w": w, "h": h})
    return b


# ---- figma scripts ---------------------------------------------------------

JS_COMMON = r"""
const TH = D.theme;
function rgb(h){h=h.replace('#','');return{r:parseInt(h.slice(0,2),16)/255,g:parseInt(h.slice(2,4),16)/255,b:parseInt(h.slice(4,6),16)/255};}
function fl(h,o){return[{type:"SOLID",color:rgb(h),opacity:o==null?1:o}];}
const F={b:{family:"Inter",style:"Bold"},sb:{family:"Inter",style:"Semi Bold"},m:{family:"Inter",style:"Medium"},r:{family:"Inter",style:"Regular"}};
for (const f of Object.values(F)) await figma.loadFontAsync(f);
function R(p,x,y,w,h,hex,name,rad,o){const r=figma.createRectangle();p.appendChild(r);r.resize(Math.max(w,0.01),Math.max(h,0.01));r.x=x;r.y=y;r.fills=fl(hex,o);if(rad)r.cornerRadius=rad;r.name=name||"rect";return r;}
function T(p,x,y,chars,font,size,hex,opts){opts=opts||{};const t=figma.createText();p.appendChild(t);t.fontName=font;t.fontSize=size;t.lineHeight={value:opts.lh||130,unit:"PERCENT"};t.characters=chars||" ";t.fills=fl(hex,opts.o);if(opts.w){t.textAutoResize="HEIGHT";t.resize(opts.w,t.height);}t.x=x;t.y=y;t.name=(chars||"text").replace(/\n/g," ").slice(0,40);return t;}
function seg(p,x1,y1,x2,y2,hex,th,name){const dx=x2-x1,dy=y2-y1,L=Math.hypot(dx,dy);if(L<0.5)return null;const c=dx/L,s=dy/L;const r=figma.createRectangle();p.appendChild(r);r.resize(L,th);r.fills=fl(hex);r.relativeTransform=[[c,-s,x1+s*th/2],[s,c,y1-c*th/2]];r.name=name||"edge";return r;}
function dot(p,cx,cy,rad,hex,name){const e=figma.createEllipse();p.appendChild(e);e.resize(2*rad,2*rad);e.x=cx-rad;e.y=cy-rad;e.fills=fl(hex);e.name=name||"dot";return e;}
function getPage(name){let pg=figma.root.children.find(p=>p.name===name);if(!pg){const first=figma.root.children[0];if(first&&first.children.length===0&&/^Page \d+$/.test(first.name)){first.name=name;pg=first;}else{pg=figma.createPage();pg.name=name;}}return pg;}
function clearX(page){let ox=0;for(const c of page.children)ox=Math.max(ox,c.x+c.width+240);return ox;}
function fit(t,maxW){if(t.width<=maxW)return t;let s=t.characters;while(s.length>4&&t.width>maxW){s=s.slice(0,-2);t.characters=s+"…";}return t;}
function TR(p,rx,y,chars,font,size,hex,opts){const t=T(p,0,y,chars,font,size,hex,opts);t.x=rx-t.width;return t;}
function legend(fr,x,y,w,items,keys,source){let lx=0,ly=0;const row=24;for(const [role,label] of items){const t=T(fr,0,0,label,F.r,12,TH.text,{o:TH.muted});const iw=t.width+12+36;if(lx+iw>w&&lx>0){lx=0;ly+=row;}R(fr,x+lx,y+ly+6,5,16,TH.roles[role],"swatch "+role,2);t.x=x+lx+12;t.y=y+ly+4;lx+=iw;}
  ly+=row+16;lx=0;for(const k of keys){seg(fr,x+lx,y+ly+8,x+lx+36,y+ly+8,k.hex,k.th,"key "+k.label);let kx=lx+46;if(k.dot){dot(fr,x+lx+56,y+ly+8,3.5,k.hex,"key dot");kx=lx+68;}const t=T(fr,x+kx,y+ly,k.label,F.r,12,TH.text,{o:TH.muted});lx=kx+t.width+36;}
  ly+=row+8;T(fr,x,y+ly,source,F.r,11,TH.text,{o:TH.faint,w:w});}
"""

JS_BOARDS = JS_COMMON + r"""
const page=getPage(D.page);await figma.setCurrentPageAsync(page);
if(D.replace){for(const c of [...page.children])c.remove();}
let ox=clearX(page);const created=[];let oy=0;
for (const B of D.boards){
  const fr=figma.createFrame();fr.name=B.name;fr.x=ox;fr.y=oy;fr.resize(B.w,B.h);fr.fills=fl(TH.bg);fr.clipsContent=true;page.appendChild(fr);
  const g=figma.createFrame();g.name="Header";g.x=0;g.y=0;g.resize(B.w,D.headerH);g.fills=[];fr.appendChild(g);
  T(g,D.margin,D.margin-8,B.name,F.b,32,TH.text);
  T(g,D.margin,D.margin+36,B.subtitle,F.r,14,TH.text,{o:TH.muted,w:B.w-2*D.margin});
  const zl=figma.createFrame();zl.name="Zones";zl.x=0;zl.y=0;zl.resize(B.w,B.h);zl.fills=[];zl.clipsContent=false;fr.appendChild(zl);
  for (const z of B.zones){R(zl,z.x,z.y,z.w,z.h,TH.panel,"zone: "+z.title,16);T(zl,z.x+20,z.y+14,z.title,F.sb,18,TH.text);T(zl,z.x+20,z.y+42,z.body,F.r,12,TH.text,{o:TH.muted,w:z.w-40,lh:140});}
  const el=figma.createFrame();el.name="Edges";el.x=0;el.y=0;el.resize(B.w,B.h);el.fills=[];el.clipsContent=false;fr.appendChild(el);
  for (const e of B.edges){const hex=e.kind==="error"?TH.err:(e.kind==="ai"?TH.ai:TH.edge);const th=e.kind==="main"?1.5:1.25;const P=e.path;
    for(let i=0;i<P.length-1;i++)seg(el,P[i][0],P[i][1],P[i+1][0],P[i+1][1],hex,th,e.from+" > "+e.to);
    const last=P[P.length-1];dot(el,last[0],last[1],3,hex,"end");
    if(e.label)TR(el,e.label_at[0],e.label_at[1],e.label,F.r,10,TH.text,{o:TH.faint});}
  const nl=figma.createFrame();nl.name="Nodes";nl.x=0;nl.y=0;nl.resize(B.w,B.h);nl.fills=[];nl.clipsContent=false;fr.appendChild(nl);
  for (const n of B.nodes){const role=TH.roles[n.role]||TH.roles.other;
    R(nl,n.x,n.y,n.w,n.h,TH.chip,"node: "+n.name,10);R(nl,n.x,n.y+8,5,n.h-16,role,"role: "+n.role,2);
    const nm=T(nl,n.x+16,n.y+7,n.name,F.m,12,TH.text);if(nm.width>n.w-26){nm.fontSize=10.5;}fit(nm,n.w-26);
    fit(T(nl,n.x+16,n.y+26,n.type+(n.detail?" · "+n.detail:""),F.r,10,TH.text,{o:TH.faint}),n.w-26);
    if(n.err_to_sink)dot(nl,n.x+n.w-9,n.y+9,3.5,TH.err,"error output to sink");
    if(B.sink===n.name)T(nl,n.x,n.y+n.h+6,"receives every marked error output",F.r,10,TH.err,{w:n.w+40});}
  const lg=figma.createFrame();lg.name="Legend";lg.x=0;lg.y=B.h-D.legendH-D.margin+20;lg.resize(B.w,D.legendH);lg.fills=[];lg.clipsContent=false;fr.appendChild(lg);
  legend(lg,D.margin,0,B.w-2*D.margin,D.legend,[{hex:TH.edge,th:1.5,label:"data flow"},{hex:TH.err,th:1.25,dot:true,label:"error output (dot: routed to the failure node)"},{hex:TH.ai,th:1.25,label:"model or tool attached to an AI node"}],B.source);
  created.push(fr.id);oy+=B.h+120;
}
return {createdNodeIds:created};
"""

JS_ARCH = JS_COMMON + r"""
const page=getPage(D.page);await figma.setCurrentPageAsync(page);
if(D.replace){for(const c of [...page.children])c.remove();}
const A=D.arch;const M=D.margin;const colW=A.colW||300,gap=A.gap||72,cardGap=16;
const fr=figma.createFrame();fr.name=A.title;fr.x=clearX(page);fr.y=0;fr.resize(100,100);fr.fills=fl(TH.bg);fr.clipsContent=true;page.appendChild(fr);
T(fr,M,M-8,A.title,F.b,32,TH.text);
const sub=T(fr,M,M+36,A.subtitle,F.r,14,TH.text,{o:TH.muted,w:A.columns.length*(colW+gap)-gap});
const top=sub.y+sub.height+48;const pos={};let maxBottom=0;
A.columns.forEach((col,ci)=>{const x=M+ci*(colW+gap);T(fr,x,top-30,col.title.toUpperCase(),F.sb,11,TH.text,{o:TH.faint});
  let y=top;for(const c of col.cards){const role=TH.roles[c.role]||TH.roles.other;
    const title=T(fr,x+18,y+14,c.title,F.sb,14,TH.text,{w:colW-36});let cy=y+14+title.height+6;
    const rows=[];for(const [k,v] of Object.entries(c.rows||{})){const kt=T(fr,x+18,cy,k,F.m,10,TH.text,{o:TH.faint});const vt=T(fr,x+18+52,cy-1,v,F.r,11,TH.text,{o:TH.muted,w:colW-36-52,lh:135});cy+=Math.max(kt.height,vt.height)+4;rows.push(kt,vt);}
    const h=cy-y+12;const bg=R(fr,x,y,colW,h,TH.panel,"card: "+c.id,12);const bar=R(fr,x,y+10,5,h-20,role,"role",2);
    fr.insertChild(fr.children.indexOf(title),bg);fr.insertChild(fr.children.indexOf(title),bar);
    pos[c.id]={x,y,w:colW,h,cx:x+colW/2,cy:y+h/2};y+=h+cardGap;}
  maxBottom=Math.max(maxBottom,y);});
const lane={};
for(const e of A.edges){const s=pos[e.from],t=pos[e.to];if(!s||!t)continue;const hex=e.kind==="error"?TH.err:(e.kind==="ai"?TH.ai:TH.edge);
  let P;if(t.x>s.x+s.w){const x1=s.x+s.w,x2=t.x;const y1=s.cy+(e.dy||0),y2=t.cy+(e.dy2||0);const xm=x1+(x2-x1)/2;P=Math.abs(y1-y2)<2?[[x1,y1],[x2,y2]]:[[x1,y1],[xm,y1],[xm,y2],[x2,y2]];}
  else if(Math.abs(t.x-s.x)<2){const below=t.y>s.y;const y1=below?s.y+s.h:s.y,y2=below?t.y:t.y+t.h;P=[[s.cx+(e.dx||0),y1],[t.cx+(e.dx||0),y2]];}
  else{const x1=s.x,x2=t.x+t.w;const y1=s.cy+(e.dy||0),y2=t.cy+(e.dy2||0);const xm=x2+(x1-x2)/2;P=[[x1,y1],[xm,y1],[xm,y2],[x2,y2]];}
  for(let i=0;i<P.length-1;i++)seg(fr,P[i][0],P[i][1],P[i+1][0],P[i+1][1],hex,1.5,e.from+" > "+e.to);
  const last=P[P.length-1];dot(fr,last[0],last[1],3,hex,"end");
  if(e.label){const a=P[0];if(P.length>2&&Math.abs(P[1][1]-a[1])<1){T(fr,a[0]+8,a[1]-14,e.label,F.r,10,TH.text,{o:TH.faint});}else{T(fr,a[0]+6,a[1]+4,e.label,F.r,10,TH.text,{o:TH.faint});}}}
let y=maxBottom+24;const W=M*2+A.columns.length*(colW+gap)-gap;
for(const band of A.bands||[]){const role=TH.roles[band.role]||TH.roles.other;const title=T(fr,M+18,y+14,band.title,F.sb,14,TH.text);let cy=y+14+title.height+6;const made=[title];
  for(const [k,v] of Object.entries(band.rows||{})){const kt=T(fr,M+18,cy,k,F.m,10,TH.text,{o:TH.faint});const vt=T(fr,M+18+70,cy-1,v,F.r,11,TH.text,{o:TH.muted,w:W-2*M-36-70,lh:135});cy+=Math.max(kt.height,vt.height)+4;}
  const h=cy-y+12;const bg=R(fr,M,y,W-2*M,h,TH.panel,"band: "+band.title,12);const bar=R(fr,M,y+10,5,h-20,role,"role",2);fr.insertChild(fr.children.indexOf(title),bg);fr.insertChild(fr.children.indexOf(title),bar);y+=h+cardGap;}
y+=8;
for(const line of A.footer||[]){const t=T(fr,M,y,line,F.r,12,TH.text,{o:TH.muted,w:W-2*M});y+=t.height+6;}
y+=18;let lx=M;for(const [role,label] of D.legend){if(!(A.legendRoles||[]).includes(role))continue;R(fr,lx,y+2,5,16,TH.roles[role],"swatch "+role,2);const t=T(fr,lx+12,y,label,F.r,12,TH.text,{o:TH.muted});lx+=t.width+36;}
y+=40;fr.resize(W,y+M);
return {createdNodeIds:[fr.id],cards:Object.keys(pos).length};
"""


def cmd_model(args):
    boards = []
    for f in args.files:
        with open(f) as fh:
            wf = json.load(fh)
        b = build_board(wf)
        b["file"] = os.path.basename(f)
        boards.append(layout_board(b))
    with open(args.out, "w") as fh:
        json.dump({"boards": boards}, fh, indent=1)
    for b in boards:
        print(f"{b['file']}: {b['node_count']} nodes, {len(b['zones'])} zones, {len(b['edges'])} edges drawn, sink={b['sink']}, frame {b['w']:.0f}x{b['h']:.0f}")


def cmd_figma(args):
    with open(args.model) as fh:
        model = json.load(fh)
    with open(args.pages) as fh:
        pages = json.load(fh)
    theme = THEMES[args.theme]
    by_file = {b["file"]: b for b in model["boards"]}
    os.makedirs(args.out_dir, exist_ok=True)
    common = {"theme": theme, "legend": ROLE_LEGEND, "margin": MARGIN, "headerH": HEADER_H, "legendH": LEGEND_H,
              "replace": bool(args.replace)}
    for page, files in pages.items():
        boards = []
        for f in files:
            b = dict(by_file[f])
            zones = len(b["zones"])
            stages = f"{zones} stage" + ("s" if zones != 1 else "")
            b["subtitle"] = (b["intro"] or "")[:420] if b["intro"] else f"{b['node_count']} nodes in {stages}."
            b["source"] = f"Generated from workflows/dev/{f} ({b['node_count']} nodes, {stages}). The n8n canvas is the view; the JSON in git is the source."
            boards.append(b)
        data = dict(common, page=page, boards=boards)
        js = "const D=" + json.dumps(data, separators=(",", ":")) + ";\n" + JS_BOARDS
        path = os.path.join(args.out_dir, re.sub(r"[^a-z0-9]+", "-", page.lower()).strip("-") + ".js")
        with open(path, "w") as fh:
            fh.write(js)
        print(f"{path}: {len(js)} chars, {len(boards)} board(s)")
    if args.arch:
        with open(args.arch) as fh:
            arch = json.load(fh)
        data = dict(common, page=arch.get("page", "Architecture"), arch=arch)
        js = "const D=" + json.dumps(data, separators=(",", ":")) + ";\n" + JS_ARCH
        path = os.path.join(args.out_dir, "architecture.js")
        with open(path, "w") as fh:
            fh.write(js)
        print(f"{path}: {len(js)} chars")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("model"); m.add_argument("files", nargs="+"); m.add_argument("-o", "--out", required=True)
    g = sub.add_parser("figma"); g.add_argument("model"); g.add_argument("--pages", required=True); g.add_argument("--arch")
    g.add_argument("--out-dir", required=True); g.add_argument("--theme", default="dark", choices=list(THEMES))
    g.add_argument("--replace", action="store_true", help="scripts clear their page before drawing")
    args = ap.parse_args()
    if args.cmd == "model":
        cmd_model(args)
    else:
        cmd_figma(args)


if __name__ == "__main__":
    sys.exit(main())
