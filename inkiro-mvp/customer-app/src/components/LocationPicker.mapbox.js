import { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import * as Location from 'expo-location';
import Constants from 'expo-constants';

// ── Token setup ────────────────────────────────────────────────────────────────
const MAPBOX_TOKEN = Constants.expoConfig?.extra?.mapboxPublicToken ?? '';
MapboxGL.setAccessToken(MAPBOX_TOKEN);

// Fallback centre: Chennai (used only if GPS is denied and no initialLat/Lng)
const FALLBACK_COORD = [80.2707, 13.0827]; // [lng, lat]
const DEBOUNCE_MS = 600;

async function reverseGeocode(lng, lat) {
  try {
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/` +
      `${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=address,place,neighborhood`;
    const res  = await fetch(url);
    const json = await res.json();
    return json.features?.[0]?.place_name ?? '';
  } catch {
    return '';
  }
}

/**
 * LocationPicker — floating-pin map component.
 *
 * The map moves under a fixed centre pin (📍).
 * When the camera stops, reverse geocoding fires and onLocationSelect is called.
 *
 * Props:
 *   initialLat   {number}  optional — starting latitude
 *   initialLng   {number}  optional — starting longitude
 *   onLocationSelect  {({ lat, lng, address }) => void}  required
 *   height       {number}  map height in px (default 200)
 */
export default function LocationPicker({
  initialLat,
  initialLng,
  onLocationSelect,
  height = 200,
}) {
  const cameraRef    = useRef(null);
  const debounceRef  = useRef(null);

  const hasInitial = initialLat != null && initialLng != null;

  const [centerCoord, setCenterCoord] = useState(
    hasInitial ? [initialLng, initialLat] : FALLBACK_COORD,
  );
  const [ready,     setReady]     = useState(hasInitial);
  const [geocoding, setGeocoding] = useState(false);
  const [hint,      setHint]      = useState('Move the map to set your delivery pin');

  // ── On mount: get device location if no initialLat/Lng ──────────────────────
  useEffect(() => {
    if (hasInitial) {
      scheduleGeocode(initialLng, initialLat);
      return;
    }
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc  = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const coord = [loc.coords.longitude, loc.coords.latitude];
          setCenterCoord(coord);
          scheduleGeocode(coord[0], coord[1]);
        }
      } catch { /* permission denied or error — use fallback */ }
      setReady(true);
    })();
  }, []);

  // ── Debounced reverse geocode ────────────────────────────────────────────────
  function scheduleGeocode(lng, lat) {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setGeocoding(true);
      const addr = await reverseGeocode(lng, lat);
      setGeocoding(false);
      setHint(addr || 'Could not fetch address');
      onLocationSelect({ lat, lng, address: addr });
    }, DEBOUNCE_MS);
  }

  // ── Called every time the camera moves ──────────────────────────────────────
  function handleCameraChanged(state) {
    const center = state?.properties?.center;
    if (!center) return;
    const [lng, lat] = center;
    setCenterCoord([lng, lat]);
    scheduleGeocode(lng, lat);
  }

  // ── "My Location" button ─────────────────────────────────────────────────────
  async function goToMyLocation() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc   = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coord = [loc.coords.longitude, loc.coords.latitude];
      setCenterCoord(coord);
      cameraRef.current?.setCamera({
        centerCoordinate: coord,
        zoomLevel:        15,
        animationMode:    'flyTo',
        animationDuration: 700,
      });
      scheduleGeocode(coord[0], coord[1]);
    } catch { /* silently ignore */ }
  }

  // ── Loading state ────────────────────────────────────────────────────────────
  if (!ready) {
    return (
      <View
        style={{
          height,
          alignItems:      'center',
          justifyContent:  'center',
          backgroundColor: '#f9fafb',
          borderRadius:    12,
          borderWidth:     1,
          borderColor:     '#e5e7eb',
        }}
      >
        <ActivityIndicator color="#16a34a" />
        <Text style={{ color: '#6b7280', marginTop: 6, fontSize: 13 }}>
          Getting your location…
        </Text>
      </View>
    );
  }

  // ── Map ──────────────────────────────────────────────────────────────────────
  return (
    <View
      style={{
        borderRadius: 12,
        overflow:     'hidden',
        borderWidth:  1,
        borderColor:  '#e5e7eb',
      }}
    >
      {/* Map container */}
      <View style={{ height, position: 'relative' }}>
        <MapboxGL.MapView
          style={StyleSheet.absoluteFillObject}
          styleURL={MapboxGL.StyleURL.Street}
          onCameraChanged={handleCameraChanged}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
          scaleBarEnabled={false}
        >
          <MapboxGL.Camera
            ref={cameraRef}
            centerCoordinate={centerCoord}
            zoomLevel={15}
            animationMode="none"
          />
          <MapboxGL.UserLocation visible renderMode="native" />
        </MapboxGL.MapView>

        {/* Fixed centre pin — stays put while map slides under it */}
        <View pointerEvents="none" style={styles.pinWrapper}>
          <View style={styles.pinShadow} />
          <Text style={styles.pinIcon}>📍</Text>
        </View>

        {/* My Location button */}
        <TouchableOpacity style={styles.myLocationBtn} onPress={goToMyLocation}>
          <Text style={{ fontSize: 14 }}>🎯</Text>
          <Text style={styles.myLocationText}>My Location</Text>
        </TouchableOpacity>
      </View>

      {/* Address hint strip */}
      <View style={styles.hintStrip}>
        {geocoding ? (
          <ActivityIndicator size="small" color="#16a34a" />
        ) : (
          <Text style={styles.hintText} numberOfLines={2}>
            {hint}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pinWrapper: {
    position:       'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems:     'center',
    justifyContent: 'center',
  },
  pinShadow: {
    position:        'absolute',
    width:           10,
    height:          5,
    borderRadius:    5,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  pinIcon: {
    fontSize:    32,
    marginBottom: 28,
  },
  myLocationBtn: {
    position:        'absolute',
    bottom:          8,
    right:           8,
    backgroundColor: 'white',
    borderRadius:    8,
    paddingHorizontal: 10,
    paddingVertical:   6,
    flexDirection:   'row',
    alignItems:      'center',
    gap:             4,
    shadowColor:     '#000',
    shadowOpacity:   0.12,
    shadowRadius:    4,
    elevation:       3,
  },
  myLocationText: {
    fontSize:   12,
    fontWeight: '600',
    color:      '#374151',
  },
  hintStrip: {
    paddingHorizontal: 12,
    paddingVertical:   8,
    backgroundColor:   '#f9fafb',
    minHeight:         36,
    flexDirection:     'row',
    alignItems:        'center',
  },
  hintText: {
    fontSize: 12,
    color:    '#6b7280',
    flex:     1,
  },
});
