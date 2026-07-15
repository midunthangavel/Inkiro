import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1',
  timeout: 10000,
});

// Attach the admin key from sessionStorage on every request.
// This means the key is never baked into the JS bundle.
api.interceptors.request.use(config => {
  const key = sessionStorage.getItem('inkiro_admin_key');
  if (key) config.headers['X-Admin-Key'] = key;
  return config;
});

export function setAdminKey(key) {
  sessionStorage.setItem('inkiro_admin_key', key);
}

export function clearAdminKey() {
  sessionStorage.removeItem('inkiro_admin_key');
}

export function getAdminKey() {
  return sessionStorage.getItem('inkiro_admin_key');
}

export default api;
