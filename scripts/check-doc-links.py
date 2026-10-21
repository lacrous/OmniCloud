#!/usr/bin/env python3
"""Check every relative markdown link and in-page anchor in the repository.

Run it from the repository root:

    python3 scripts/check-doc-links.py

Exits non-zero and prints every problem it finds. Files under node_modules are
ignored.
"""

from __future__ import annotations

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".next", "coverage"}

LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
HEADING = re.compile(r"^(#{1,6})\s+(.*)$")


def markdown_files() -> list[str]:
    found = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if name.endswith(".md"):
                found.append(os.path.join(dirpath, name))
    return sorted(found)


def slugify(heading: str) -> str:
    """GitHub's heading slug: lowercase, drop punctuation, spaces to dashes.

    Underscores survive, because GitHub keeps them.
    """
    heading = re.sub(r"`([^`]*)`", r"\1", heading)
    heading = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", heading)
    heading = heading.replace("*", "").replace("`", "")
    heading = heading.lower()
    heading = re.sub(r"[^\w\s-]", "", heading)
    heading = re.sub(r"\s", "-", heading.strip())
    return heading


def anchors(path: str) -> set[str]:
    out: set[str] = set()
    for line in open(path, encoding="utf-8", errors="replace"):
        m = HEADING.match(line)
        if m:
            out.add(slugify(m.group(2)))
    return out


def main() -> int:
    problems: list[str] = []
    files = markdown_files()
    for path in files:
        rel = os.path.relpath(path, ROOT)
        text = open(path, encoding="utf-8", errors="replace").read()
        for m in LINK.finditer(text):
            target = m.group(1).strip()
            if target.startswith(("http://", "https://", "mailto:", "#")):
                if target.startswith("#"):
                    anchor = target[1:]
                    if anchor and anchor not in anchors(path):
                        problems.append(f"{rel}: anchor '{target}' has no matching heading")
                continue
            target = target.split("#")[0]
            if not target:
                continue
            resolved = os.path.normpath(os.path.join(os.path.dirname(path), target))
            if not os.path.exists(resolved):
                problems.append(f"{rel}: link target does not exist: {target}")
                continue
            if "#" in m.group(1) and resolved.endswith(".md"):
                anchor = m.group(1).split("#", 1)[1]
                if anchor and anchor not in anchors(resolved):
                    problems.append(f"{rel}: anchor '{anchor}' not found in {target}")

    for problem in problems:
        print(problem)
    print(f"\nchecked {len(files)} markdown files, {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
