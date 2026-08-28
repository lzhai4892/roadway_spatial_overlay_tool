/**
 * ArcGIS-safe PolyLine shapefile writer.
 *
 * @mapbox/shp-write 0.4.3 wraps every LineString into ONE polyline
 * (`geometries: [allLineCoords]`) while still writing one DBF row per
 * feature. ArcGIS then shows the attribute table but only one geometry
 * (or a garbled draw) because .shp and .dbf record counts do not match.
 *
 * This writer emits one PolyLine + one DBF + one SHX row per feature.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) root.ShapefileExport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SHAPE_POLYLINE = 3;
  const WGS84_PRJ =
    'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

  function concat(parts) {
    let size = 0;
    for (let i = 0; i < parts.length; i += 1) size += parts[i].length;
    const out = new Uint8Array(size);
    let offset = 0;
    for (let i = 0; i < parts.length; i += 1) {
      out.set(parts[i], offset);
      offset += parts[i].length;
    }
    return out;
  }

  function be32(value) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setInt32(0, value, false);
    return bytes;
  }

  function le32(value) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setInt32(0, value, true);
    return bytes;
  }

  function le64f(value) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    return bytes;
  }

  function emptyBBox() {
    return { xmin: Infinity, ymin: Infinity, xmax: -Infinity, ymax: -Infinity };
  }

  function expandBBox(bbox, x, y) {
    if (x < bbox.xmin) bbox.xmin = x;
    if (y < bbox.ymin) bbox.ymin = y;
    if (x > bbox.xmax) bbox.xmax = x;
    if (y > bbox.ymax) bbox.ymax = y;
  }

  function mergeBBox(target, src) {
    expandBBox(target, src.xmin, src.ymin);
    expandBBox(target, src.xmax, src.ymax);
  }

  function xyPoint(coord) {
    if (!coord || coord.length < 2) return null;
    const x = Number(coord[0]);
    const y = Number(coord[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return [x, y];
  }

  function cleanLine(coords) {
    const line = [];
    for (let i = 0; i < (coords || []).length; i += 1) {
      const point = xyPoint(coords[i]);
      if (point) line.push(point);
    }
    return line.length >= 2 ? line : null;
  }

  function lineParts(geometry) {
    if (!geometry) return null;
    if (geometry.type === "LineString") {
      const line = cleanLine(geometry.coordinates);
      return line ? [line] : null;
    }
    if (geometry.type === "MultiLineString") {
      const parts = [];
      for (let i = 0; i < (geometry.coordinates || []).length; i += 1) {
        const line = cleanLine(geometry.coordinates[i]);
        if (line) parts.push(line);
      }
      return parts.length ? parts : null;
    }
    return null;
  }

  function safeName(name, used) {
    const cleaned = String(name).replace(/[^\w]/g, "_").replace(/^_+/, "") || "FIELD";
    let base = cleaned.slice(0, 10);
    if (!used.has(base.toUpperCase())) {
      used.add(base.toUpperCase());
      return base;
    }
    let i = 1;
    while (i < 100) {
      const suffix = `_${i}`;
      const next = `${cleaned.slice(0, Math.max(1, 10 - suffix.length))}${suffix}`;
      if (!used.has(next.toUpperCase())) {
        used.add(next.toUpperCase());
        return next;
      }
      i += 1;
    }
    return `${base.slice(0, 8)}_X`;
  }

  function safeValue(val) {
    if (val === null || val === undefined) return "";
    if (typeof val === "number") return Number.isFinite(val) ? val : "";
    if (typeof val === "boolean") return val ? 1 : 0;
    const text = String(val);
    return text.length > 254 ? text.slice(0, 254) : text;
  }

  function sanitizeFeatures(geojson) {
    const used = new Set();
    const rename = {};
    const features = [];
    (geojson && geojson.features ? geojson.features : []).forEach((feat) => {
      const parts = lineParts(feat && feat.geometry);
      if (!parts) return;
      const props = {};
      Object.entries((feat && feat.properties) || {}).forEach(([key, val]) => {
        if (key.startsWith("_") || val === undefined || typeof val === "object") return;
        if (!rename[key]) rename[key] = safeName(key, used);
        props[rename[key]] = safeValue(val);
      });
      features.push({ properties: props, parts });
    });
    return features;
  }

  function classifyField(values) {
    let hasText = false;
    let hasInt = false;
    let hasFloat = false;
    let maxText = 1;
    for (let i = 0; i < values.length; i += 1) {
      const val = values[i];
      if (val === "" || val === null || val === undefined) continue;
      if (typeof val === "number" && Number.isFinite(val)) {
        if (Number.isInteger(val)) hasInt = true;
        else hasFloat = true;
      } else {
        hasText = true;
        maxText = Math.max(maxText, String(val).length);
      }
    }
    if (hasText) return { type: "C", width: Math.min(254, maxText), dec: 0 };
    if (hasFloat) return { type: "N", width: 18, dec: 6 };
    if (hasInt) return { type: "N", width: 18, dec: 0 };
    return { type: "C", width: 8, dec: 0 };
  }

  function formatNumber(val, width, dec) {
    if (val === "" || val === null || val === undefined || !Number.isFinite(Number(val))) {
      return " ".repeat(width);
    }
    const num = Number(val);
    let text = dec > 0 ? num.toFixed(dec) : String(Math.trunc(num));
    if (text.length > width) {
      text = dec > 0 ? num.toFixed(Math.max(0, width - 8)) : text;
    }
    if (text.length > width) text = text.slice(0, width);
    return text.padStart(width, " ");
  }

  function buildFields(features) {
    const names = [];
    const seen = new Set();
    features.forEach((feat) => {
      Object.keys(feat.properties || {}).forEach((key) => {
        if (!seen.has(key)) {
          seen.add(key);
          names.push(key);
        }
      });
    });
    return names.map((name) => {
      const values = features.map((feat) => (feat.properties || {})[name]);
      return { name, ...classifyField(values) };
    });
  }

  function writeDbf(fields, features) {
    const recLen = 1 + fields.reduce((sum, field) => sum + field.width, 0);
    const headerLen = 32 + 32 * fields.length + 1;
    const nrec = features.length;
    const out = new Uint8Array(headerLen + recLen * nrec + 1);
    const view = new DataView(out.buffer);
    const now = new Date();
    out[0] = 0x03;
    out[1] = now.getFullYear() - 1900;
    out[2] = now.getMonth() + 1;
    out[3] = now.getDate();
    view.setUint32(4, nrec, true);
    view.setUint16(8, headerLen, true);
    view.setUint16(10, recLen, true);

    fields.forEach((field, i) => {
      const offset = 32 + i * 32;
      const name = field.name.slice(0, 10);
      for (let k = 0; k < name.length; k += 1) out[offset + k] = name.charCodeAt(k);
      out[offset + 11] = field.type.charCodeAt(0);
      out[offset + 16] = field.width;
      out[offset + 17] = field.dec || 0;
    });
    out[32 + fields.length * 32] = 0x0d;

    const encoder = new TextEncoder();
    let pos = headerLen;
    features.forEach((feat) => {
      out[pos] = 0x20;
      pos += 1;
      fields.forEach((field) => {
        const raw = (feat.properties || {})[field.name];
        if (field.type === "N") {
          const text = formatNumber(raw, field.width, field.dec);
          for (let i = 0; i < field.width; i += 1) out[pos + i] = text.charCodeAt(i);
        } else {
          const bytes = encoder.encode(raw == null ? "" : String(raw));
          out.fill(0x20, pos, pos + field.width);
          out.set(bytes.subarray(0, field.width), pos);
        }
        pos += field.width;
      });
    });
    out[pos] = 0x1a;
    return out;
  }

  function writePolylineRecord(recordNumber, parts) {
    const points = [];
    const partIndex = [];
    const bbox = emptyBBox();
    parts.forEach((part) => {
      partIndex.push(points.length);
      part.forEach((pt) => {
        points.push(pt);
        expandBBox(bbox, pt[0], pt[1]);
      });
    });
    const content = concat([
      le32(SHAPE_POLYLINE),
      le64f(bbox.xmin),
      le64f(bbox.ymin),
      le64f(bbox.xmax),
      le64f(bbox.ymax),
      le32(partIndex.length),
      le32(points.length),
      ...partIndex.map(le32),
      ...points.flatMap((pt) => [le64f(pt[0]), le64f(pt[1])]),
    ]);
    const bytes = concat([be32(recordNumber), be32(content.length / 2), content]);
    return { bytes, contentWords: content.length / 2, bbox };
  }

  function writeHeader(fileLengthWords, bbox) {
    const header = new Uint8Array(100);
    const view = new DataView(header.buffer);
    view.setInt32(0, 9994, false);
    view.setInt32(24, fileLengthWords, false);
    view.setInt32(28, 1000, true);
    view.setInt32(32, SHAPE_POLYLINE, true);
    const safe = Number.isFinite(bbox.xmin)
      ? bbox
      : { xmin: 0, ymin: 0, xmax: 0, ymax: 0 };
    view.setFloat64(36, safe.xmin, true);
    view.setFloat64(44, safe.ymin, true);
    view.setFloat64(52, safe.xmax, true);
    view.setFloat64(60, safe.ymax, true);
    return header;
  }

  function buildFromGeoJSON(geojson, options = {}) {
    const layerName = options.layerName || "Roadway_Overlay_Results";
    const features = sanitizeFeatures(geojson);
    if (!features.length) {
      throw new Error("No line features available to export as shapefile.");
    }

    const records = [];
    const fileBBox = emptyBBox();
    features.forEach((feat, i) => {
      const rec = writePolylineRecord(i + 1, feat.parts);
      mergeBBox(fileBBox, rec.bbox);
      records.push(rec);
    });

    let shpBody = 0;
    records.forEach((rec) => {
      shpBody += rec.bytes.length;
    });
    const shpWords = (100 + shpBody) / 2;
    const shxWords = (100 + records.length * 8) / 2;
    const shpChunks = [writeHeader(shpWords, fileBBox)];
    const shxChunks = [writeHeader(shxWords, fileBBox)];
    let offsetWords = 50;
    records.forEach((rec) => {
      shpChunks.push(rec.bytes);
      shxChunks.push(concat([be32(offsetWords), be32(rec.contentWords)]));
      offsetWords += rec.bytes.length / 2;
    });

    return {
      name: layerName,
      count: features.length,
      shp: concat(shpChunks),
      shx: concat(shxChunks),
      dbf: writeDbf(buildFields(features), features),
      prj: WGS84_PRJ,
      cpg: "UTF-8",
    };
  }

  async function zipFromGeoJSON(geojson, options = {}) {
    if (typeof JSZip === "undefined") {
      throw new Error("JSZip is not loaded.");
    }
    const files = buildFromGeoJSON(geojson, options);
    const zip = new JSZip();
    zip.file(`${files.name}.shp`, files.shp);
    zip.file(`${files.name}.shx`, files.shx);
    zip.file(`${files.name}.dbf`, files.dbf);
    zip.file(`${files.name}.prj`, files.prj);
    zip.file(`${files.name}.cpg`, files.cpg);
    (options.extraFiles || []).forEach((extra) => {
      if (!extra || !extra.name || extra.content == null) return;
      zip.file(String(extra.name), extra.content);
    });
    return zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
    });
  }

  return {
    WGS84_PRJ,
    safeName,
    sanitizeFeatures,
    buildFromGeoJSON,
    zipFromGeoJSON,
  };
});
