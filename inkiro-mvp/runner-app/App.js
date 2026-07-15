import './global.css';
import { useState, useEffect, useCallback } from 'react';
import { View, ActivityIndicator, Modal } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useAuth }          from './src/hooks/useAuth';
import { useAppFonts }      from './src/hooks/useAppFonts';
import { LanguageProvider } from './src/hooks/useLanguage';
import api, { configureLogout } from './src/lib/api';
import { disconnectSocket }      from './src/lib/socket';
import LoginScreen          from './src/screens/LoginScreen';
import HomeScreen           from './src/screens/HomeScreen';
import ActiveJobScreen      from './src/screens/ActiveJobScreen';
import EarningsScreen       from './src/screens/EarningsScreen';
import IncomingJobScreen    from './src/screens/IncomingJobScreen';
import SettingsScreen       from './src/screens/SettingsScreen';
import { palettes }         from './src/theme/tokens';

const P = palettes.light;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function Main() {
  const { user, loaded, login, logout } = useAuth();
  const [runner, setRunner]                 = useState(null);
  const [fetchingRunner, setFetchingRunner] = useState(false);
  const [activeOrder, setActiveOrder]       = useState(null);
  const [incomingOrder, setIncomingOrder]   = useState(null);
  const [tab, setTab]                       = useState('home');

  const fetchRunner = useCallback(async (userId) => {
    setFetchingRunner(true);
    try {
      const { data } = await api.get(`/runners/by-user/${userId}`);
      setRunner(data.runner);
      const { data: jobData } = await api.get(`/runners/${data.runner.id}/active-order`);
      if (jobData.order) setActiveOrder(jobData.order);
    } catch (err) {
      console.error('fetchRunner:', err?.response?.data || err?.message);
    } finally { setFetchingRunner(false); }
  }, []);

  useEffect(() => { if (user) fetchRunner(user.id); }, [user, fetchRunner]);
  useEffect(() => { configureLogout(() => { disconnectSocket(); logout(); }); }, [logout]);

  useEffect(() => {
    if (!user) return;
    async function registerPushToken() {
      try {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== 'granted') return;
        const { data: token } = await Notifications.getExpoPushTokenAsync({
          projectId: Constants.expoConfig.extra?.eas?.projectId,
        });
        await api.post('/auth/register-push-token', { token, role: 'runner' });
      } catch (e) {
        console.log('push token registration:', e?.message);
      }
    }
    registerPushToken();
  }, [user?.id]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      setTab('home');
    });
    return () => sub.remove();
  }, []);

  function handleLogout() {
    disconnectSocket(); logout(); setRunner(null); setActiveOrder(null);
  }

  if (!loaded || fetchingRunner) {
    return (
      <View className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator size="large" color={P.accent} />
      </View>
    );
  }

  if (!user) {
    return (<><StatusBar style="dark" /><LoginScreen onLogin={login} /></>);
  }

  return (
    <>
      <StatusBar style="dark" />
      {activeOrder
        ? <ActiveJobScreen order={activeOrder} runner={runner} onOrderComplete={() => setActiveOrder(null)} />
        : tab === 'earnings'
          ? <EarningsScreen runner={runner} onBack={() => setTab('home')} />
          : tab === 'settings'
            ? <SettingsScreen
                user={user}
                runner={runner}
                onBack={() => setTab('home')}
                onLogout={handleLogout}
                onUserUpdated={(u) => login({ user: u })}
              />
            : <HomeScreen
                user={user}
                runner={runner}
                onLogout={handleLogout}
                onJobIncoming={setIncomingOrder}
                onOpenEarnings={() => setTab('earnings')}
                onOpenSettings={() => setTab('settings')}
              />
      }

      <Modal visible={!!incomingOrder} transparent animationType="slide" onRequestClose={() => setIncomingOrder(null)}>
        {incomingOrder && (
          <IncomingJobScreen
            order={incomingOrder}
            onAccepted={(o) => { setIncomingOrder(null); setActiveOrder(o); }}
            onDismiss={() => setIncomingOrder(null)}
          />
        )}
      </Modal>
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
