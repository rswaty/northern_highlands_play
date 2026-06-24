#!/usr/bin/env python3
"""Publish source WFER GeoTIFF for client-side rendering and write map metadata."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import transform_bounds

ROOT = Path(__file__).resolve().parents[1]
INPUT_TIF = ROOT / "inputs" / "wfer.tif"
OUTPUT_DIR = ROOT / "docs" / "raster"
OUTPUT_TIF = OUTPUT_DIR / "wfer.tif"
OUTPUT_META = OUTPUT_DIR / "wfer_bounds.json"
OUTPUT_LUT = OUTPUT_DIR / "cividis_lut.json"

SRC_NODATA = 2147483647


def cividis_lut() -> list[list[int]]:
    try:
        from matplotlib import colormaps

        lut = (colormaps["cividis"](np.linspace(0, 1, 256))[:, :3] * 255).astype(np.uint8)
        return lut.tolist()
    except (ImportError, AttributeError, KeyError):
        try:
            from matplotlib import cm

            lut = (cm.get_cmap("cividis")(np.linspace(0, 1, 256))[:, :3] * 255).astype(np.uint8)
            return lut.tolist()
        except (ImportError, AttributeError):
            pass
    stops = np.array(
        [
            [0, 32, 77],
            [65, 68, 102],
            [88, 94, 109],
            [116, 121, 109],
            [145, 147, 109],
            [174, 173, 109],
            [207, 201, 110],
            [253, 231, 37],
        ],
        dtype=np.float64,
    )
    positions = np.linspace(0, 1, len(stops))
    targets = np.linspace(0, 1, 256)
    lut = np.zeros((256, 3), dtype=np.uint8)
    for i, t in enumerate(targets):
        idx = int(np.clip(np.searchsorted(positions, t, side="right") - 1, 0, len(stops) - 2))
        frac = (t - positions[idx]) / (positions[idx + 1] - positions[idx])
        lut[i] = np.round(stops[idx] * (1 - frac) + stops[idx + 1] * frac).astype(np.uint8)
    return lut.tolist()


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(INPUT_TIF, OUTPUT_TIF)

    with rasterio.open(INPUT_TIF) as src:
        west, south, east, north = transform_bounds(src.crs, "EPSG:4326", *src.bounds)
        data = src.read(1)
        valid = (data < SRC_NODATA - 1) & (data >= 0) & np.isfinite(data)
        vmin = float(np.percentile(data[valid], 2))
        vmax = float(np.percentile(data[valid], 98))

    meta = {
        "south": south,
        "west": west,
        "north": north,
        "east": east,
        "crs": "EPSG:4326",
        "rasterUrl": "raster/wfer.tif",
        "noData": SRC_NODATA,
        "vmin": vmin,
        "vmax": vmax,
    }
    OUTPUT_META.write_text(json.dumps(meta, indent=2))
    OUTPUT_LUT.write_text(json.dumps(cividis_lut()))

    print(f"Wrote {OUTPUT_TIF}")
    print(f"Wrote {OUTPUT_META}")
    print(f"Wrote {OUTPUT_LUT}")


if __name__ == "__main__":
    main()
