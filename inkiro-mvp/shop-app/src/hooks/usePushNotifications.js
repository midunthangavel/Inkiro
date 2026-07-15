import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import api from '../lib/api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  false,
  }),
});

export function usePushNotifications(userId) {
  const registered = useRef(false);

  useEffect(() => {
    if (!userId || registered.current) return;
    if (Constants.appOwnership === 'expo') return; // Expo Go — remote push not supported

    (async () => {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') return;

      const token = (await Notifications.getExpoPushTokenAsync()).data;
      registered.current = true;

      try {
        await api.post('/auth/register-push-token', { user_id: userId, token });
      } catch (err) {
        console.warn('push token register failed:', err?.response?.data || err?.message);
      }
    })();
  }, [userId]);
}
