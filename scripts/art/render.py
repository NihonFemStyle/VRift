#!/usr/bin/env python3
"""Render docs/banner.png and docs/social-preview.png from scripts/art/art.html.

    pip install playwright && python -m playwright install chromium
    python scripts/art/render.py
"""
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
DOCS = HERE.parent.parent / "docs"

JOBS = [
    # (mode, width, height, device scale, output)
    ("banner", 1280, 360, 2, DOCS / "banner.png"),
    ("social", 1280, 640, 1, DOCS / "social-preview.png"),
]

with sync_playwright() as p:
    browser = p.chromium.launch()
    for mode, w, h, scale, out in JOBS:
        page = browser.new_page(viewport={"width": w, "height": h}, device_scale_factor=scale)
        page.goto((HERE / "art.html").as_uri() + f"?mode={mode}")
        page.wait_for_selector("body[data-ready='1']")
        page.wait_for_timeout(300)
        page.screenshot(path=str(out))
        print(f"{out.relative_to(DOCS.parent)}  {w * scale}x{h * scale}  {out.stat().st_size // 1024} KB")
    browser.close()
