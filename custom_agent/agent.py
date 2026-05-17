#!/usr/bin/env python3
"""
Report Agent — The Social Space Consignment Reporting Automation
Echelon Singapore 2026 — Track 2: Save-a-Hire

Run: python agent.py
"""

from __future__ import annotations

import csv
import time
import os
from datetime import datetime, timezone
from glob import glob
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv()

from modules.ingest import (
    get_categories,
    get_partner_column,
    normalize_columns,
    standardize_locations,
)
from modules.combine import merge_files
from modules.normalize import Normalizer
from modules.review import AIReviewer
from modules.reports import generate_all, ensure_output_dir


def _yn(prompt: str, default: bool = True) -> bool:
    suffix = " [Y/n]: " if default else " [y/N]: "
    resp = input(prompt + suffix).strip().lower()
    if not resp:
        return default
    return resp.startswith("y")


def _find_columns(master: dict[str, Any], *candidates: str) -> str | None:
    for c in candidates:
        if c in master:
            return c
    return None


def log(message: str):
    timestamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
    line = f"[{timestamp}] {message}"
    print(f"  {line}")
    with open("run.log", "a") as f:
        f.write(line + "\n")


def print_banner():
    print()
    print("=" * 60)
    print("  Report Agent — The Social Space")
    print("  Consignment Reporting Automation")
    print("  Echelon SG 2026")
    print("=" * 60)
    print()


def step_scan() -> list[str]:
    print("─ Step 1: Scan input/ ─")
    files = sorted(glob("input/*")) + sorted(glob("input/**/*"))

    data_files = [
        f for f in files
        if Path(f).suffix.lower() in (".csv", ".ods", ".xlsx")
        and not f.endswith(".gitkeep")
    ]

    if not data_files:
        print("  No data files found in input/")
        print("  Place CSV or ODS files in the input/ folder and try again.")
        return []

    print(f"  Found {len(data_files)} file(s):")
    for f in data_files:
        size = Path(f).stat().st_size
        size_str = f"{size:,} bytes" if size < 1_000_000 else f"{size/1_000_000:.1f} MB"
        print(f"    • {Path(f).name}  ({size_str})")

    if not _yn("\n  Process these files?"):
        return []

    return data_files


def step_combine(files: list[str]) -> tuple[dict, Normalizer]:
    print("\n─ Step 2: Combine & Normalize ─")

    log(f"Loading corrections from corrections/reference.csv")
    normalizer = Normalizer()
    loaded = normalizer.load("corrections/reference.csv")
    if loaded:
        log(f"Loaded {loaded} correction rules")

    log(f"Merging {len(files)} file(s)...")
    start = time.time()
    master = merge_files(files)

    if master.empty:
        print("  Error: No data after merging.")
        return {}, normalizer

    master = standardize_locations(master)

    log(f"Merged: {len(master)} rows × {len(master.columns)} columns")

    master = normalizer.apply(master)
    corr_summary = normalizer.summary()
    if corr_summary["total_corrections"]:
        log(f"Applied {corr_summary['total_corrections']} corrections across {corr_summary['rows_affected']} cells")

    partner_col = get_partner_column(master)
    categories = get_categories(master) if partner_col else []

    elapsed = time.time() - start
    log(f"Combine complete in {elapsed:.1f}s")

    print(f"  Master table: {len(master)} rows × {len(master.columns)} cols")
    print(f"  Partners detected: {len(categories)}")
    if partner_col:
        print(f"  Partner column: '{partner_col}'")
    if corr_summary["total_corrections"]:
        print(f"  Corrections applied: {corr_summary['total_corrections']}")

    return master, normalizer


def step_review(master: dict) -> dict[str, Any]:
    print("\n─ Step 3: Review ─")

    reviewer = AIReviewer()
    sample_size = min(len(master), 50)

    has_api = bool(os.getenv("QWEN_API_KEY"))
    if not has_api:
        print("  ⚠ No QWEN_API_KEY found. Using rules-only review.")
    else:
        print(f"  Reviewing {sample_size} rows using rules engine...")

    rows = master.head(sample_size).to_dict(orient="records")
    log(f"Reviewing {len(rows)} rows (rules only)...")
    start = time.time()

    findings = reviewer.review_batch(rows, use_ai=False)
    elapsed = time.time() - start
    log(f"Review complete in {elapsed:.1f}s — {findings['auto_corrected']} fixes, {findings['issues_found']} flags")

    print(f"  Rows checked: {len(rows)}")
    print(f"  Auto-fixable: {findings['auto_corrected']}")
    print(f"  Flagged: {findings['issues_found']}")

    if findings["flags"] and _yn("\n  Review flagged items?"):
        print()
        for flag in findings["flags"][:20]:
            print(f"  ⚠  Row {flag.get('row_index', '?')}: "
                  f"{flag.get('column', '')} = {flag.get('issue', '').split(':')[0]}")
        if len(findings["flags"]) > 20:
            print(f"  ... and {len(findings['flags']) - 20} more")

    if findings["auto_fixes"] and _yn("\n  Apply auto-fixes?"):
        for fix in findings["auto_fixes"][:30]:
            log(f"Auto-fix: row {fix['row_index']} {fix['column']} → {fix['new_value']}")
            if fix["row_index"] < len(rows):
                col = fix["column"]
                corrected_col = f"corrected_{col}"
                if corrected_col not in master.columns:
                    master[corrected_col] = master[col].astype(str) if col in master.columns else ""
                if col in master.columns:
                    master.loc[master.index[fix["row_index"]], corrected_col] = fix["new_value"]
        print(f"  ✓ Applied {min(len(findings['auto_fixes']), 30)} auto-fixes")
        log(f"Applied {min(len(findings['auto_fixes']), 30)} auto-fixes to master table")

    return findings


def step_reports(master: dict, normalizer: Normalizer):
    print("\n─ Step 4: Generate Reports ─")

    partner_col = get_partner_column(master)
    if not partner_col:
        print("  Error: No partner/category column found. Cannot generate reports.")
        return

    categories = get_categories(master)
    if not categories:
        print("  No partners found in data.")
        return

    location_col = _find_columns(master.columns, "location", "Sales outlets")
    sku_col = _find_columns(master.columns, "sku", "Item Number")
    desc_col = _find_columns(master.columns, "item_description", "Item description")
    qty_col = _find_columns(master.columns, "quantity", "Sales volume", "Current Inventory")
    rev_col = _find_columns(master.columns, "revenue", "Revenue")
    price_col = _find_columns(master.columns, "unit_price", "Total selling price")

    print(f"  Partners to generate: {len(categories)}")
    if not _yn(f"\n  Generate reports for all {len(categories)} partners?"):
        print("  Showing first 5 partners:")
        for i, cat in enumerate(categories[:5]):
            print(f"    {i+1}. {cat}")
        if not _yn("\n  Generate for these 5?"):
            return
        categories = categories[:5]

    ensure_output_dir()
    log(f"Generating reports for {len(categories)} partners...")
    start = time.time()

    results = generate_all(
        master, partner_col,
        location_col, sku_col, desc_col, qty_col, rev_col, price_col,
    )

    elapsed = time.time() - start
    log(f"Generated {len(results)} reports in {elapsed:.1f}s")

    print(f"\n  Reports generated: {len(results)}")
    for r in results[:10]:
        print(f"    ✓ {r['partner']:40s} {r['rows']:4d} rows  ${r['total_revenue']:,.2f}")
    if len(results) > 10:
        print(f"    ... and {len(results) - 10} more")

    if normalizer.log:
        total = normalizer.summary()["rows_affected"]
        print(f"\n  Corrections applied: {normalizer.summary()['total_corrections']} rules, {total} cells affected")
    log(f"All reports saved to output/")


def main():
    print_banner()

    files = step_scan()
    if not files:
        print("\nNo files to process. Place data in input/ and try again.")
        return

    master, normalizer = step_combine(files)
    if master.empty:
        print("\nNo data after combine. Check input files.")
        return

    _ = step_review(master)
    step_reports(master, normalizer)

    print()
    print("=" * 60)
    print("  Done. Reports saved to output/")
    print(f"  Run log: run.log")
    print("=" * 60)
    print()


if __name__ == "__main__":
    main()
