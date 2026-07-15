// src/hooks/useLanguage.js — persisted EN/TA/both toggle (web)
import { createContext, useContext, useState } from 'react';

const KEY = 'inkiro.lang';
const LanguageContext = createContext({ lang: 'both', setLang: () => {} });

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem(KEY) || 'both'; } catch { return 'both'; }
  });
  const setLang = (v) => {
    setLangState(v);
    try { localStorage.setItem(KEY, v); } catch {}
  };
  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);

export function t(lang, en, ta) {
  return lang === 'ta' ? (ta || en) : en;
}
