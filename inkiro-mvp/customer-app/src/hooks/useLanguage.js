// src/hooks/useLanguage.js — persisted EN/TA/both toggle
import { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'inkiro.lang';
const LanguageContext = createContext({ lang: 'both', setLang: () => {} });

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState('both'); // 'en' | 'ta' | 'both'
  useEffect(() => {
    AsyncStorage.getItem(KEY).then(v => { if (v) setLangState(v); });
  }, []);
  const setLang = (v) => {
    setLangState(v);
    AsyncStorage.setItem(KEY, v).catch(() => {});
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
