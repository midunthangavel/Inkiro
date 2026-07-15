import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const USER_KEY    = 'inkiro_customer_user';
const TOKEN_KEY   = 'inkiro_customer_token';
const REFRESH_KEY = 'inkiro_customer_refresh';

export function useAuth() {
  const [user, setUser]     = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(USER_KEY)
      .then(raw => { if (raw) setUser(JSON.parse(raw)); })
      .finally(() => setLoaded(true));
  }, []);

  // Accepts { user, token } (from login) or a plain user object (legacy)
  const login = useCallback(async (payload) => {
    const userData     = payload?.user ?? payload;
    const token        = payload?.token;
    const refreshToken = payload?.refreshToken;
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(userData));
    if (token)        await SecureStore.setItemAsync(TOKEN_KEY, token);
    if (refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
    setUser(userData);
  }, []);

  const logout = useCallback(async () => {
    await AsyncStorage.removeItem(USER_KEY);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
    setUser(null);
  }, []);

  // Patch + persist the stored user without re-logging in
  const updateUser = useCallback(async (patch) => {
    setUser(prev => {
      const next = { ...(prev || {}), ...patch };
      AsyncStorage.setItem(USER_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return { user, loaded, login, logout, updateUser };
}
