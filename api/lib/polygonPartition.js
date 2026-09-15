'use strict';

const polygonClipping = require('polygon-clipping');

const EARTH_RADIUS_METERS = 6371008.8;
const AGGREGATE_MIN_AREA_SQUARE_METERS = 1556.86;

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

function ringAreaSquareMeters(inputRing) {
  const ring = normalizeRing(inputRing);
  const open = ring.slice(0, -1);
  const referenceLatitudeRadians = (open.reduce((sum, point) => sum + point[1], 0) / open.length) * Math.PI / 180;
  const cosLatitude = Math.cos(referenceLatitudeRadians);
  let twiceArea = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const [lon1, lat1] = ring[index];
    const [lon2, lat2] = ring[index + 1];
    const x1 = EARTH_RADIUS_METERS * (lon1 * Math.PI / 180) * cosLatitude;
    const y1 = EARTH_RADIUS_METERS * (lat1 * Math.PI / 180);
    const x2 = EARTH_RADIUS_METERS * (lon2 * Math.PI / 180) * cosLatitude;
    const y2 = EARTH_RADIUS_METERS * (lat2 * Math.PI / 180);
    twiceArea += (x1 * y2) - (x2 * y1);
  }

  return Math.abs(twiceArea / 2);
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

function validateAggregateParts(parts, originalAreaSquareMeters, minimumAreaSquareMeters, metadata = {}) {
  const partAreasSquareMeters = parts.map((part) => ringAreaSquareMeters(part));
  const undersizedIndexes = partAreasSquareMeters
    .map((area, index) => ({ area, index }))
    .filter(({ area }) => area < minimumAreaSquareMeters)
    .map(({ index }) => index);

  if (undersizedIndexes.length > 0) {
    return Object.freeze({
      allowed: false,
      reason: 'aggregate_partition_would_create_undersized_component',
      ...metadata,
      originalAreaSquareMeters,
      minimumAreaSquareMeters,
      parts: Object.freeze([]),
      partAreasSquareMeters: Object.freeze(partAreasSquareMeters),
      undersizedIndexes: Object.freeze(undersizedIndexes),
    });
  }

  return Object.freeze({
    allowed: true,
    reason: null,
    ...metadata,
    originalAreaSquareMeters,
    minimumAreaSquareMeters,
    parts: Object.freeze(parts),
    partAreasSquareMeters: Object.freeze(partAreasSquareMeters),
    undersizedIndexes: Object.freeze([]),
  });
}

function splitRingIntoStripsForAggregate(inputRing, requestedStripCount, options = {}) {
  const minimumAreaSquareMeters = Number(options.minimumAreaSquareMeters ?? AGGREGATE_MIN_AREA_SQUARE_METERS);
  if (!Number.isFinite(minimumAreaSquareMeters) || minimumAreaSquareMeters <= 0) {
    throw new Error('invalid_minimum_area_square_meters');
  }

  const stripCount = Number(requestedStripCount);
  if (!Number.isInteger(stripCount) || stripCount < 2) throw new Error('invalid_strip_count');

  const ring = normalizeRing(inputRing);
  const originalAreaSquareMeters = ringAreaSquareMeters(ring);
  if (originalAreaSquareMeters < minimumAreaSquareMeters) {
    return Object.freeze({
      allowed: false,
      reason: 'aggregate_polygon_below_minimum_area',
      originalAreaSquareMeters,
      minimumAreaSquareMeters,
      parts: Object.freeze([]),
      partAreasSquareMeters: Object.freeze([]),
    });
  }

  const bounds = boundsOfRing(ring);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (!(width > 0) || !(height > 0)) throw new Error('degenerate_polygon');

  const axis = width >= height ? 'X' : 'Y';
  const span = axis === 'X' ? width : height;
  const margin = Math.max(width, height) + 1;
  const subject = [ring];
  const parts = [];
  const cuts = [];

  for (let index = 0; index < stripCount; index += 1) {
    const start = (axis === 'X' ? bounds.minX : bounds.minY) + (span * index / stripCount);
    const end = (axis === 'X' ? bounds.minX : bounds.minY) + (span * (index + 1) / stripCount);
    cuts.push([start, end]);

    const clip = axis === 'X'
      ? rectangle(start, bounds.minY - margin, end, bounds.maxY + margin)
      : rectangle(bounds.minX - margin, start, bounds.maxX + margin, end);
    const stripParts = exteriorRingsFromMultiPolygon(polygonClipping.intersection(subject, clip));
    parts.push(...stripParts);
  }

  if (parts.length < 2) {
    return Object.freeze({
      allowed: false,
      reason: 'aggregate_polygon_split_invalid',
      axis,
      stripCount,
      cuts: Object.freeze(cuts),
      originalAreaSquareMeters,
      minimumAreaSquareMeters,
      parts: Object.freeze([]),
      partAreasSquareMeters: Object.freeze([]),
    });
  }

  return validateAggregateParts(parts, originalAreaSquareMeters, minimumAreaSquareMeters, {
    axis,
    stripCount,
    cuts: Object.freeze(cuts),
  });
}

function splitRingForAggregate(inputRing, options = {}) {
  const minimumAreaSquareMeters = Number(options.minimumAreaSquareMeters ?? AGGREGATE_MIN_AREA_SQUARE_METERS);
  if (!Number.isFinite(minimumAreaSquareMeters) || minimumAreaSquareMeters <= 0) {
    throw new Error('invalid_minimum_area_square_meters');
  }

  const ring = normalizeRing(inputRing);
  const originalAreaSquareMeters = ringAreaSquareMeters(ring);
  if (originalAreaSquareMeters < minimumAreaSquareMeters) {
    return Object.freeze({
      allowed: false,
      reason: 'aggregate_polygon_below_minimum_area',
      originalAreaSquareMeters,
      minimumAreaSquareMeters,
      parts: Object.freeze([]),
      partAreasSquareMeters: Object.freeze([]),
    });
  }

  const split = splitRingAtMidpoint(ring);
  return validateAggregateParts(split.parts, originalAreaSquareMeters, minimumAreaSquareMeters, {
    axis: split.axis,
    split: split.split,
  });
}

module.exports = {
  AGGREGATE_MIN_AREA_SQUARE_METERS,
  boundsOfRing,
  exteriorRingsFromMultiPolygon,
  normalizeRing,
  ringAreaSquareMeters,
  splitRingAtMidpoint,
  splitRingForAggregate,
  splitRingIntoStripsForAggregate,
};
