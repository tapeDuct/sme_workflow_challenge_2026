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


# --- Ingestion tests ---

def test_ingest_product_mix():
    file_path = "data/examples/product mix report final.ods"
    resp = client.post(f"/ingest?file_path={file_path}&source=product_mix")
    assert resp.status_code == 200
    data = resp.json()
    assert data["rows"] == 555
    assert data["normalized"] is True
    assert "location" in data["column_names"] or "Sales outlets" in data["column_names"]
    assert len(data["partners"]) > 0
    assert len(data["preview"]) > 0


def test_ingest_file_not_found():
    resp = client.post("/ingest?file_path=data/examples/nonexistent.ods")
    assert resp.status_code == 404


def test_ingest_optimatic_ka():
    file_path = "data/examples/Optimatic Pte Ltd Sample Data.ods"
    resp = client.post(f"/ingest?file_path={file_path}&source=product_mix")
    assert resp.status_code == 200
    data = resp.json()
    assert data["rows"] > 0


def test_list_partners():
    file_path = "data/examples/product mix report final.ods"
    resp = client.get(f"/ingest/partners?file_path={file_path}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] > 0
    assert "Riau Candle" in data["partners"] or "Riau Candles" in data["partners"]


def test_partner_skus():
    file_path = "data/examples/product mix report final.ods"
    resp = client.get(f"/ingest/partner-skus?file_path={file_path}&partner=Riau Candle")
    assert resp.status_code == 200
    data = resp.json()
    assert data["partner"] == "Riau Candle"


def test_ingest_with_corrections():
    file_path = "data/examples/product mix report final.ods"
    resp = client.post(f"/ingest?file_path={file_path}&apply_corrections=true")
    assert resp.status_code == 200
    data = resp.json()
    assert "corrections_summary" in data


def test_load_corrections():
    resp = client.post("/ingest/corrections/load")
    assert resp.status_code == 200
    data = resp.json()
    assert data["corrections_loaded"] > 0


# --- Unit tests: ingestion functions ---

def test_ingestion_detect_source():
    from src.ingestion import detect_source
    import pandas as pd

    df = pd.DataFrame()
    assert detect_source("pos_export_may.csv", df) == "pos"
    assert detect_source("online_orders.csv", df) == "online"
    assert detect_source("corp_orders.csv", df) == "corporate"
    assert detect_source("product_mix.csv", df) == "product_mix"
    assert detect_source("unknown_file.txt", df) == "unknown"


def test_ingestion_normalize_columns():
    from src.ingestion import normalize_columns
    import pandas as pd

    df = pd.DataFrame({"Sales outlets": ["KA"], "Item description": ["Candle"], "Item supplier (Partner)": ["Riau"]})
    result = normalize_columns(df)
    assert "location" in result.columns
    assert "item_description" in result.columns
    assert "partner" in result.columns


def test_ingestion_standardize_locations():
    from src.ingestion import standardize_locations
    import pandas as pd

    df = pd.DataFrame({"location": ["The Social Space (Kreta Ayer)", "The Social Space (Potong Pasir)"]})
    result = standardize_locations(df)
    assert result["location"].iloc[0] == "Kreta Ayer"
    assert result["location"].iloc[1] == "Potong Pasir"


def test_ingestion_get_partner_mapping():
    from src.ingestion import get_partner_mapping
    import pandas as pd

    df = pd.DataFrame({"sku": ["R001", "R002"], "partner": ["Riau", "Riau"]})
    mapping = get_partner_mapping(df)
    assert mapping["R001"] == "Riau"


def test_normalizer_apply_corrections():
    from src.normalize import Normalizer

    n = Normalizer()
    n.corrections_cache = {"location": {"The Social Space (Kreta Ayer)": "Kreta Ayer"}}

    import pandas as pd
    df = pd.DataFrame({"location": ["The Social Space (Kreta Ayer)", "Unknown"]})
    result = n.apply_global_corrections(df)
    assert result["corrected_location"].iloc[0] == "Kreta Ayer"
    assert result["corrected_location"].iloc[1] == "Unknown"
    assert result["location"].iloc[0] == "The Social Space (Kreta Ayer)"  # original preserved


def test_normalizer_validate_columns():
    from src.normalize import Normalizer

    n = Normalizer()
    import pandas as pd
    df = pd.DataFrame({"sku": ["X"], "partner": ["Y"]})
    ok, missing = n.validate_required_columns(df, ["sku", "partner"])
    assert ok is True

    ok2, missing2 = n.validate_required_columns(df, ["sku", "location"])
    assert ok2 is False
    assert "location" in missing2
