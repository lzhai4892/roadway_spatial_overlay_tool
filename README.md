# Roadway Line-to-Line Overlay Tool v1.0

Browser GIS corridor overlay. Destination linework is matched to a reference layer using **geometry only**: buffer, overlap, and local heading. ROADWAY IDs, mileposts, and Work Program / RCI locate fields are not used to find matches.

Developed by [lzhai4892](https://github.com/lzhai4892). The app is `index.html` plus `static/js`. Calculations run in the browser.

---

## How to run

Any static file server works. You need HTTP (not `file://`) if you want **Sample** to fetch `example_case/` files.

### Windows
Double-click `run_app.bat`. It starts a static server if Python is on PATH, then opens `http://127.0.0.1:5000`.

### Any OS
```bash
python -m http.server 5000
```
Or use VS Code Live Server / `npx serve`. Then open `http://127.0.0.1:5000`.

---

## Features

1. **WGS84 working CRS.** Uploads convert to EPSG:4326. Distances and angles are geodesic. The CRS dropdown is only a fallback when a projected file has no `.prj`.

2. **Local bearing.** Heading is measured on a configurable window (default 500 ft) at the overlap, not first-to-last vertex of a long work-program item.

3. **Two angle modes.** Ignore line direction (0°–90°) or check vertex direction (0°–180°). Max Angle Delta is the same value written to Angle Diff.

4. **Parallel Fallback.** Optional second rule. You set min coverage (%) and max distance (ft).

5. **Formats:** zipped shapefile, loose `.shp` + `.dbf` + `.prj`, GeoJSON, KML / KMZ, CSV.

6. **Map + table + export** to shapefile zip, Excel, GeoJSON, and CSV.

---

## Result fields

| Field | Meaning |
|:---|:---|
| `Match_Stat` | `"On Corridor"` or `"Off Corridor"` |
| `Matched_ID` | Labels from the expression template (not used to join) |
| `Match_Cnt` | Number of matching reference parts |
| `Ovl_Ft` / `Ovl_Mi` / `Ovl_Pct` | Destination coverage by accepted matches |
| `Ang_Dif` | Local heading of the longest accepted match, or the best miss if unmatched |
| `Min_Ft` | Distance for that same candidate |
| `QC_Flag` | Verified match / fallback, or why the best miss failed |
