#!/usr/bin/env python3
"""Prepare wfer.tif for web display: warp to Web Mercator and colorize."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import calculate_default_transform, reproject, transform_bounds
from rasterio.transform import array_bounds

ROOT = Path(__file__).resolve().parents[1]
INPUT_TIF = ROOT / "inputs" / "wfer.tif"
OUTPUT_DIR = ROOT / "docs" / "raster"
OUTPUT_PNG = OUTPUT_DIR / "wfer_overlay.png"
OUTPUT_BOUNDS = OUTPUT_DIR / "wfer_bounds.json"

# Typical WFER nodata from ArcGIS export
NODATA = 2147483647


def colorize_wfer(values: np.ndarray, nodata_mask: np.ndarray) -> np.ndarray:
    """Map WFER values to RGBA (green -> yellow -> red)."""
    rgba = np.zeros((*values.shape, 4), dtype=np.uint8)
    valid = ~nodata_mask
    if not np.any(valid):
        return rgba

    vmin = float(np.nanpercentile(values[valid], 2))
    vmax = float(np.nanpercentile(values[valid], 98))
    span = max(vmax - vmin, 1.0)
    t = np.clip((values - vmin) / span, 0.0, 1.0)

    # green (low) -> yellow -> red (high)
    rgba[..., 0] = np.where(valid, (t * 255).astype(np.uint8), 0)
    rgba[..., 1] = np.where(valid, ((1 - np.abs(t - 0.5) * 2) * 200 + 55).astype(np.uint8), 0)
    rgba[..., 2] = np.where(valid, ((1 - t) * 180).astype(np.uint8), 0)
    rgba[..., 3] = np.where(valid, 190, 0)
    return rgba


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    with rasterio.open(INPUT_TIF) as src:
        dst_crs = "EPSG:3857"
        transform, width, height = calculate_default_transform(
            src.crs, dst_crs, src.width, src.height, *src.bounds
        )
        data = np.empty((src.count, height, width), dtype=np.float32)
        reproject(
            source=rasterio.band(src, 1),
            destination=data[0],
            src_transform=src.transform,
            src_crs=src.crs,
            dst_transform=transform,
            dst_crs=dst_crs,
            resampling=Resampling.bilinear,
        )

        nodata_mask = (data[0] >= NODATA - 1) | (data[0] < 0) | ~np.isfinite(data[0])
        rgba = colorize_wfer(data[0], nodata_mask)

        west, south, east, north = array_bounds(height, width, transform)
        # Leaflet imageOverlay expects WGS84 lat/lng degrees, not Web Mercator meters.
        west, south, east, north = transform_bounds(
            dst_crs, "EPSG:4326", west, south, east, north
        )
        bounds = {
            "south": south,
            "west": west,
            "north": north,
            "east": east,
            "crs": "EPSG:4326",
        }

    try:
        from PIL import Image

        Image.fromarray(rgba, mode="RGBA").save(OUTPUT_PNG, optimize=True)
    except ImportError:
        import matplotlib.pyplot as plt

        plt.imsave(OUTPUT_PNG, rgba)

    OUTPUT_BOUNDS.write_text(json.dumps(bounds, indent=2))
    print(f"Wrote {OUTPUT_PNG}")
    print(f"Wrote {OUTPUT_BOUNDS}")


if __name__ == "__main__":
    main()
