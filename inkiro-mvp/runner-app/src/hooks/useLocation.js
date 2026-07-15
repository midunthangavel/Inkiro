import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import * as Location    from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import api              from '../lib/api';

export const LOCATION_TASK = 'inkiro-background-location';

// Module-level variable used by background task (must survive across JS contexts via global)
TaskManager.defineTask(LOCATION_TASK, ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data;
  const loc = locations[0];
  if (!loc) return;

  if (!global.__inkiroRunnerId) return;
  // Respect the app-level offline toggle. The Android foreground service can
  // outlive the JS context briefly after the runner goes offline; skipping here
  // prevents the next callback from silently flipping them back to available.
  if (global.__inkiroDesiredAvailable === false) return;

  api.post('/runners/update-location', {
    lat:          loc.coords.latitude,
    lng:          loc.coords.longitude,
    is_available: true,
  }).catch(() => {});
});

export function useLocation(runnerId, isAvailable) {
  const runnerIdRef = useRef(runnerId);
  runnerIdRef.current = runnerId;

  useEffect(() => {
    global.__inkiroRunnerId = runnerId || null;
    return () => { global.__inkiroRunnerId = null; };
  }, [runnerId]);

  // Keep the global flag in sync so the background task respects toggle changes.
  useEffect(() => {
    global.__inkiroDesiredAvailable = isAvailable;
  }, [isAvailable]);

  // When the runner goes offline, stop the task and send a final availability=false
  // update so the server reflects the state even if the background task had queued
  // a location update before the JS context noticed the toggle.
  useEffect(() => {
    if (!isAvailable) {
      Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
      api.post('/runners/update-location', { lat: 0, lng: 0, is_available: false }).catch(() => {});
    }
  }, [isAvailable]);

  useEffect(() => {
    if (!runnerId || !isAvailable) {
      Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
      return;
    }

    (async () => {
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus !== 'granted') {
        Alert.alert(
          'Location required',
          'Enable location access so customers can track your delivery.',
        );
        return;
      }

      await Location.requestBackgroundPermissionsAsync();

      const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
      if (!running) {
        await Location.startLocationUpdatesAsync(LOCATION_TASK, {
          accuracy:               Location.Accuracy.High,
          distanceInterval:       30,
          timeInterval:           15000,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'Inkiro Runner',
            notificationBody:  'Sharing your location for active deliveries',
            notificationColor: '#16a34a',
          },
        }).catch(() => {});
      }
    })();

    return () => {
      Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
    };
  }, [runnerId, isAvailable]);
}
