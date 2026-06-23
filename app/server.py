#!/usr/bin/env python3
"""Participatory GIS server for Northern Highlands fuel treatment prioritization."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

APP_DIR = Path(__file__).resolve().parent
ROOT = APP_DIR.parent
STATIC_DIR = APP_DIR / "static"
DATA_DIR = ROOT / "data" / "submissions"
BOUNDS_FILE = STATIC_DIR / "raster" / "wfer_bounds.json"

SAFE_ID = re.compile(r"^[a-zA-Z0-9_-]+$")

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _submission_path(submission_id: str) -> Path:
    if not SAFE_ID.match(submission_id):
        raise ValueError("Invalid submission id")
    return DATA_DIR / f"{submission_id}.geojson"


@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/api/config")
def config():
    if not BOUNDS_FILE.exists():
        return jsonify(
            {
                "error": "Raster overlay not prepared. Run: python scripts/prepare_raster.py"
            }
        ), 503

    bounds = json.loads(BOUNDS_FILE.read_text())
    return jsonify(
        {
            "overlayUrl": "/static/raster/wfer_overlay.png",
            "bounds": bounds,
            "treatmentTypes": [
                "Fuel treatment",
                "Planned burn",
                "Both",
                "Other / unsure",
            ],
        }
    )


@app.route("/api/submissions", methods=["GET"])
def list_submissions():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    items = []
    for path in sorted(DATA_DIR.glob("*.geojson"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            doc = json.loads(path.read_text())
            props = doc.get("properties", {})
            items.append(
                {
                    "id": path.stem,
                    "participant": props.get("participant", "Anonymous"),
                    "updatedAt": props.get("updatedAt"),
                    "featureCount": len(doc.get("features", [])),
                }
            )
        except (json.JSONDecodeError, OSError):
            continue
    return jsonify(items)


@app.route("/api/submissions/<submission_id>", methods=["GET"])
def get_submission(submission_id: str):
    try:
        path = _submission_path(submission_id)
    except ValueError:
        return jsonify({"error": "Invalid id"}), 400

    if not path.exists():
        return jsonify({"error": "Not found"}), 404
    return jsonify(json.loads(path.read_text()))


@app.route("/api/submissions", methods=["POST"])
def create_submission():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = request.get_json(silent=True) or {}
    submission_id = str(uuid.uuid4())[:8]
    participant = (payload.get("participant") or "Anonymous").strip()[:120] or "Anonymous"
    features = payload.get("features") or []

    doc = {
        "type": "FeatureCollection",
        "properties": {
            "id": submission_id,
            "participant": participant,
            "createdAt": _utc_now(),
            "updatedAt": _utc_now(),
        },
        "features": features,
    }
    _submission_path(submission_id).write_text(json.dumps(doc, indent=2))
    return jsonify({"id": submission_id, "participant": participant}), 201


@app.route("/api/submissions/<submission_id>", methods=["PUT"])
def update_submission(submission_id: str):
    try:
        path = _submission_path(submission_id)
    except ValueError:
        return jsonify({"error": "Invalid id"}), 400

    if not path.exists():
        return jsonify({"error": "Not found"}), 404

    payload = request.get_json(silent=True) or {}
    doc = json.loads(path.read_text())
    props = doc.setdefault("properties", {})

    if "participant" in payload:
        props["participant"] = (payload["participant"] or "Anonymous").strip()[:120] or "Anonymous"
    if "features" in payload:
        doc["features"] = payload["features"]

    props["updatedAt"] = _utc_now()
    path.write_text(json.dumps(doc, indent=2))
    return jsonify({"id": submission_id, "updatedAt": props["updatedAt"]})


if __name__ == "__main__":
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    app.run(host="0.0.0.0", port=5000, debug=True)
