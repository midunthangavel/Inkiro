import './global.css';
import { useState, useEffect } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useAuth } from './src/hooks/useAuth';
import api, { configureLogout } from './src/lib/api';
import { disconnectSocket } from './src/lib/socket';
import { useAppFonts } from './src/hooks/useAppFonts';
import { LanguageProvider } from './src/hooks/useLanguage';
import LoginScreen           from './src/screens/LoginScreen';
import OnboardingNameScreen  from './src/screens/OnboardingNameScreen';
import OnboardingScreen      from './src/screens/OnboardingScreen';
import VoiceOrderScreen      from './src/screens/VoiceOrderScreen';
import OrderTrackerScreen    from './src/screens/OrderTrackerScreen';
import HistoryScreen         from './src/screens/HistoryScreen';
import { LanguageToggle }    from './src/components/ink';
import { palettes }          from './src/theme/tokens';

const P = palettes.light;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function TabBar({ tab, onTab }) {
  const tabs = [
    { id: 'order',   label: 'Order',   emoji: '🎙' },
    { id: 'history', label: 'History', emoji: '📋' },
  ];
  return (
    <View className="flex-row bg-paper-elev border-t border-hair pt-2 pb-5">
      {tabs.map(t => (
        <Pressable key={t.id} className="flex-1 items-center" onPress={() => onTab(t.id)}>
          <Text style={{ fontSize: 20 }}>{t.emoji}</Text>
          <Text className={`text-[11px] font-semi mt-0.5 ${tab === t.id ? 'text-accent' : 'text-ink-muted'}`}>
            {t.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Main() {
  const { user, loaded, login, logout, updateUser } = useAuth();
  const [tab, setTab]                 = useState('order');
  const [activeOrder, setActiveOrder] = useState(null);
  const [reorderCart, setReorderCart] = useState(null);
  const [onboardingSeen, setOnboardingSeen] = useState(null);

  useEffect(() => {
    AsyncStorage.getItem('inkiro_onboarding_v1')
      .then(v => setOnboardingSeen(v === '1'))
      .catch(() => setOnboardingSeen(true));
  }, []);

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
        await api.post('/auth/register-push-token', { token, role: 'customer' });
      } catch (e) {
        console.log('push token registration:', e?.message);
      }
    }
    registerPushToken();
  }, [user?.id]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const orderId = response.notification.request.content.data?.order_id;
      if (orderId) setActiveOrder(orderId);
    });
    return () => sub.remove();
  }, []);

  if (!loaded || onboardingSeen === null) {
    return (
      <View className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator size="large" color={P.accent} />
      </View>
    );
  }

  if (!user) {
    return (
      <>
        <StatusBar style="dark" />
        <LoginScreen onLogin={login} />
      </>
    );
  }

  if (!user.name) {
    return (
      <>
        <StatusBar style="dark" />
        <OnboardingNameScreen user={user} onComplete={u => updateUser(u)} />
      </>
    );
  }

  if (!onboardingSeen) {
    return (
      <>
        <StatusBar style="dark" />
        <OnboardingScreen
          onDone={async () => {
            await AsyncStorage.setItem('inkiro_onboarding_v1', '1');
            setOnboardingSeen(true);
          }}
        />
      </>
    );
  }

  if (activeOrder) {
    return (
      <>
        <StatusBar style="dark" />
        <OrderTrackerScreen
          order={activeOrder}
          onDone={() => { setActiveOrder(null); setTab('history'); }}
        />
      </>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <View className="flex-1 bg-paper">
        <View style={{ position: 'absolute', top: 50, right: 16, zIndex: 20 }}>
          <LanguageToggle />
        </View>
        {tab === 'order'
          ? <VoiceOrderScreen
              user={user}
              onOrderPlaced={order => { setActiveOrder(order); setReorderCart(null); }}
              initialCart={reorderCart}
              onReset={() => setReorderCart(null)}
            />
          : <HistoryScreen
              user={user}
              onLogout={logout}
              onTrackOrder={setActiveOrder}
              onReorder={order => {
                const total = Math.round((order.total_amount_paise || 0) / 100);
                setReorderCart({
                  items: order.items || [],
                  raw_text: null,
                  subtotal: total,
                  platform_fee: 0,
                  delivery_fee: 0,
                  total,
                });
                setTab('order');
              }}
            />}
        <TabBar tab={tab} onTab={setTab} />
      </View>
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
