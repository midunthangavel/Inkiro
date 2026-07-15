import axios from 'axios';

const base = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const api = axios.create({ baseURL: base, timeout: 15000 });

let _logout = null;
export function configureLogout(fn) { _logout = fn; }

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('inkiro_shop_token');
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
        const refreshToken = sessionStorage.getItem('inkiro_shop_refresh');
        if (!refreshToken) throw new Error('no refresh token');
        const { data } = await axios.post(`${base}/auth/refresh`, { refreshToken });
        sessionStorage.setItem('inkiro_shop_token', data.token);
        original.headers = { ...(original.headers || {}), Authorization: `Bearer ${data.token}` };
        return api(original);
      } catch {
        localStorage.removeItem('inkiro_shop_user');
        sessionStorage.removeItem('inkiro_shop_token');
        sessionStorage.removeItem('inkiro_shop_refresh');
        _logout?.();
      }
    }
    return Promise.reject(error);
  }
);

export default api;
