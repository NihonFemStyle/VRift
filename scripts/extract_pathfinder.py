#!/usr/bin/env python3
"""Extract Pathfinder actions/conditions/daemons from a mod's C# source.

Usage: python scripts/extract_pathfinder.py <mod source dir> [more dirs...]

Prints JSON: { "<TagName>": { "kind": "action|condition|daemon",
  "class": "...", "delayable": bool, "fields": [ {name,type,default,content} ] } }

This is a helper for keeping src/schema/mods/*.schema.json in sync with the
mods. The output is a starting point: descriptions are written by hand.
"""
import json
import re
import sys
from pathlib import Path

CLASS_RE = re.compile(
    r"(?P<attrs>(?:\[[^\]]*\]\s*)*)"
    r"(?:public\s+|internal\s+|private\s+)?(?:sealed\s+|abstract\s+|static\s+)*class\s+(?P<name>\w+)"
    r"\s*(?::\s*(?P<base>[\w.<>, ]+))?\s*\{"
)
FIELD_RE = re.compile(
    r"\[XMLStorage(?P<args>\([^)]*\))?\]\s*public\s+(?P<type>[\w.<>\[\]?]+)\s+(?P<name>\w+)\s*(?:=\s*(?P<default>[^;]+))?;"
)
REG_RE = re.compile(
    r"(?P<mgr>ActionManager|ConditionManager)\.Register(?:Action|Condition)<(?P<cls>[\w.]+)>\(\s*\"(?P<tag>[^\"]+)\"\s*\)"
)
DAEMON_REG_RE = re.compile(r"DaemonManager\.RegisterDaemon<(?P<cls>[\w.]+)>\(\)")
ATTR_RE = re.compile(r"\[(?:Pathfinder\.Meta\.Load\.)?(?P<kind>Action|Condition|Daemon)(?:\(\s*\"(?P<tag>[^\"]*)\"\s*\))?\]")


def block_end(text: str, start: int) -> int:
    depth = 0
    for i in range(start, len(text)):
        c = text[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i
    return len(text)


def scan(dirs):
    classes = {}
    regs = {}
    for d in dirs:
        for f in Path(d).rglob("*.cs"):
            text = f.read_text(encoding="utf-8-sig", errors="replace")
            for m in REG_RE.finditer(text):
                kind = "action" if m["mgr"] == "ActionManager" else "condition"
                regs[m["tag"]] = (kind, m["cls"].split(".")[-1])
            for m in DAEMON_REG_RE.finditer(text):
                cls = m["cls"].split(".")[-1]
                regs[cls] = ("daemon", cls)
            for m in CLASS_RE.finditer(text):
                body_start = m.end() - 1
                end = block_end(text, body_start)
                body = text[body_start:end]
                # Only direct fields: strip nested classes.
                nested = [(n.start(), block_end(body, n.end() - 1)) for n in CLASS_RE.finditer(body)]
                flat = body
                for s, e in reversed(nested):
                    flat = flat[:s] + flat[e + 1:]
                fields = []
                for fm in FIELD_RE.finditer(flat):
                    default = (fm["default"] or "").strip() or None
                    fields.append({
                        "name": fm["name"],
                        "type": fm["type"],
                        "default": default,
                        "content": bool(fm["args"] and "IsContent" in fm["args"]),
                    })
                classes[m["name"]] = {
                    "base": (m["base"] or "").strip(),
                    "fields": fields,
                    "file": str(f),
                }
                for am in ATTR_RE.finditer(m["attrs"] or ""):
                    kind = am["kind"].lower()
                    tag = am["tag"] or m["name"]
                    regs[tag] = (kind, m["name"])
    return classes, regs


def resolve_fields(classes, cls, seen=None):
    seen = seen or set()
    if cls not in classes or cls in seen:
        return [], ""
    seen.add(cls)
    info = classes[cls]
    base = info["base"].split(",")[0].strip().split(".")[-1]
    inherited, root = resolve_fields(classes, base, seen)
    names = {f["name"] for f in info["fields"]}
    merged = [f for f in inherited if f["name"] not in names] + info["fields"]
    return merged, root or base


def main():
    classes, regs = scan(sys.argv[1:])
    out = {}
    for tag, (kind, cls) in sorted(regs.items()):
        fields, root = resolve_fields(classes, cls)
        out[tag] = {
            "kind": kind,
            "class": cls,
            "delayable": "Delayable" in (classes.get(cls, {}).get("base", "") + root),
            "fields": fields,
        }
    json.dump(out, sys.stdout, indent=1)


if __name__ == "__main__":
    main()
