import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const base = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api/v1';

const api = axios.create({ baseURL: base, timeout: 15000 });

let _logout = null;
export function configureLogout(fn) { _logout = fn; }

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('inkiro_runner_token');
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  res => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const refreshToken = await SecureStore.getItemAsync('inkiro_runner_refresh');
        if (!refreshToken) throw new Error('no refresh token');
        const { data } = await axios.post(`${base}/auth/refresh`, { refreshToken });
        await SecureStore.setItemAsync('inkiro_runner_token', data.token);
        original.headers = { ...(original.headers || {}), Authorization: `Bearer ${data.token}` };
        return api(original);
      } catch {
        await AsyncStorage.removeItem('inkiro_runner_user');
        await SecureStore.deleteItemAsync('inkiro_runner_token');
        await SecureStore.deleteItemAsync('inkiro_runner_refresh');
        _logout?.();
      }
    }
    return Promise.reject(error);
  }
);

export default api;
