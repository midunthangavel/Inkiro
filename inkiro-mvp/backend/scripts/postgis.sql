-- ─── PostGIS Spatial Extension: Inkiro MVP ─────────────────────────────────────
--
-- Run AFTER schema.sql and rls.sql in the Supabase SQL editor.
-- Safe to re-run — every statement uses IF NOT EXISTS / OR REPLACE / DROP IF EXISTS.
--
-- What this script does:
--   1. Enables the PostGIS extension.
--   2. Adds a GEOGRAPHY(POINT, 4326) column to shops and runners.
--   3. Creates GiST spatial indexes for fast radius searches.
--   4. Backfills the new columns from existing lat/lng data.
--   5. Adds BEFORE INSERT OR UPDATE triggers to keep location in sync.
--   6. Creates two proximity-query functions used by orderService.js:
--        get_nearby_shops   — called from confirmOrder and expireStaleOrders
--        get_nearby_runners — called from _dispatchRunners
--
-- Coordinate convention: PostGIS uses (longitude, latitude) order everywhere.
-- ST_DWithin on GEOGRAPHY measures distance in metres; we convert km × 1000.

-- ─── 1. Extension ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS postgis;

-- ─── 2. Geography columns ─────────────────────────────────────────────────────
-- GEOGRAPHY(POINT, 4326) uses the WGS-84 ellipsoid, so ST_DWithin distances
-- are in metres and automatically account for Earth's curvature — no haversine
-- approximation needed at the query layer.

ALTER TABLE shops   ADD COLUMN IF NOT EXISTS location GEOGRAPHY(POINT, 4326);
ALTER TABLE runners ADD COLUMN IF NOT EXISTS location GEOGRAPHY(POINT, 4326);

-- ─── 3. Spatial indexes ───────────────────────────────────────────────────────
-- GiST indexes enable bounding-box pruning before the exact distance check,
-- making ST_DWithin queries O(log n) rather than a full table scan.

CREATE INDEX IF NOT EXISTS idx_shops_location
  ON shops USING GIST (location);

CREATE INDEX IF NOT EXISTS idx_runners_location
  ON runners USING GIST (location);

-- ─── 4. Backfill existing rows ─────────────────────────────────────────────────
-- Populates location from existing lat/lng (shops) and current_lat/current_lng
-- (runners). Rows already populated are left untouched.

UPDATE shops
SET    location = ST_Point(lng, lat)::geography   -- ST_Point(longitude, latitude)
WHERE  location IS NULL;

UPDATE runners
SET    location = ST_Point(current_lng, current_lat)::geography
WHERE  location IS NULL
  AND  current_lat IS NOT NULL
  AND  current_lng IS NOT NULL;

-- ─── 5. Sync triggers ─────────────────────────────────────────────────────────
-- Keep location current whenever lat/lng or current_lat/current_lng are written.
-- The backend retains the scalar columns for backward compatibility with
-- non-spatial queries and the admin dashboard.

CREATE OR REPLACE FUNCTION _sync_shop_location()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.location := ST_Point(NEW.lng, NEW.lat)::geography;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_shop_location ON shops;
CREATE TRIGGER trg_sync_shop_location
  BEFORE INSERT OR UPDATE OF lat, lng ON shops
  FOR EACH ROW EXECUTE FUNCTION _sync_shop_location();

-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _sync_runner_location()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_lat IS NOT NULL AND NEW.current_lng IS NOT NULL THEN
    NEW.location := ST_Point(NEW.current_lng, NEW.current_lat)::geography;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_runner_location ON runners;
CREATE TRIGGER trg_sync_runner_location
  BEFORE INSERT OR UPDATE OF current_lat, current_lng ON runners
  FOR EACH ROW EXECUTE FUNCTION _sync_runner_location();

-- ─── 6. Proximity query functions ─────────────────────────────────────────────

-- get_nearby_shops
-- Returns active shops within radius_km of the given point, ordered by distance.
-- Called by confirmOrder (initial broadcast radius) and expireStaleOrders
-- (escalation radius). SECURITY INVOKER means Phase 1 anon RLS still applies
-- when called via anonDb; service-role calls bypass RLS as normal.

CREATE OR REPLACE FUNCTION get_nearby_shops(
  origin_lat FLOAT8,
  origin_lng FLOAT8,
  radius_km  FLOAT8
)
RETURNS TABLE (
  id         UUID,
  user_id    UUID,
  shop_name  TEXT,
  address    TEXT,
  lat        FLOAT8,
  lng        FLOAT8,
  is_active  BOOLEAN,
  created_at TIMESTAMPTZ,
  distance_m FLOAT8
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    id,
    user_id,
    shop_name,
    address,
    lat,
    lng,
    is_active,
    created_at,
    ST_Distance(
      location,
      ST_Point(origin_lng, origin_lat)::geography
    ) AS distance_m
  FROM shops
  WHERE is_active  = TRUE
    AND location   IS NOT NULL
    AND ST_DWithin(
          location,
          ST_Point(origin_lng, origin_lat)::geography,
          radius_km * 1000.0            -- km → metres
        )
  ORDER BY distance_m;
$$;

-- ──────────────────────────────────────────────────────────────────────────────

-- get_nearby_runners
-- Returns available runners within radius_km, ordered by distance, capped at
-- max_results (default 5 = RUNNER_MAX_PER_DISPATCH). Called exclusively via
-- the service-role client (db) so it sees all runners regardless of RLS.

CREATE OR REPLACE FUNCTION get_nearby_runners(
  origin_lat  FLOAT8,
  origin_lng  FLOAT8,
  radius_km   FLOAT8,
  max_results INT DEFAULT 5
)
RETURNS TABLE (
  id          UUID,
  user_id     UUID,
  current_lat FLOAT8,
  current_lng FLOAT8,
  distance_m  FLOAT8
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    id,
    user_id,
    current_lat,
    current_lng,
    ST_Distance(
      location,
      ST_Point(origin_lng, origin_lat)::geography
    ) AS distance_m
  FROM runners
  WHERE is_available = TRUE
    AND location     IS NOT NULL
    AND ST_DWithin(
          location,
          ST_Point(origin_lng, origin_lat)::geography,
          radius_km * 1000.0
        )
  ORDER BY distance_m
  LIMIT max_results;
$$;
