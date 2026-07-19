import zipfile
from io import BytesIO

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_healthz():
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_export_returns_a_vsdx_file(g1_design_dict):
    response = client.post("/export", json=g1_design_dict)

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/vnd.ms-visio.drawing"
    assert 'filename="G1 Branch Office.vsdx"' in response.headers["content-disposition"]

    zf = zipfile.ZipFile(BytesIO(response.content))
    assert "[Content_Types].xml" in zf.namelist()


def test_export_rejects_a_payload_missing_required_fields():
    response = client.post("/export", json={"meta": {"name": "x"}})
    assert response.status_code == 422


def test_export_rejects_an_empty_devices_list(g1_design_dict):
    g1_design_dict["devices"] = []
    response = client.post("/export", json=g1_design_dict)
    assert response.status_code == 422


def test_export_rejects_duplicate_device_ids(g1_design_dict):
    g1_design_dict["devices"].append(dict(g1_design_dict["devices"][0]))
    response = client.post("/export", json=g1_design_dict)
    assert response.status_code == 422
    assert "duplicate device ids" in response.json()["detail"]


def test_export_sanitizes_the_filename(g1_design_dict):
    g1_design_dict["meta"]["name"] = 'weird/../name:"<>.vsdx'
    response = client.post("/export", json=g1_design_dict)
    assert response.status_code == 200
    disposition = response.headers["content-disposition"]
    assert "/" not in disposition.split("filename=")[1]
