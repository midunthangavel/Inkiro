import './global.css';
import { useState, useEffect, useCallback } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useAuth }              from './src/hooks/useAuth';
import { usePushNotifications } from './src/hooks/usePushNotifications';
import { useAppFonts }          from './src/hooks/useAppFonts';
import { LanguageProvider }     from './src/hooks/useLanguage';
import api, { configureLogout } from './src/lib/api';
import { disconnectSocket }      from './src/lib/socket';
import LoginScreen              from './src/screens/LoginScreen';
import RegisterShopScreen       from './src/screens/RegisterShopScreen';
import OrdersScreen             from './src/screens/OrdersScreen';
import OrderDetailScreen        from './src/screens/OrderDetailScreen';
import { palettes }             from './src/theme/tokens';

const P = palettes.light;

function Main() {
  const { user, loaded, login, logout } = useAuth();
  const [shop, setShop]                   = useState(null);
  const [fetchingShop, setFetchingShop]   = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);

  usePushNotifications(user?.id);

  const fetchShop = useCallback(async (userId) => {
    setFetchingShop(true);
    try {
      const { data } = await api.get(`/shops/by-user/${userId}`);
      setShop(data.shop);
    } catch (err) {
      if (err?.response?.status === 404) setShop(null);
      else console.error('fetchShop:', err?.response?.data || err?.message);
    } finally { setFetchingShop(false); }
  }, []);

  useEffect(() => { if (user) fetchShop(user.id); }, [user, fetchShop]);
  useEffect(() => { configureLogout(() => { disconnectSocket(); logout(); }); }, [logout]);

  function handleLogout() {
    disconnectSocket(); logout(); setShop(null); setSelectedOrder(null);
  }

  if (!loaded || fetchingShop) {
    return (
      <View className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator size="large" color={P.accent} />
      </View>
    );
  }

  if (!user) return (<><StatusBar style="dark" /><LoginScreen onLogin={login} /></>);
  if (!shop) return (<><StatusBar style="dark" /><RegisterShopScreen user={user} onRegistered={setShop} /></>);

  if (selectedOrder) {
    return (
      <>
        <StatusBar style="dark" />
        <OrderDetailScreen
          order={selectedOrder}
          shop={shop}
          onBack={() => setSelectedOrder(null)}
          onUpdated={(o) => setSelectedOrder(o)}
        />
      </>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <OrdersScreen
        shop={shop}
        user={user}
        onLogout={handleLogout}
        onOpenOrder={setSelectedOrder}
      />
    </>
  );
}

export default function App() {
  const fontsLoaded = useAppFonts();
  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: P.bg }}>
        <ActivityIndicator color={P.accent} />
      </View>
    );
  }
  return (
    <LanguageProvider>
      <Main />
    </LanguageProvider>
  );
}
