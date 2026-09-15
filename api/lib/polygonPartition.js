'use strict';

const polygonClipping = require('polygon-clipping');

function normalizeRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) throw new Error('invalid_polygon_ring');
  const points = ring.map((point) => {
    if (!Array.isArray(point) || point.length < 2) throw new Error('invalid_polygon_coordinate');
    const x = Number(point[0]);
    const y = Number(point[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('invalid_polygon_coordinate');
    return [x, y];
  });
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) points.push([...first]);
  return points;
}

function boundsOfRing(ring) {
  const open = ring.slice(0, -1);
  return open.reduce((acc, [x, y]) => ({
    minX: Math.min(acc.minX, x),
    maxX: Math.max(acc.maxX, x),
    minY: Math.min(acc.minY, y),
    maxY: Math.max(acc.maxY, y),
  }), {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  });
}

function rectangle(minX, minY, maxX, maxY) {
  return [[
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY],
  ]];
}

function exteriorRingsFromMultiPolygon(multiPolygon) {
  const rings = [];
  for (const polygon of multiPolygon || []) {
    if (!Array.isArray(polygon) || polygon.length === 0) continue;
    rings.push(normalizeRing(polygon[0]));
  }
  return rings;
}

function splitRingAtMidpoint(inputRing) {
  const ring = normalizeRing(inputRing);
  const bounds = boundsOfRing(ring);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (!(width > 0) || !(height > 0)) throw new Error('degenerate_polygon');

  const margin = Math.max(width, height) + 1;
  const subject = [ring];
  let aClip;
  let bClip;
  let axis;
  let split;

  if (width >= height) {
    axis = 'X';
    split = (bounds.minX + bounds.maxX) / 2;
    aClip = rectangle(bounds.minX - margin, bounds.minY - margin, split, bounds.maxY + margin);
    bClip = rectangle(split, bounds.minY - margin, bounds.maxX + margin, bounds.maxY + margin);
  } else {
    axis = 'Y';
    split = (bounds.minY + bounds.maxY) / 2;
    aClip = rectangle(bounds.minX - margin, bounds.minY - margin, bounds.maxX + margin, split);
    bClip = rectangle(bounds.minX - margin, split, bounds.maxX + margin, bounds.maxY + margin);
  }

  const a = exteriorRingsFromMultiPolygon(polygonClipping.intersection(subject, aClip));
  const b = exteriorRingsFromMultiPolygon(polygonClipping.intersection(subject, bClip));

  return Object.freeze({
    axis,
    split,
    parts: Object.freeze([...a, ...b]),
    sideA: Object.freeze(a),
    sideB: Object.freeze(b),
  });
}

module.exports = {
  boundsOfRing,
  exteriorRingsFromMultiPolygon,
  normalizeRing,
  splitRingAtMidpoint,
};
