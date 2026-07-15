'use strict';

const EARTH_RADIUS_KM = 6371;

/**
 * Calculates the great-circle distance between two points on Earth
 * using the Haversine formula.
 *
 * @param {number} lat1 - Latitude of point 1 (degrees)
 * @param {number} lon1 - Longitude of point 1 (degrees)
 * @param {number} lat2 - Latitude of point 2 (degrees)
 * @param {number} lon2 - Longitude of point 2 (degrees)
 * @returns {number} Distance in kilometres (floating point)
 */
function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

/**
 * Filters an array of entities that have `lat` and `lng` fields,
 * returning only those within `radiusKm` of the origin point,
 * sorted by distance ascending, with a `distance_km` field attached.
 *
 * @param {number} originLat
 * @param {number} originLng
 * @param {Array<{lat: number, lng: number}>} entities
 * @param {number} radiusKm
 * @returns {Array} Filtered and sorted entities with `distance_km` added
 */
function filterByRadius(originLat, originLng, entities, radiusKm) {
  return entities
    .map((entity) => ({
      ...entity,
      distance_km: haversine(originLat, originLng, entity.lat, entity.lng),
    }))
    .filter((entity) => entity.distance_km <= radiusKm)
    .sort((a, b) => a.distance_km - b.distance_km);
}

module.exports = { haversine, filterByRadius };
