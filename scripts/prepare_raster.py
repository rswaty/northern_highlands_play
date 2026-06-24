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


def magma_lut() -> np.ndarray:
    """256x3 RGB LUT — matplotlib magma (dark = low, bright = high)."""
    try:
        from matplotlib import colormaps

        cmap = colormaps["magma"]
        return (cmap(np.linspace(0, 1, 256))[:, :3] * 255).astype(np.uint8)
    except (ImportError, AttributeError, KeyError):
        try:
            from matplotlib import cm

            return (cm.get_cmap("magma")(np.linspace(0, 1, 256))[:, :3] * 255).astype(np.uint8)
        except (ImportError, AttributeError):
            pass
        stops = np.array(
            [
                [0, 0, 4],
                [28, 16, 68],
                [79, 18, 123],
                [129, 37, 129],
                [181, 54, 122],
                [229, 80, 100],
                [251, 135, 97],
                [254, 194, 135],
                [252, 253, 191],
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
        return lut


def colorize_wfer(values: np.ndarray, nodata_mask: np.ndarray) -> np.ndarray:
    """Map WFER values to RGBA using a magma-like, colorblind-friendly ramp."""
    rgba = np.zeros((*values.shape, 4), dtype=np.uint8)
    valid = ~nodata_mask
    if not np.any(valid):
        return rgba

    vmin = float(np.nanpercentile(values[valid], 2))
    vmax = float(np.nanpercentile(values[valid], 98))
    span = max(vmax - vmin, 1.0)
    t = np.clip((values - vmin) / span, 0.0, 1.0)

    lut = magma_lut()
    indices = (t * 255).astype(np.uint8)
    rgba[..., :3] = lut[indices]
    rgba[..., 3] = np.where(valid, 215, 0)
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
