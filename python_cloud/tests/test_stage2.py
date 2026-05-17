from fastapi.testclient import TestClient

from src.main import app
from src.db import get_engine, Base

client = TestClient(app)


def setup_module():
    engine = get_engine()
    Base.metadata.create_all(engine)


def teardown_module():
    engine = get_engine()
    Base.metadata.drop_all(engine)


# --- Combine tests ---

def test_combine_single_file():
    resp = client.post("/pipeline/combine", json={
        "file_paths": ["data/examples/product mix report final.ods"],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_rows"] == 555
    assert data["category_count"] > 0
    assert len(data["preview"]) > 0


def test_combine_two_files():
    resp = client.post("/pipeline/combine", json={
        "file_paths": [
            "data/examples/product mix report final.ods",
            "data/examples/Optimatic Pte Ltd Sample Data.ods",
        ],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_rows"] > 555
    assert len(data["column_names"]) > 10


def test_combine_file_not_found():
    resp = client.post("/pipeline/combine", json={
        "file_paths": ["data/examples/nonexistent.ods"],
    })
    assert resp.status_code == 404


# --- Unit tests: combine.py ---

def test_merge_sheets():
    from src.combine import merge_sheets

    files = ["data/examples/product mix report final.ods"]
    df = merge_sheets(files)
    assert len(df) == 555


def test_get_unique_categories():
    from src.combine import merge_sheets, get_unique_categories

    df = merge_sheets(["data/examples/product mix report final.ods"])
    categories = get_unique_categories(df)
    assert len(categories) > 0
    assert "Riau Candle" in categories


def test_group_by_category():
    from src.combine import merge_sheets, group_by_category

    df = merge_sheets(["data/examples/product mix report final.ods"])
    groups = group_by_category(df)
    assert len(groups) > 1
    assert "Riau Candle" in groups


# --- Unit tests: reports.py ---

def test_generate_legacy_report():
    from src.combine import merge_sheets, group_by_category
    from src.reports import generate_legacy_report

    df = merge_sheets(["data/examples/product mix report final.ods"])
    groups = group_by_category(df)
    riau = groups.get("Riau Candle")
    if riau is not None:
        headers, rows = generate_legacy_report(riau, "Riau Candle")
        assert len(headers) > 0
        assert len(rows) > 0


def test_generate_recommended_report():
    from src.combine import merge_sheets, group_by_category
    from src.reports import generate_recommended_report

    df = merge_sheets(["data/examples/product mix report final.ods"])
    groups = group_by_category(df)
    riau = groups.get("Riau Candle")
    if riau is not None:
        headers, rows = generate_recommended_report(riau, "Riau Candle")
        assert len(headers) > 0
        assert len(rows) > 0
        assert rows[0][0] == "Riau Candle"


def test_get_partner_summary():
    from src.combine import merge_sheets, group_by_category
    from src.reports import get_partner_summary

    df = merge_sheets(["data/examples/product mix report final.ods"])
    groups = group_by_category(df)
    riau = groups.get("Riau Candle")
    if riau is not None:
        summary = get_partner_summary(riau, "Riau Candle")
        assert summary["partner"] == "Riau Candle"
        assert summary["total_rows"] > 0


# --- Unit tests: review.py ---

def test_classify_finding_empty():
    from src.review import reviewer
    action, new_val, issue = reviewer.classify_finding("item_category", "", {})
    assert action == "flag"


def test_classify_finding_negative_quantity():
    from src.review import reviewer
    action, new_val, issue = reviewer.classify_finding("Sales volume", "-5", {})
    assert action == "fix"
    assert new_val is not None and float(new_val) == 5.0


def test_classify_finding_ok():
    from src.review import reviewer
    action, new_val, issue = reviewer.classify_finding("location", "Kreta Ayer", {})
    assert action == "ok"


def test_classify_finding_unassigned_category():
    from src.review import reviewer
    for val in ("无", "nothing", "-"):
        action, _, issue = reviewer.classify_finding("item_category", val, {})
        assert action == "flag", f"Expected flag for '{val}'"
