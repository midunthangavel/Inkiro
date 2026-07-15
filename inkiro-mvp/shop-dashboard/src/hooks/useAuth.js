import { useState } from 'react';

const USER_KEY    = 'inkiro_shop_user';
const TOKEN_KEY   = 'inkiro_shop_token';
const REFRESH_KEY = 'inkiro_shop_refresh';

export function useAuth() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
  });

  function login(payload) {
    const userData     = payload?.user ?? payload;
    const token        = payload?.token;
    const refreshToken = payload?.refreshToken;
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
    if (token)        sessionStorage.setItem(TOKEN_KEY, token);
    if (refreshToken) sessionStorage.setItem(REFRESH_KEY, refreshToken);
    setUser(userData);
  }

  function logout() {
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
    setUser(null);
  }

  return { user, login, logout };
}
