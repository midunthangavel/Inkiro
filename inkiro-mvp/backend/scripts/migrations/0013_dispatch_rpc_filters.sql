-- ─── Migration 0013: fix dispatch RPCs to exclude blocked actors ───────────────
-- Fixes W-03: get_nearby_shops and get_nearby_runners were missing is_blocked
-- filters, so blocked shops/runners still received dispatch events.
-- Also adds a 5-minute staleness filter to get_nearby_runners.

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
  WHERE is_active                = TRUE
    AND COALESCE(is_blocked, FALSE) = FALSE
    AND location                 IS NOT NULL
    AND ST_DWithin(
          location,
          ST_Point(origin_lng, origin_lat)::geography,
          radius_km * 1000.0
        )
  ORDER BY distance_m;
$$;

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
  WHERE is_available                = TRUE
    AND COALESCE(is_blocked, FALSE) = FALSE
    AND last_seen_at                >= NOW() - INTERVAL '5 minutes'
    AND location                    IS NOT NULL
    AND ST_DWithin(
          location,
          ST_Point(origin_lng, origin_lat)::geography,
          radius_km * 1000.0
        )
  ORDER BY distance_m
  LIMIT max_results;
$$;
