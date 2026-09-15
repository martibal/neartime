'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { splitRingAtMidpoint } = require('./lib/polygonPartition');

function signedArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += (x1 * y2) - (x2 * y1);
  }
  return sum / 2;
}

function absoluteArea(ring) {
  return Math.abs(signedArea(ring));
}

function orientation(a, b, c) {
  const value = ((b[1] - a[1]) * (c[0] - b[0])) - ((b[0] - a[0]) * (c[1] - b[1]));
  if (Math.abs(value) < 1e-12) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a, b, c) {
  return b[0] <= Math.max(a[0], c[0]) + 1e-12 &&
    b[0] + 1e-12 >= Math.min(a[0], c[0]) &&
    b[1] <= Math.max(a[1], c[1]) + 1e-12 &&
    b[1] + 1e-12 >= Math.min(a[1], c[1]);
}

function segmentsIntersect(p1, q1, p2, q2) {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

function assertSimpleRing(ring) {
  const edgeCount = ring.length - 1;
  for (let i = 0; i < edgeCount; i += 1) {
    const a1 = ring[i];
    const a2 = ring[i + 1];
    for (let j = i + 1; j < edgeCount; j += 1) {
      if (j === i || j === i + 1 || (i === 0 && j === edgeCount - 1)) continue;
      const b1 = ring[j];
      const b2 = ring[j + 1];
      assert.equal(segmentsIntersect(a1, a2, b1, b2), false, `non-adjacent edges ${i} and ${j} intersect`);
    }
  }
}

test('robust split preserves area and emits separate simple components for a concave polygon', () => {
  // U-shape. A horizontal midpoint cut intersects the lower half in two
  // disconnected components; a naive clipper commonly stitches these together.
  const ring = [
    [0, 0],
    [2, 0],
    [2, 3],
    [4, 3],
    [4, 0],
    [6, 0],
    [6, 4],
    [0, 4],
    [0, 0],
  ];

  const result = splitRingAtMidpoint(ring);

  assert.equal(result.axis, 'X');
  assert.ok(result.parts.length >= 2);

  const totalPartArea = result.parts.reduce((sum, part) => sum + absoluteArea(part), 0);
  assert.ok(Math.abs(totalPartArea - absoluteArea(ring)) < 1e-9);

  for (const part of result.parts) {
    assert.ok(part.length >= 4);
    assert.deepEqual(part[0], part[part.length - 1]);
    assertSimpleRing(part);
  }
});

test('actual Oslo isochrone-shaped concave ring splits without self-intersections', () => {
  const ring = [
    [10.763223696233673, 59.90797440458109],
    [10.764460162774169, 59.910795883738189],
    [10.76569686420566, 59.9136174076784],
    [10.763421926735722, 59.913805014543478],
    [10.764040241079938, 59.915215809303156],
    [10.761765205112551, 59.915403388725288],
    [10.762383453703812, 59.916814210674687],
    [10.760108319232383, 59.917001762650038],
    [10.760726502054583, 59.918412611785833],
    [10.758451269072516, 59.918600136310573],
    [10.75906938610955, 59.920011012629367],
    [10.754518749118011, 59.92038596332047],
    [10.749968216191185, 59.920760740220381],
    [10.749350597239475, 59.9193497999496],
    [10.747075494350664, 59.919537107253014],
    [10.746458058591815, 59.918126162198185],
    [10.744183106268245, 59.918313410088352],
    [10.742948659721096, 59.915491521631431],
    [10.745223363038573, 59.915304305685154],
    [10.744606103228389, 59.913893394232566],
    [10.746880708114878, 59.913706150831025],
    [10.746263382464802, 59.912295266556541],
    [10.745028907066683, 59.909473531633409],
    [10.749577448215746, 59.909099010401761],
    [10.750194905497279, 59.910509840309942],
    [10.752469339575006, 59.910322498586233],
    [10.754743799677083, 59.910135113437661],
    [10.754126093508567, 59.908724315491696],
    [10.7586748428722, 59.908349446889417],
    [10.763223696233673, 59.90797440458109],
  ];

  const result = splitRingAtMidpoint(ring);
  const originalArea = absoluteArea(ring);
  const splitArea = result.parts.reduce((sum, part) => sum + absoluteArea(part), 0);

  assert.ok(result.parts.length >= 2);
  assert.ok(Math.abs(splitArea - originalArea) < 1e-10);
  for (const part of result.parts) assertSimpleRing(part);
});
