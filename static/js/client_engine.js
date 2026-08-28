/**
 * Client-side GIS overlay engine for the Roadway Line-to-Line Workbench.
 * Working CRS is always WGS84 (EPSG:4326). Distances are geodesic (feet).
 * Angles are computed on a local window at the overlap, not the whole feature chord.
 */

if (typeof proj4 !== "undefined") {
  proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs");
  proj4.defs("EPSG:3857", "+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs");
  proj4.defs("EPSG:26917", "+proj=utm +zone=17 +ellps=GRS80 +datum=NAD83 +units=m +no_defs");
  proj4.defs("EPSG:26916", "+proj=utm +zone=16 +ellps=GRS80 +datum=NAD83 +units=m +no_defs");
  proj4.defs("EPSG:2236", "+proj=tmerc +lat_0=24.33333333333333 +lon_0=-81 +k=0.999941177 +x_0=200000.0001016002 +y_0=0 +ellps=GRS80 +datum=NAD83 +to_meter=0.3048006096012192 +no_defs");
  proj4.defs("EPSG:2237", "+proj=tmerc +lat_0=24.33333333333333 +lon_0=-82 +k=0.999941177 +x_0=200000.0001016002 +y_0=0 +ellps=GRS80 +datum=NAD83 +to_meter=0.3048006096012192 +no_defs");
  proj4.defs("EPSG:3086", "+proj=aea +lat_1=24 +lat_2=31.5 +lat_0=24 +lon_0=-84 +x_0=400000 +y_0=0 +ellps=GRS80 +datum=NAD83 +units=m +no_defs");
  proj4.defs("EPSG:3087", "+proj=aea +lat_1=24 +lat_2=31.5 +lat_0=24 +lon_0=-84 +x_0=400000 +y_0=0 +ellps=GRS80 +datum=NAD83 +units=m +no_defs");
}

class ClientGISEngine {
  static FEET_PER_DEGREE_LAT = 364000;

  /**
   * Parse uploaded File(s) into a WGS84 GeoJSON FeatureCollection.
   * Supports: .zip (shapefile or KMZ), loose .shp+.dbf+.prj, .geojson, .json, .csv, .kml
   */
  static async parseUploadedFiles(fileList, options = {}) {
    if (!fileList || fileList.length === 0) {
      throw new Error("No files selected.");
    }

    const files = Array.from(fileList);
    const sourceCrsHint = options.source_crs || "4326";
    const zipFile = files.find((f) => /\.(zip|kmz)$/i.test(f.name));
    const shpFile = files.find((f) => f.name.toLowerCase().endsWith(".shp"));
    const dbfFile = files.find((f) => f.name.toLowerCase().endsWith(".dbf"));
    const prjFile = files.find((f) => f.name.toLowerCase().endsWith(".prj"));
    const geojsonFile = files.find((f) => /\.(geojson|json)$/i.test(f.name));
    const csvFile = files.find((f) => f.name.toLowerCase().endsWith(".csv"));
    const kmlFile = files.find((f) => f.name.toLowerCase().endsWith(".kml"));

    let rawGeoJSON = null;
    let prjText = prjFile ? await prjFile.text() : null;
    let baseName = files[0].name.replace(/\.[^/.]+$/, "");
    let alreadyWgs84 = false;

    if (zipFile) {
      baseName = zipFile.name.replace(/\.(zip|kmz)$/i, "");
      const buffer = await zipFile.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);
      const kmlEntry = Object.keys(zip.files).find(
        (n) => /\.kml$/i.test(n) && !n.includes("__MACOSX") && !zip.files[n].dir
      );
      const zipPrj = Object.keys(zip.files).find(
        (n) => /\.prj$/i.test(n) && !n.includes("__MACOSX") && !zip.files[n].dir
      );
      if (zipPrj && !prjText) {
        prjText = await zip.files[zipPrj].async("string");
      }

      if (kmlEntry) {
        rawGeoJSON = this.parseKmlToGeoJSON(await zip.files[kmlEntry].async("string"));
        alreadyWgs84 = true;
      } else {
        try {
          const parsed = await shp(buffer);
          rawGeoJSON = Array.isArray(parsed)
            ? parsed[0]
            : parsed.type === "FeatureCollection"
              ? parsed
              : Object.values(parsed)[0];
          alreadyWgs84 = this.looksLikeWgs84(rawGeoJSON);
        } catch (err) {
          throw new Error(`Failed to parse zipped Shapefile: ${err.message}`);
        }
      }
    } else if (shpFile) {
      baseName = shpFile.name.replace(/\.shp$/i, "");
      const shpBuffer = await shpFile.arrayBuffer();
      const dbfBuffer = dbfFile ? await dbfFile.arrayBuffer() : null;
      try {
        const parsedGeom = shp.parseShp(shpBuffer);
        const parsedDbf = dbfBuffer ? shp.parseDbf(dbfBuffer) : [];
        rawGeoJSON = shp.combine([parsedGeom, parsedDbf]);
      } catch (err) {
        throw new Error(`Failed to parse Shapefile (.shp/.dbf): ${err.message}`);
      }
    } else if (geojsonFile) {
      baseName = geojsonFile.name.replace(/\.(geojson|json)$/i, "");
      try {
        rawGeoJSON = JSON.parse(await geojsonFile.text());
      } catch (err) {
        throw new Error(`Invalid JSON / GeoJSON file: ${err.message}`);
      }
    } else if (csvFile) {
      baseName = csvFile.name.replace(/\.csv$/i, "");
      rawGeoJSON = this.parseCsvToGeoJSON(await csvFile.text());
    } else if (kmlFile) {
      baseName = kmlFile.name.replace(/\.kml$/i, "");
      rawGeoJSON = this.parseKmlToGeoJSON(await kmlFile.text());
      alreadyWgs84 = true;
    } else {
      throw new Error("Unsupported format. Please upload .zip, .shp, .geojson, .kml, .kmz, or .csv.");
    }

    if (!rawGeoJSON || !rawGeoJSON.features || rawGeoJSON.features.length === 0) {
      throw new Error("The uploaded layer contains 0 spatial features.");
    }

    const resolved = this.ensureWgs84(rawGeoJSON, {
      prjText,
      sourceCrsHint,
      alreadyWgs84,
    });

    const cleaned = this.cleanAndExplodeLayer(resolved.geojson, baseName);
    cleaned.source_crs = resolved.sourceLabel;
    cleaned.target_crs = "WGS84 (EPSG:4326)";
    cleaned.reprojected = resolved.reprojected;
    if (resolved.reprojected) {
      cleaned.warnings.unshift(`Reprojected from ${resolved.sourceLabel} to WGS84 (EPSG:4326) for geodesic distance and angle calculations.`);
    }
    return cleaned;
  }

  static parseKmlToGeoJSON(kmlText) {
    const doc = new DOMParser().parseFromString(kmlText, "text/xml");
    if (doc.querySelector("parsererror")) {
      throw new Error("Invalid KML file.");
    }

    const features = [];

    const parseCoordText = (text) =>
      text
        .trim()
        .split(/\s+/)
        .map((pair) => {
          const p = pair.split(",").map(Number);
          return [p[0], p[1]];
        })
        .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));

    const addLine = (coords, props) => {
      if (coords.length >= 2) {
        features.push({
          type: "Feature",
          properties: { ...props },
          geometry: { type: "LineString", coordinates: coords },
        });
      }
    };

    const readExtendedData = (placemark) => {
      const props = {};
      const nameEl = placemark.getElementsByTagName("name")[0];
      const descEl = placemark.getElementsByTagName("description")[0];
      if (nameEl && nameEl.textContent) props.name = nameEl.textContent.trim();
      if (descEl && descEl.textContent) props.description = descEl.textContent.trim();

      const datas = placemark.getElementsByTagName("Data");
      for (let i = 0; i < datas.length; i++) {
        const key = datas[i].getAttribute("name");
        const val = datas[i].getElementsByTagName("value")[0];
        if (key && val) props[key] = val.textContent;
      }
      const simple = placemark.getElementsByTagName("SimpleData");
      for (let i = 0; i < simple.length; i++) {
        const key = simple[i].getAttribute("name");
        if (key) props[key] = simple[i].textContent;
      }
      return props;
    };

    const placemarks = doc.getElementsByTagName("Placemark");
    for (let i = 0; i < placemarks.length; i++) {
      const props = readExtendedData(placemarks[i]);
      const lines = placemarks[i].getElementsByTagName("LineString");
      for (let j = 0; j < lines.length; j++) {
        const coordEl = lines[j].getElementsByTagName("coordinates")[0];
        if (coordEl) addLine(parseCoordText(coordEl.textContent), props);
      }
    }

    if (features.length === 0) {
      const lines = doc.getElementsByTagName("LineString");
      for (let j = 0; j < lines.length; j++) {
        const coordEl = lines[j].getElementsByTagName("coordinates")[0];
        if (coordEl) addLine(parseCoordText(coordEl.textContent), {});
      }
    }

    if (features.length === 0) {
      throw new Error("KML contains no LineString features.");
    }
    return { type: "FeatureCollection", features };
  }

  static parseCsvToGeoJSON(csvText) {
    const results = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    if (!results.data || results.data.length === 0) {
      throw new Error("CSV file contains no data rows.");
    }

    const features = [];
    const fields = results.meta.fields || Object.keys(results.data[0]);
    const wktCol = fields.find((f) => ["wkt", "geometry", "geom", "the_geom", "shape"].includes(f.toLowerCase()));
    const latCol = fields.find((f) => ["lat", "latitude", "y"].includes(f.toLowerCase()));
    const lonCol = fields.find((f) => ["lon", "long", "longitude", "x"].includes(f.toLowerCase()));

    results.data.forEach((row, idx) => {
      let geom = null;
      if (wktCol && row[wktCol]) {
        geom = this.wktToGeoJSONGeometry(row[wktCol]);
      } else if (latCol && lonCol && row[latCol] && row[lonCol]) {
        const lat = parseFloat(row[latCol]);
        const lon = parseFloat(row[lonCol]);
        if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
          geom = { type: "Point", coordinates: [lon, lat] };
        }
      }

      if (geom) {
        const props = { ...row };
        if (wktCol) delete props[wktCol];
        features.push({
          type: "Feature",
          id: idx,
          properties: props,
          geometry: geom,
        });
      }
    });

    return { type: "FeatureCollection", features };
  }

  static wktToGeoJSONGeometry(wktStr) {
    const trimmed = String(wktStr).trim();
    const upper = trimmed.toUpperCase();

    const parsePairs = (text) =>
      text.split(",").map((pair) => {
        const parts = pair.trim().split(/\s+/).map(Number);
        return [parts[0], parts[1]];
      });

    if (upper.startsWith("MULTILINESTRING")) {
      const inner = trimmed.replace(/^MULTILINESTRING\s*\(/i, "").replace(/\)\s*$/, "");
      const parts = inner.split(/\)\s*,\s*\(/);
      const lines = parts.map((p) => parsePairs(p.replace(/^\(+/, "").replace(/\)+$/, "")));
      return { type: "MultiLineString", coordinates: lines };
    }
    if (upper.startsWith("LINESTRING")) {
      const coordPart = trimmed.replace(/^LINESTRING\s*\(/i, "").replace(/\)$/, "");
      return { type: "LineString", coordinates: parsePairs(coordPart) };
    }
    if (upper.startsWith("POINT")) {
      const coordPart = trimmed.replace(/^POINT\s*\(/i, "").replace(/\)$/, "");
      const parts = coordPart.trim().split(/\s+/).map(Number);
      return { type: "Point", coordinates: [parts[0], parts[1]] };
    }
    return null;
  }

  static looksLikeWgs84(geojson) {
    let checked = 0;
    let ok = 0;
    const walk = (coords) => {
      if (!coords || !coords.length) return;
      if (typeof coords[0] === "number") {
        checked += 1;
        if (Math.abs(coords[0]) <= 180 && Math.abs(coords[1]) <= 90) ok += 1;
        return;
      }
      coords.forEach(walk);
    };
    (geojson.features || []).slice(0, 80).forEach((f) => {
      if (f.geometry && f.geometry.coordinates) walk(f.geometry.coordinates);
    });
    return checked > 0 && ok / checked > 0.95;
  }

  static extractGeojsonEpsg(geojson) {
    const name = geojson.crs && geojson.crs.properties && (geojson.crs.properties.name || geojson.crs.properties.href);
    if (!name) return null;
    const match = String(name).match(/EPSG[:/](\d+)/i);
    if (match) return `EPSG:${match[1]}`;
    if (/crs84|crs:84|4326|wgs.?84/i.test(String(name))) return "EPSG:4326";
    return null;
  }

  static crsFromPrjText(prjText) {
    if (!prjText) return null;
    const text = String(prjText);
    const epsg = text.match(/AUTHORITY\["EPSG",\s*"?(\d+)"?\]/i);
    if (epsg) return `EPSG:${epsg[1]}`;
    if (/Florida_GDL_Albers/i.test(text) && /HARN/i.test(text)) return "EPSG:3087";
    if (/Florida_GDL_Albers/i.test(text)) return "EPSG:3086";
    return null;
  }

  static normalizeCrsCode(code) {
    if (!code) return null;
    const text = String(code).trim();
    if (text.startsWith("+") || text.includes("[") || text === "SRC_PRJ") return text;
    if (/^\d+$/.test(text)) return `EPSG:${text}`;
    if (text.toUpperCase().startsWith("EPSG:")) return `EPSG:${text.split(":")[1]}`;
    return text;
  }

  static ensureWgs84(geojson, { prjText, sourceCrsHint, alreadyWgs84 }) {
    if (alreadyWgs84 || this.looksLikeWgs84(geojson)) {
      const named = this.extractGeojsonEpsg(geojson);
      return {
        geojson,
        sourceLabel: named && named !== "EPSG:4326" ? `${named} (lon/lat)` : "WGS84 (EPSG:4326)",
        reprojected: false,
      };
    }

    let sourceCrs = this.extractGeojsonEpsg(geojson) || this.crsFromPrjText(prjText);
    if (!sourceCrs && prjText && typeof proj4 !== "undefined") {
      try {
        proj4.defs("SRC_PRJ", prjText);
        sourceCrs = "SRC_PRJ";
      } catch (err) {
        sourceCrs = null;
      }
    }
    if (!sourceCrs) {
      sourceCrs = this.normalizeCrsCode(sourceCrsHint);
    }
    if (!sourceCrs || sourceCrs === "EPSG:4326") {
      throw new Error(
        "Coordinates are not WGS84 and no source CRS / .prj was found. Choose the source CRS in the sidebar and reload the file."
      );
    }

    return {
      geojson: this.reprojectToWgs84(geojson, sourceCrs),
      sourceLabel: sourceCrs === "SRC_PRJ" ? "Embedded .prj" : sourceCrs,
      reprojected: true,
    };
  }

  static reprojectToWgs84(geojson, sourceCrs) {
    if (typeof proj4 === "undefined") {
      throw new Error("proj4 is required to reproject layers to WGS84.");
    }
    const convert = proj4(sourceCrs, "EPSG:4326");
    const convertCoords = (coords) => {
      if (typeof coords[0] === "number") {
        const xy = convert.forward([coords[0], coords[1]]);
        return coords.length > 2 ? [xy[0], xy[1], coords[2]] : [xy[0], xy[1]];
      }
      return coords.map(convertCoords);
    };

    return {
      ...geojson,
      crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
      features: (geojson.features || []).map((f) => ({
        ...f,
        geometry: f.geometry
          ? { ...f.geometry, coordinates: convertCoords(f.geometry.coordinates) }
          : f.geometry,
      })),
    };
  }

  static cleanAndExplodeLayer(geojson, layerName = "Layer") {
    let multipartCount = 0;
    let invalidCount = 0;
    const cleanFeatures = [];
    const columnsSet = new Set();
    const warnings = [];

    (geojson.features || []).forEach((feat, origIdx) => {
      if (!feat || !feat.geometry) {
        invalidCount += 1;
        return;
      }

      const geomType = feat.geometry.type;
      if (geomType !== "GeometryCollection" && !feat.geometry.coordinates) {
        invalidCount += 1;
        return;
      }

      const props = { ...(feat.properties || {}), _orig_fid: origIdx };
      Object.keys(props).forEach((k) => columnsSet.add(k));
      const pushLine = (coords, partIdx) => {
        if (!Array.isArray(coords) || coords.length < 2) {
          invalidCount += 1;
          return;
        }
        cleanFeatures.push({
          type: "Feature",
          properties: { ...props, _part_id: partIdx, _feat_id: `${origIdx}:${partIdx}` },
          geometry: { type: "LineString", coordinates: coords },
        });
      };

      if (geomType === "LineString") {
        pushLine(feat.geometry.coordinates, 0);
      } else if (geomType === "MultiLineString") {
        multipartCount += 1;
        feat.geometry.coordinates.forEach((lineCoords, partIdx) => {
          pushLine(lineCoords, partIdx);
        });
      } else if (geomType === "GeometryCollection") {
        multipartCount += 1;
        (feat.geometry.geometries || []).forEach((g, partIdx) => {
          if (g && g.type === "LineString") pushLine(g.coordinates, partIdx);
        });
      } else {
        invalidCount += 1;
      }
    });

    if (multipartCount > 0) {
      warnings.push(
        `Notice: ${multipartCount} multi-part feature(s) detected. Exploded into single-part LineStrings for local bearing and overlap analysis.`
      );
    }
    if (invalidCount > 0) {
      warnings.push(`Filtered out ${invalidCount} non-line or empty geometry records.`);
    }

    const columns = Array.from(columnsSet).filter((c) => !c.startsWith("_"));

    return {
      layer_name: layerName,
      feature_count: cleanFeatures.length,
      multipart_count: multipartCount,
      invalid_count: invalidCount,
      source_crs: "WGS84 (EPSG:4326)",
      target_crs: "WGS84 (EPSG:4326)",
      columns,
      sample_data: cleanFeatures.slice(0, 5).map((f) => f.properties),
      warnings,
      geojson: {
        type: "FeatureCollection",
        name: layerName,
        crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
        features: cleanFeatures,
      },
    };
  }

  static expandBBoxByFeet(bbox, feet) {
    const lat = (bbox[1] + bbox[3]) / 2;
    const latPad = feet / this.FEET_PER_DEGREE_LAT;
    const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    const lonPad = feet / (this.FEET_PER_DEGREE_LAT * cosLat);
    return [bbox[0] - lonPad, bbox[1] - latPad, bbox[2] + lonPad, bbox[3] + latPad];
  }

  static bboxesOverlap(a, b) {
    return !(b[0] > a[2] || b[2] < a[0] || b[1] > a[3] || b[3] < a[1]);
  }

  static buildGridIndex(features, cellDeg = 0.02) {
    const grid = new Map();
    const items = features.map((f, i) => {
      let bbox = [0, 0, 0, 0];
      try {
        bbox = turf.bbox(f);
      } catch (err) {
        bbox = [0, 0, 0, 0];
      }
      return { i, f, bbox };
    });

    items.forEach((item) => {
      const [minX, minY, maxX, maxY] = item.bbox;
      const x0 = Math.floor(minX / cellDeg);
      const x1 = Math.floor(maxX / cellDeg);
      const y0 = Math.floor(minY / cellDeg);
      const y1 = Math.floor(maxY / cellDeg);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = `${x}:${y}`;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(item);
        }
      }
    });

    return { grid, cellDeg };
  }

  static queryGrid(index, bbox) {
    const { grid, cellDeg } = index;
    const seen = new Set();
    const out = [];
    const x0 = Math.floor(bbox[0] / cellDeg);
    const x1 = Math.floor(bbox[2] / cellDeg);
    const y0 = Math.floor(bbox[1] / cellDeg);
    const y1 = Math.floor(bbox[3] / cellDeg);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const bucket = grid.get(`${x}:${y}`);
        if (!bucket) continue;
        for (const item of bucket) {
          if (seen.has(item.i)) continue;
          seen.add(item.i);
          if (this.bboxesOverlap(bbox, item.bbox)) out.push(item);
        }
      }
    }
    return out;
  }

  static lengthFeet(feat) {
    try {
      return turf.length(feat, { units: "miles" }) * 5280;
    } catch (err) {
      return 0;
    }
  }

  static sumLengthFeet(features) {
    return features.reduce((acc, f) => acc + this.lengthFeet(f), 0);
  }

  static longestFeature(features) {
    let best = null;
    let bestLen = -1;
    features.forEach((f) => {
      const len = this.lengthFeet(f);
      if (len > bestLen) {
        best = f;
        bestLen = len;
      }
    });
    return best;
  }

  static midpointOfLine(lineFeat) {
    const lenMiles = this.lengthFeet(lineFeat) / 5280;
    if (lenMiles <= 0) {
      const coords = lineFeat.geometry.coordinates;
      return turf.point(coords[0]);
    }
    return turf.along(lineFeat, lenMiles / 2, { units: "miles" });
  }

  static bufferLine(lineFeat, bufferKm) {
    try {
      return turf.buffer(lineFeat, bufferKm, { units: "kilometers" });
    } catch (err) {
      return null;
    }
  }

  /**
   * True clip of a line to a polygon: split on the ring, keep pieces whose midpoint is inside.
   * Long twisting work-program lines keep only the local stretch next to the target.
   */
  static clipLineToPolygon(lineFeat, polyFeat) {
    if (!lineFeat || !polyFeat || !lineFeat.geometry) return [];

    if (typeof turf.lineSplit !== "function") {
      return this.clipLineBySegmentMidpoints(lineFeat, polyFeat);
    }

    let splitter;
    try {
      splitter = typeof turf.polygonToLine === "function" ? turf.polygonToLine(polyFeat) : polyFeat;
    } catch (err) {
      splitter = polyFeat;
    }

    const splitters = splitter && splitter.type === "FeatureCollection" ? splitter.features : [splitter];
    let pieces = [lineFeat];
    splitters.forEach((s) => {
      if (!s) return;
      const next = [];
      pieces.forEach((piece) => {
        try {
          const split = turf.lineSplit(piece, s);
          if (split && split.features && split.features.length) {
            next.push(...split.features);
          } else {
            next.push(piece);
          }
        } catch (err) {
          next.push(piece);
        }
      });
      pieces = next;
    });

    const inside = [];
    pieces.forEach((part) => {
      if (!part.geometry || !part.geometry.coordinates || part.geometry.coordinates.length < 2) return;
      const lenMiles = this.lengthFeet(part) / 5280;
      if (lenMiles <= 0) return;
      try {
        const mid = turf.along(part, lenMiles / 2, { units: "miles" });
        if (turf.booleanPointInPolygon(mid, polyFeat)) inside.push(part);
      } catch (err) {
        /* skip broken piece */
      }
    });
    return inside;
  }

  static clipLineBySegmentMidpoints(lineFeat, polyFeat) {
    const coords = lineFeat.geometry.coordinates;
    const inside = [];
    let run = [];

    const flush = () => {
      if (run.length >= 2) {
        inside.push(turf.lineString(run));
      }
      run = [];
    };

    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      const mid = turf.midpoint(turf.point(a), turf.point(b));
      let isIn = false;
      try {
        isIn = turf.booleanPointInPolygon(mid, polyFeat);
      } catch (err) {
        isIn = false;
      }
      if (isIn) {
        if (!run.length) run.push(a);
        run.push(b);
      } else {
        flush();
      }
    }
    flush();
    return inside;
  }

  static chordBearing(lineFeat) {
    const coords = lineFeat && lineFeat.geometry && lineFeat.geometry.coordinates;
    if (!coords || coords.length < 2) return NaN;
    return turf.bearing(turf.point(coords[0]), turf.point(coords[coords.length - 1]));
  }

  /**
   * Bearing of a localized window along the line, centered on the nearest point to `pointFeat`.
   * This is what makes long, twisting reference roads comparable to a short target overlap.
   */
  static localBearingAtPoint(lineFeat, pointFeat, windowFeet) {
    if (!lineFeat || !pointFeat) return NaN;
    const windowMiles = Math.max(windowFeet, 50) / 5280;
    let loc = 0;
    let lineLen = 0;
    try {
      const snapped = turf.nearestPointOnLine(lineFeat, pointFeat, { units: "miles" });
      loc = snapped.properties.location || 0;
      lineLen = turf.length(lineFeat, { units: "miles" });
    } catch (err) {
      return this.chordBearing(lineFeat);
    }

    const start = Math.max(0, loc - windowMiles / 2);
    const end = Math.min(lineLen, loc + windowMiles / 2);
    if (end - start < 1 / 5280) return this.chordBearing(lineFeat);

    try {
      const sliced = turf.lineSliceAlong(lineFeat, start, end, { units: "miles" });
      return this.chordBearing(sliced);
    } catch (err) {
      return this.chordBearing(lineFeat);
    }
  }

  /**
   * Fold the *difference*, not each bearing.
   * Undirected (default): reverse digitizing is the same corridor, result in [0, 90].
   * Directed: vertex order matters, result in [0, 180].
   */
  static angleDifference(bearingA, bearingB, directed) {
    if (!Number.isFinite(bearingA) || !Number.isFinite(bearingB)) return 999;
    let raw = Math.abs(bearingA - bearingB) % 360;
    if (raw > 180) raw = 360 - raw;
    if (directed) return Math.round(raw * 10) / 10;
    if (raw > 90) raw = 180 - raw;
    return Math.round(raw * 10) / 10;
  }

  static coveredLengthFeet(targetFeat, overlapPieces) {
    if (!overlapPieces.length) return 0;
    if (overlapPieces.length === 1) return this.lengthFeet(overlapPieces[0]);

    const totalMiles = this.lengthFeet(targetFeat) / 5280;
    if (totalMiles <= 0) return 0;
    const stepMiles = Math.max(totalMiles / 400, 20 / 5280);
    let covered = 0;
    let steps = 0;
    for (let d = 0; d < totalMiles; d += stepMiles) {
      steps += 1;
      try {
        const pt = turf.along(targetFeat, d, { units: "miles" });
        const hit = overlapPieces.some((seg) => turf.pointToLineDistance(pt, seg, { units: "miles" }) < 8 / 5280);
        if (hit) covered += 1;
      } catch (err) {
        /* skip sample */
      }
    }
    return steps > 0 ? (covered / steps) * totalMiles * 5280 : 0;
  }

  static formatMatchTag(refProps, customTemplate, refColumns) {
    if (customTemplate) {
      return customTemplate
        .replace(/\{([^}]+)\}/g, (_, key) => {
          const val = refProps[key.trim()];
          return val !== undefined && val !== null && val !== "" ? String(val) : "";
        })
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^[-:,_\s]+|[-:,_\s]+$/g, "");
    }
    if (refColumns.length > 0) {
      return refColumns.map((col) => refProps[col]).filter((v) => v !== undefined && v !== null && v !== "").join(" - ");
    }
    return refProps.ITEMSEG || refProps.Segment_ID || refProps.ROADWAY || String(refProps._orig_fid || "MATCH");
  }

  static DEST_ID_FIELDS = [
    "LocationID", "LOCATIONID", "LOCATION_ID", "Location_ID",
    "Dest_ID", "DEST_ID", "DESTID", "DestinationID",
    "SITEID", "SiteID", "Site_ID",
    "FEATUREID", "FeatureID",
    "ID",
    "OBJECTID",
    "FID",
  ];

  static pickDefaultDestIdField(columns) {
    const cols = columns || [];
    const lowerMap = new Map(cols.map((c) => [String(c).toLowerCase(), c]));
    for (const name of this.DEST_ID_FIELDS) {
      const actual = cols.includes(name) ? name : lowerMap.get(name.toLowerCase());
      if (actual) return actual;
    }
    return "";
  }

  static resolveDestId(props, preferredField) {
    const source = props || {};
    if (preferredField && Object.prototype.hasOwnProperty.call(source, preferredField)) {
      const chosen = source[preferredField];
      if (chosen !== undefined && chosen !== null && String(chosen).trim() !== "") return String(chosen);
    }
    const keys = Object.keys(source);
    const lowerMap = new Map(keys.map((k) => [k.toLowerCase(), k]));
    for (const name of this.DEST_ID_FIELDS) {
      const actual = Object.prototype.hasOwnProperty.call(source, name) ? name : lowerMap.get(name.toLowerCase());
      if (!actual) continue;
      const val = source[actual];
      if (val !== undefined && val !== null && String(val).trim() !== "") return String(val);
    }
    if (source._feat_id !== undefined && source._feat_id !== null && source._feat_id !== "") {
      return String(source._feat_id);
    }
    if (source._orig_fid !== undefined && source._orig_fid !== null && source._orig_fid !== "") {
      return String(source._orig_fid);
    }
    return "";
  }

  static evaluateTarget(targetFeat, index, options) {
    const {
      bufferFeet,
      bufferKm,
      minOverlapFeet,
      minTargetRatio,
      maxAngleDelta,
      enableFallback,
      fallbackMinRatio,
      fallbackMaxDistance,
      directed,
      bearingWindowFeet,
      refColumns,
      customTemplate,
      keepDuplicates,
      destIdField,
    } = options;

    const targetProps = { ...(targetFeat.properties || {}) };
    const targetLengthFeet = this.lengthFeet(targetFeat);
    const matchTags = [];
    const matchedRefDetails = [];
    const matchOverlapPieces = [];
    let matchOccurrences = 0;
    let bestMatchAngle = null;
    let bestMatchOverlap = -1;
    let bestMatchDist = null;
    let bestCandidateAngle = null;
    let bestCandidateOverlap = -1;
    let bestCandidateDist = null;
    let bestMatchQc = null;
    let bestMissQc = null;

    if (!targetFeat.geometry || !Number.isFinite(targetLengthFeet) || targetLengthFeet <= 0) {
      return this.buildTargetResult(targetFeat, targetProps, {
        matchTags,
        matchedRefDetails,
        matchOverlapPieces,
        matchOccurrences,
        bestMatchAngle,
        bestCandidateAngle,
        bestMatchDist,
        bestCandidateDist,
        bestMatchQc: "Invalid Geometry",
        bestMissQc: "Invalid Geometry",
        targetLengthFeet,
        keepDuplicates,
        destIdField,
      });
    }

    let targetBBox;
    try {
      targetBBox = turf.bbox(targetFeat);
    } catch (err) {
      return this.buildTargetResult(targetFeat, targetProps, {
        matchTags,
        matchedRefDetails,
        matchOverlapPieces,
        matchOccurrences,
        bestMatchAngle,
        bestCandidateAngle,
        bestMatchDist,
        bestCandidateDist,
        bestMatchQc: "Invalid Geometry",
        bestMissQc: "Invalid Geometry",
        targetLengthFeet,
        keepDuplicates,
        destIdField,
      });
    }
    const searchBBox = this.expandBBoxByFeet(targetBBox, bufferFeet);
    const candidates = this.queryGrid(index, searchBBox);
    const targetBuffer = this.bufferLine(targetFeat, bufferKm);

    if (targetBuffer) {
      candidates.forEach((item) => {
        const refFeat = item.f;
        const refProps = refFeat.properties || {};

        const localRefPieces = this.clipLineToPolygon(refFeat, targetBuffer);
        if (!localRefPieces.length) return;

        const localRef = this.longestFeature(localRefPieces);
        const localRefBuffer = this.bufferLine(localRef, bufferKm);
        if (!localRefBuffer) return;

        const overlapOnTarget = this.clipLineToPolygon(targetFeat, localRefBuffer);
        const overlapFeet = this.sumLengthFeet(overlapOnTarget);
        if (overlapFeet <= 0) return;

        const overlapPiece = this.longestFeature(overlapOnTarget);
        const overlapMid = this.midpointOfLine(overlapPiece);
        const targetBearing = this.localBearingAtPoint(targetFeat, overlapMid, bearingWindowFeet);
        const refBearing = this.localBearingAtPoint(refFeat, overlapMid, bearingWindowFeet);
        const angleDelta = this.angleDifference(targetBearing, refBearing, directed);

        let distFeet = 9999;
        try {
          distFeet = turf.pointToLineDistance(overlapMid, refFeat, { units: "miles" }) * 5280;
        } catch (err) {
          distFeet = 9999;
        }

        const overlapRatioPct = (overlapFeet / Math.max(1, targetLengthFeet)) * 100;

        const isPrimaryMatch =
          overlapFeet >= minOverlapFeet &&
          overlapRatioPct >= minTargetRatio &&
          angleDelta <= maxAngleDelta;

        const fallbackAngleCap = Math.max(maxAngleDelta, 45);
        const isParallelFallback =
          enableFallback &&
          overlapRatioPct >= fallbackMinRatio &&
          distFeet <= fallbackMaxDistance &&
          angleDelta <= fallbackAngleCap;

        const isHit = isPrimaryMatch || isParallelFallback;
        let qcForThis = "Unmatched";
        if (isPrimaryMatch) qcForThis = "Verified Match";
        else if (isParallelFallback) qcForThis = "Verified Parallel Fallback";
        else if (enableFallback && angleDelta <= fallbackAngleCap) {
          if (overlapRatioPct < fallbackMinRatio) qcForThis = "No Match - Low Target Ratio";
          else if (distFeet > fallbackMaxDistance) qcForThis = "No Match - Distance";
          else qcForThis = "No Match - Low Overlap";
        } else if (angleDelta > maxAngleDelta) qcForThis = "No Match - Angle Mismatch";
        else if (overlapRatioPct < minTargetRatio) qcForThis = "No Match - Low Target Ratio";
        else if (overlapFeet < minOverlapFeet) qcForThis = "No Match - Low Overlap";

        if (overlapFeet > bestCandidateOverlap) {
          bestCandidateOverlap = overlapFeet;
          bestCandidateAngle = angleDelta;
          bestCandidateDist = distFeet;
          if (!isHit) bestMissQc = qcForThis;
        }

        if (isHit) {
          matchOccurrences += 1;
          matchOverlapPieces.push(...overlapOnTarget);
          const tag = this.formatMatchTag(refProps, customTemplate, refColumns)
            || String(refProps._feat_id || refProps._orig_fid || "MATCH");
          matchTags.push(tag);
          if (overlapFeet > bestMatchOverlap) {
            bestMatchOverlap = overlapFeet;
            bestMatchAngle = angleDelta;
            bestMatchDist = distFeet;
            bestMatchQc = qcForThis;
          }
          matchedRefDetails.push({
            tag,
            overlap_ft: Math.round(overlapFeet),
            overlap_pct: Math.round(Math.min(100, overlapRatioPct)),
            angle_diff: angleDelta,
            dist_ft: Math.round(distFeet * 10) / 10,
            rule: isPrimaryMatch ? "Primary Rule" : "Parallel Fallback",
            properties: refProps,
          });
        }
      });
    }

    return this.buildTargetResult(targetFeat, targetProps, {
      matchTags,
      matchedRefDetails,
      matchOverlapPieces,
      matchOccurrences,
      bestMatchAngle,
      bestCandidateAngle,
      bestMatchDist,
      bestCandidateDist,
      bestMatchQc,
      bestMissQc,
      targetLengthFeet,
      keepDuplicates,
      destIdField,
    });
  }

  static buildTargetResult(targetFeat, targetProps, state) {
    const {
      matchTags,
      matchedRefDetails,
      matchOverlapPieces,
      matchOccurrences,
      bestMatchAngle,
      bestCandidateAngle,
      bestMatchDist,
      bestCandidateDist,
      bestMatchQc,
      bestMissQc,
      targetLengthFeet,
      keepDuplicates,
      destIdField,
    } = state;

    const isMatched = matchOccurrences > 0;
    const formattedMatchedId = isMatched
      ? (keepDuplicates ? matchTags : Array.from(new Set(matchTags))).join(", ")
      : "";

    const totalOverlapFeet = this.coveredLengthFeet(targetFeat, matchOverlapPieces);
    const overlapPctFinal = Math.min(100, Math.round((totalOverlapFeet / Math.max(1, targetLengthFeet)) * 100));
    const reportedAngle = isMatched ? bestMatchAngle : bestCandidateAngle;
    const reportedDist = isMatched ? bestMatchDist : bestCandidateDist;

    let qc = isMatched ? bestMatchQc : bestMissQc;
    if (isMatched && !qc) qc = "Verified Match";
    if (!isMatched && !qc) qc = "No Match - No Nearby Reference";

    const enrichedProps = {
      ...targetProps,
      Dest_ID: this.resolveDestId(targetProps, destIdField),
      Match_Stat: isMatched ? "On Corridor" : "Off Corridor",
      Matched_ID: formattedMatchedId,
      Match_Cnt: matchOccurrences,
      Ovl_Ft: Math.round(totalOverlapFeet),
      Ovl_Mi: Math.round((totalOverlapFeet / 5280) * 100) / 100,
      Ovl_Pct: overlapPctFinal,
      Ang_Dif: reportedAngle !== null && reportedAngle < 900 ? reportedAngle : null,
      Min_Ft: reportedDist !== null && reportedDist < 9000 ? Math.round(reportedDist * 10) / 10 : null,
      QC_Flag: qc,
      _matched_refs: matchedRefDetails,
    };

    return {
      isMatched,
      enrichedProps,
      feature: {
        type: "Feature",
        properties: enrichedProps,
        geometry: targetFeat.geometry,
      },
    };
  }

  static async runOverlayAnalysis(targetGeoJSON, refGeoJSON, options = {}, onProgress) {
    const startTime = performance.now();
    const runOptions = {
      bufferFeet: options.buffer_distance ?? 300,
      bufferKm: ((options.buffer_distance ?? 300) * 0.3048) / 1000,
      minOverlapFeet: options.min_overlap_length ?? 300,
      minTargetRatio: options.min_target_overlap_ratio ?? 10,
      maxAngleDelta: options.max_angle_diff_deg ?? 30,
      enableFallback: options.enable_strong_fallback !== false,
      fallbackMinRatio: options.fallback_min_ratio ?? 75,
      fallbackMaxDistance: options.fallback_max_distance ?? 30,
      directed: options.angle_mode === "directed",
      bearingWindowFeet: options.bearing_window_length ?? 500,
      refColumns: options.reference_columns || [],
      customTemplate: options.custom_expression_template || null,
      keepDuplicates: options.keep_duplicates !== false,
      destIdField: options.destination_id_column || "",
    };

    const refFeatures = refGeoJSON.features || [];
    const targetFeatures = targetGeoJSON.features || [];

    if (onProgress) onProgress(4, `Indexing ${refFeatures.length.toLocaleString()} reference segments...`);
    const index = this.buildGridIndex(refFeatures);

    const resultFeatures = [];
    const tableData = [];
    let matchedCount = 0;
    const batchSize = 15;

    for (let i = 0; i < targetFeatures.length; i++) {
      const evaluated = this.evaluateTarget(targetFeatures[i], index, runOptions);
      if (evaluated.isMatched) matchedCount += 1;
      resultFeatures.push(evaluated.feature);
      tableData.push(evaluated.enrichedProps);

      if (i % batchSize === 0) {
        if (onProgress) {
          const pct = 8 + Math.round((i / Math.max(1, targetFeatures.length)) * 88);
          onProgress(pct, `Processing target ${i + 1} of ${targetFeatures.length}...`);
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    const durationSeconds = Math.round(((performance.now() - startTime) / 1000) * 100) / 100;
    const totalTargets = targetFeatures.length;
    const unmatchedCount = totalTargets - matchedCount;
    const matchPercentage = totalTargets > 0 ? Math.round((matchedCount / totalTargets) * 1000) / 10 : 0;

    if (onProgress) onProgress(100, "Complete");

    return {
      success: true,
      stats: {
        total_targets: totalTargets,
        matched_targets: matchedCount,
        unmatched_targets: unmatchedCount,
        match_percentage: matchPercentage,
        duration_seconds: durationSeconds,
      },
      run_options: options,
      table_data: tableData,
      geojson: {
        type: "FeatureCollection",
        name: "Overlay_Results",
        crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
        features: resultFeatures,
      },
    };
  }

  static formatMatchRulesSidecar(meta = {}) {
    const maxAngle = Number(meta.max_angle_diff_deg);
    const fallbackAngle = Number.isFinite(maxAngle) ? Math.max(maxAngle, 45) : 45;
    const fallbackOn = meta.enable_strong_fallback !== false;
    const angleMode = meta.angle_mode === "directed" ? "Check vertex direction (0°–180°)" : "Ignore line direction (0°–90°)";
    const idMode = meta.keep_duplicates === false ? "Unique Matched IDs" : "Keep duplicate Matched IDs";
    const cols = Array.isArray(meta.reference_columns) && meta.reference_columns.length
      ? meta.reference_columns.join(", ")
      : "(none)";
    const lines = [
      "Roadway Line-to-Line Overlay — Match rules",
      "Tool v1.0",
      `Exported: ${meta.ran_at || new Date().toISOString()}`,
      `Destination: ${meta.destination_layer || "-"}`,
      `Reference: ${meta.reference_layer || "-"}`,
      "",
      "Primary (AND)",
      `  Buffer (ft): ${meta.buffer_distance ?? "-"}`,
      `  Min overlap (ft): ${meta.min_overlap_length ?? "-"}`,
      `  Min target ratio (%): ${meta.min_target_overlap_ratio ?? "-"}`,
      `  Max angle (°): ${meta.max_angle_diff_deg ?? "-"}`,
      `  Bearing window (ft): ${meta.bearing_window_length ?? "-"}`,
      `  Angle mode: ${angleMode}`,
      "",
      "Parallel fallback (OR, if primary min-overlap fails)",
      `  Enabled: ${fallbackOn ? "yes" : "no"}`,
      `  Min coverage (%): ${meta.fallback_min_ratio ?? "-"}`,
      `  Max distance (ft): ${meta.fallback_max_distance ?? "-"}`,
      `  Fallback max angle (°): ${fallbackAngle}  (max of Max Angle and 45)`,
      "",
      "Output labels (not used to find the pair)",
      `  Destination ID field: ${meta.destination_id_column || "-"}`,
      `  Reference fields: ${cols}`,
      `  ID expression: ${meta.custom_expression_template || "-"}`,
      `  Several matches: ${idMode}`,
      "",
      "This text is a sidecar in the shapefile zip. It does not change .shp / .shx / .dbf.",
    ];
    return `${lines.join("\r\n")}\r\n`;
  }

  static publicRecord(record) {
    const out = {};
    Object.entries(record || {}).forEach(([key, val]) => {
      if (key.startsWith("_")) return;
      out[key] = val;
    });
    return out;
  }

  static publicRecords(records) {
    return (records || []).map((row) => this.publicRecord(row));
  }

  static publicGeoJSON(geojson) {
    return {
      ...(geojson || {}),
      features: ((geojson && geojson.features) || []).map((feat) => ({
        ...feat,
        properties: this.publicRecord(feat && feat.properties),
      })),
    };
  }

  static exportGeoJSON(geojson, filename = "roadway_overlay_results.geojson") {
    const blob = new Blob([JSON.stringify(this.publicGeoJSON(geojson), null, 2)], { type: "application/json" });
    this.downloadBlob(blob, filename);
  }

  static exportCSV(records, filename = "roadway_overlay_results.csv") {
    const csv = Papa.unparse(this.publicRecords(records));
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    this.downloadBlob(blob, filename);
  }

  static async exportShapefile(geojson, filename = "roadway_overlay_results.zip", layerName = "Roadway_Overlay_Results", extraFiles = []) {
    if (typeof ShapefileExport === "undefined" || typeof ShapefileExport.zipFromGeoJSON !== "function") {
      throw new Error("Shapefile writer is not loaded.");
    }
    const blob = await ShapefileExport.zipFromGeoJSON(geojson, {
      layerName,
      extraFiles,
    });
    this.downloadBlob(blob, filename);
  }

  static exportExcel(records, filename = "roadway_overlay_results.xlsx") {
    if (typeof XLSX === "undefined") {
      throw new Error("SheetJS XLSX library is not loaded.");
    }
    const ws = XLSX.utils.json_to_sheet(this.publicRecords(records));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Overlay Results");
    XLSX.writeFile(wb, filename);
  }

  static downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 150);
  }
}

window.ClientGISEngine = ClientGISEngine;
