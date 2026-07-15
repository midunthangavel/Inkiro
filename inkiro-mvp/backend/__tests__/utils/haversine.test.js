'use strict';

const { haversine, filterByRadius } = require('../../src/utils/haversine');

const ORIGIN_LAT = 11.0168; // Coimbatore city centre
const ORIGIN_LNG = 76.9558;

// ─── haversine() ──────────────────────────────────────────────────────────────

describe('haversine()', () => {
  test('same point returns 0', () => {
    expect(haversine(ORIGIN_LAT, ORIGIN_LNG, ORIGIN_LAT, ORIGIN_LNG)).toBe(0);
  });

  test('~1 km north (≈0.009° lat) is between 0.9 and 1.1 km', () => {
    const dist = haversine(ORIGIN_LAT, ORIGIN_LNG, ORIGIN_LAT + 0.009, ORIGIN_LNG);
    expect(dist).toBeGreaterThan(0.9);
    expect(dist).toBeLessThan(1.1);
  });

  test('Coimbatore → Chennai is approximately 427 km', () => {
    const dist = haversine(ORIGIN_LAT, ORIGIN_LNG, 13.0827, 80.2707);
    expect(dist).toBeGreaterThan(410);
    expect(dist).toBeLessThan(450);
  });

  test('distance is symmetric (A→B equals B→A)', () => {
    const d1 = haversine(11.0, 77.0, 13.08, 80.27);
    const d2 = haversine(13.08, 80.27, 11.0, 77.0);
    expect(d1).toBeCloseTo(d2, 8);
  });

  test('return value is a number', () => {
    expect(typeof haversine(0, 0, 1, 1)).toBe('number');
  });
});

// ─── filterByRadius() ─────────────────────────────────────────────────────────

describe('filterByRadius()', () => {
  const shops = [
    { id: 'near',   lat: ORIGIN_LAT + 0.009, lng: ORIGIN_LNG }, // ~1 km
    { id: 'medium', lat: ORIGIN_LAT + 0.018, lng: ORIGIN_LNG }, // ~2 km
    { id: 'far',    lat: 13.0827,            lng: 80.2707     }, // ~490 km
  ];

  test('returns only entities within the radius', () => {
    const result = filterByRadius(ORIGIN_LAT, ORIGIN_LNG, shops, 1.5);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('near');
  });

  test('returns all entities when radius is large enough', () => {
    const result = filterByRadius(ORIGIN_LAT, ORIGIN_LNG, shops, 600);
    expect(result).toHaveLength(3);
  });

  test('results are sorted by distance ascending', () => {
    const result = filterByRadius(ORIGIN_LAT, ORIGIN_LNG, shops, 600);
    expect(result[0].id).toBe('near');
    expect(result[1].id).toBe('medium');
    expect(result[2].id).toBe('far');
  });

  test('attaches distance_km to each returned entity', () => {
    const result = filterByRadius(ORIGIN_LAT, ORIGIN_LNG, shops, 600);
    for (const entity of result) {
      expect(typeof entity.distance_km).toBe('number');
      expect(entity.distance_km).toBeGreaterThanOrEqual(0);
    }
  });

  test('returns empty array when nothing is within radius', () => {
    const result = filterByRadius(ORIGIN_LAT, ORIGIN_LNG, shops, 0.5);
    expect(result).toHaveLength(0);
  });

  test('does not mutate the original entity objects', () => {
    const original = [{ id: 'x', lat: ORIGIN_LAT, lng: ORIGIN_LNG }];
    filterByRadius(ORIGIN_LAT, ORIGIN_LNG, original, 10);
    expect(original[0]).not.toHaveProperty('distance_km');
  });

  test('handles empty input array', () => {
    expect(filterByRadius(ORIGIN_LAT, ORIGIN_LNG, [], 10)).toEqual([]);
  });
});
