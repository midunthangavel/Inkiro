import { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import MapView, { UrlTile, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';

// Fallback centre: Chennai (used only if GPS is denied and no initialLat/Lng)
const FALLBACK_REGION = {
  latitude: 13.0827,
  longitude: 80.2707,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};
const DEBOUNCE_MS = 600;
// Nominatim requires a User-Agent identifying the app.
const NOMINATIM_UA = 'InkiroApp/1.0 (hyperlocal delivery MVP)';

async function reverseGeocode(lat, lng) {
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse` +
      `?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': NOMINATIM_UA,
        'Accept-Language': 'en',
      },
    });
    const json = await res.json();
    return json.display_name ?? '';
  } catch {
    return '';
  }
}

/**
 * LocationPicker — floating-pin map component (OSM + Nominatim).
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
  const mapRef = useRef(null);
  const debounceRef = useRef(null);

  const hasInitial = initialLat != null && initialLng != null;

  const [region, setRegion] = useState(
    hasInitial
      ? {
          latitude: initialLat,
          longitude: initialLng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }
      : FALLBACK_REGION,
  );
  const [ready, setReady] = useState(hasInitial);
  const [geocoding, setGeocoding] = useState(false);
  const [hint, setHint] = useState('Move the map to set your delivery pin');

  // ── On mount: get device location if no initialLat/Lng ──────────────────────
  useEffect(() => {
    if (hasInitial) {
      scheduleGeocode(initialLat, initialLng);
      return;
    }
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const next = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          };
          setRegion(next);
          mapRef.current?.animateToRegion(next, 500);
          scheduleGeocode(next.latitude, next.longitude);
        }
      } catch { /* permission denied or error — use fallback */ }
      setReady(true);
    })();
  }, []);

  // ── Debounced reverse geocode ───────────────────────────────────────────────
  function scheduleGeocode(lat, lng) {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setGeocoding(true);
      const addr = await reverseGeocode(lat, lng);
      setGeocoding(false);
      setHint(addr || 'Could not fetch address');
      onLocationSelect({ lat, lng, address: addr });
    }, DEBOUNCE_MS);
  }

  // ── Called when the map camera settles ──────────────────────────────────────
  function handleRegionChangeComplete(next) {
    setRegion(next);
    scheduleGeocode(next.latitude, next.longitude);
  }

  // ── "My Location" button ────────────────────────────────────────────────────
  async function goToMyLocation() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const next = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      mapRef.current?.animateToRegion(next, 700);
      scheduleGeocode(next.latitude, next.longitude);
    } catch { /* silently ignore */ }
  }

  // ── Loading state ───────────────────────────────────────────────────────────
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

  // ── Map ─────────────────────────────────────────────────────────────────────
  return (
    <View
      style={{
        borderRadius: 12,
        overflow:     'hidden',
        borderWidth:  1,
        borderColor:  '#e5e7eb',
      }}
    >
      <View style={{ height, position: 'relative' }}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_DEFAULT}
          mapType="none"
          style={StyleSheet.absoluteFillObject}
          initialRegion={region}
          onRegionChangeComplete={handleRegionChangeComplete}
          showsUserLocation
          showsMyLocationButton={false}
          showsCompass={false}
          rotateEnabled={false}
          pitchEnabled={false}
        >
          <UrlTile
            urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            maximumZ={19}
            flipY={false}
            shouldReplaceMapContent
          />
        </MapView>

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
    position:          'absolute',
    bottom:            8,
    right:             8,
    backgroundColor:   'white',
    borderRadius:      8,
    paddingHorizontal: 10,
    paddingVertical:   6,
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    shadowColor:       '#000',
    shadowOpacity:     0.12,
    shadowRadius:      4,
    elevation:         3,
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
