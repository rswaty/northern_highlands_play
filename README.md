# Northern Highlands Participatory GIS

Web map for stakeholder input on fuel treatment and planned burn prioritization. Participants view the WFER raster over an OpenStreetMap basemap, draw polygons, annotate them, and save submissions to **Supabase**. The live site is hosted on **GitHub Pages**.

## Deploy checklist

### 1. Prepare the raster overlay (once per machine)

```bash
cd northern_highlands_play
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scripts/prepare_raster.py
```

This writes `docs/raster/wfer.tif`, `docs/raster/wfer_bounds.json`, and `docs/raster/cividis_lut.json`. The map downloads the GeoTIFF once, then paints each 30 m cell on canvas tiles (sharp at all zoom levels, no map server required).

### 2. Set up Supabase (once)

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** → **New query**.
3. Paste and run the contents of [`supabase/schema.sql`](supabase/schema.sql).
4. Go to **Project Settings** → **API** and copy:
   - **Project URL**
   - **anon public** key (safe to use in the browser)

5. Edit [`docs/js/supabase-config.js`](docs/js/supabase-config.js):

```javascript
window.SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
window.SUPABASE_ANON_KEY = "eyJ...your-anon-key...";
```

### 3. Push to GitHub

```bash
git add docs/ supabase/ scripts/ requirements.txt README.md .gitignore
git commit -m "Add GitHub Pages participatory GIS with Supabase"
git push origin main
```

Include `docs/raster/wfer.tif` (~17 MB) in the commit so GitHub Pages can serve it.

### 4. Enable GitHub Pages

1. On GitHub: **Settings** → **Pages**
2. **Source**: Deploy from a branch
3. **Branch**: `main` → folder **`/docs`** → Save
4. After a minute or two, your site will be at:

   `https://YOUR_USERNAME.github.io/northern_highlands_play/`

Share that URL with stakeholders.

## Test locally before pushing

```bash
cd docs
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000). Saving requires a configured `supabase-config.js`.

## How participants use it

1. Open the GitHub Pages URL.
2. Enter their name (e.g. agency or role).
3. Draw polygons on the map using the toolbar.
4. Click a polygon → add name, treatment type, and notes → **Update area**.
5. Click **Save polygons** (stored in Supabase).
6. Optionally **Download GeoJSON** as a personal backup.

## Collecting submissions for analysis

### From Supabase Dashboard

1. **Table Editor** → `submissions`
2. Export as CSV, or copy `features` JSON per row

### Export all as GeoJSON (SQL)

In Supabase **SQL Editor**:

```sql
select jsonb_build_object(
  'type', 'FeatureCollection',
  'features', jsonb_agg(
    jsonb_set(
      feature,
      '{properties,participant}',
      to_jsonb(s.participant)
    )
  )
)
from submissions s,
     jsonb_array_elements(s.features) as feature;
```

### In R

If you export rows from Supabase as individual GeoJSON files:

```r
library(sf)
library(jsonlite)

# Example: one exported features column saved as submission.json
doc <- fromJSON("submission.json", simplifyVector = FALSE)
st_read(doc, quiet = TRUE)
```

## Project layout

| Path | Purpose |
|------|---------|
| `docs/` | Static site served by GitHub Pages |
| `docs/js/supabase-config.js` | Your Supabase URL and anon key |
| `docs/raster/` | WFER GeoTIFF + metadata for client-side rendering |
| `inputs/wfer.tif` | Source WFER raster |
| `scripts/prepare_raster.py` | Copy GeoTIFF and build map metadata |
| `supabase/schema.sql` | Database table and access rules |

## Notes

- The Supabase **anon key is public** in the browser; row-level security allows open read/write for workshop use. Do not store sensitive personal data.
- Anyone with the link can view and edit submissions. For a closed workshop, only share the URL with participants.
- WFER values are colorized green (low) to red (high) using the 2nd–98th percentile range.
- To change treatment categories, edit `TREATMENT_TYPES` in `docs/js/app.js`.

## Optional: local Flask server (legacy)

The `app/` folder contains an earlier Flask version that saves to local files. The deployed app uses `docs/` + Supabase instead.

```bash
source .venv/bin/activate
python app/server.py   # http://localhost:5000
```
