import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, Pressable, ActivityIndicator, ScrollView, RefreshControl, Alert, Animated, Easing,
} from 'react-native';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import api from '../lib/api';
import { getSocket } from '../lib/socket';
import { useLocation } from '../hooks/useLocation';
import {
  InkCard, Tamil, LanguageToggle, IconBike, IconUser, IconStar, SkeletonBlock,
} from '../components/ink';
import { palettes, rupees } from '../theme/tokens';

const P = palettes.light;

export default function HomeScreen({ user, runner, onLogout, onJobIncoming, onOpenEarnings, onOpenSettings }) {
  const [isAvailable, setIsAvailable] = useState(runner?.is_available ?? false);
  const [earnings, setEarnings]       = useState(null);
  const [toggling, setToggling]       = useState(false);
  const [refreshing, setRefreshing]   = useState(false);

  useLocation(runner?.id, isAvailable);

  const fetchEarnings = useCallback(async () => {
    if (!runner?.id) return;
    try {
      const { data } = await api.get(`/runners/${runner.id}/earnings`);
      setEarnings(data);
    } catch {}
  }, [runner?.id]);

  useEffect(() => {
    if (!runner?.id) return;
    fetchEarnings();
    const socket = getSocket();
    socket.connect();
    socket.emit('join:runner', runner.id);
    socket.on('job:available', (order) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      onJobIncoming(order);
    });

    return () => { socket.off('job:available'); socket.disconnect(); };
  }, [runner?.id, fetchEarnings, onJobIncoming]);

  async function toggleAvailability(val) {
    if (!runner?.id) return;
    setToggling(true);
    try {
      let lat = 0, lng = 0;
      if (val) {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          lat = loc.coords.latitude; lng = loc.coords.longitude;
        }
      }
      await api.post('/runners/update-location', { lat, lng, is_available: val });
      setIsAvailable(val);
    } catch {
      Alert.alert('Error', 'Could not update availability');
    } finally { setToggling(false); }
  }

  async function onRefresh() {
    setRefreshing(true);
    await fetchEarnings();
    setRefreshing(false);
  }

  const firstName = user.name?.split(' ')[0] || 'Runner';

  return (
    <View className="flex-1 bg-paper">
      <ScrollView
        className="flex-1"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={P.accent} />}
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        <View className="px-5 pt-14 pb-3 flex-row items-start justify-between">
          <View>
            <Text className="text-ink-muted text-[11px] font-semi tracking-widest uppercase">Runner</Text>
            <Text className="font-serif text-ink mt-0.5" style={{ fontSize: 30, lineHeight: 32 }}>
              {isAvailable ? `Hi, ${firstName}` : 'Offline'}
            </Text>
            {runner?.rating_count > 0 && (
              <View className="flex-row items-center mt-0.5" style={{ gap: 3 }}>
                <IconStar size={12} color={P.amber} filled />
                <Text className="text-ink-muted text-xs font-semi">
                  {(runner.rating_sum / runner.rating_count).toFixed(1)}
                  <Text className="font-normal"> ({runner.rating_count})</Text>
                </Text>
              </View>
            )}
          </View>
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <LanguageToggle />
            <Pressable onPress={onOpenSettings} hitSlop={10} accessibilityLabel="Open settings" accessibilityRole="button">
              <View className="w-11 h-11 rounded-full bg-paper-elev border border-hair items-center justify-center">
                <IconUser size={20} color={P.ink} />
              </View>
            </Pressable>
          </View>
        </View>

        <View className="flex-1 items-center justify-center py-8" style={{ gap: 16 }}>
          {isAvailable ? <WaitingHero /> : <OfflineHero />}
          <View className="items-center">
            <Text className="font-serif text-ink text-center" style={{ fontSize: 24, lineHeight: 26 }}>
              {isAvailable ? 'Waiting for jobs…' : 'Tap ON to go online'}
            </Text>
            <Tamil size={12}>{isAvailable ? 'வேலைக்கு காத்திருக்கிறீர்கள்' : 'ஆன்லைனில் இருக்க ON அழுத்துங்கள்'}</Tamil>
          </View>
          <Text className="text-ink-muted text-[11px] font-semi tracking-wider uppercase text-center px-6">
            {isAvailable ? "We'll buzz you when a kirana accepts nearby" : 'Battery-friendly · no jobs until you go online'}
          </Text>
        </View>

        {!earnings && isAvailable && (
          <InkCard className="mx-4" pad={14}>
            <View className="flex-row justify-between" style={{ gap: 8 }}>
              <SkeletonBlock height={40} style={{ flex: 1 }} rounded={8} />
              <SkeletonBlock height={40} style={{ flex: 1 }} rounded={8} />
              <SkeletonBlock height={40} style={{ flex: 1 }} rounded={8} />
            </View>
          </InkCard>
        )}

        {earnings && isAvailable && (
          <InkCard className="mx-4" pad={14}>
            <Text className="text-ink-muted text-[10px] font-semi tracking-widest uppercase">Today</Text>
            <View className="flex-row justify-between mt-2">
              <Stat label="Earnings"   value={rupees(earnings.today_total || 0)} />
              <Stat label="Deliveries" value={String(earnings.today_orders || 0)} />
              <Stat label="All time"   value={String(earnings.all_time_orders || 0)} />
            </View>
          </InkCard>
        )}

        {runner && (runner.streak_count > 0 || runner.xp > 0) && (
          <InkCard className="mx-4 mt-3" pad={14}>
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center" style={{ gap: 6 }}>
                <Text style={{ fontSize: 20 }}>🔥</Text>
                <View>
                  <Text className="text-ink font-semi text-sm">{runner.streak_count || 0}-day streak</Text>
                  <Text className="text-ink-muted text-xs">Keep it going!</Text>
                </View>
              </View>
              <View className="items-end">
                <Text className="text-accent font-semi text-sm">Lv.{runner.level || 1}</Text>
                <Text className="text-ink-muted text-xs">{runner.xp || 0} XP</Text>
              </View>
            </View>
          </InkCard>
        )}

        <View className="items-center mt-4">
          <Pressable onPress={onOpenEarnings} hitSlop={10}>
            <Text className="text-accent font-semi text-sm">See earnings & history →</Text>
          </Pressable>
        </View>
      </ScrollView>

      <View className="absolute bottom-0 left-0 right-0 px-4 pb-6 pt-3 bg-paper border-t border-hair">
        <View className="flex-row bg-paper-elev rounded-full p-1 border border-hair">
          <Pressable
            className={`flex-1 py-3 items-center rounded-full ${!isAvailable ? 'bg-ink' : ''}`}
            onPress={() => isAvailable && toggleAvailability(false)}
            disabled={toggling}
            accessibilityLabel="Go offline"
            accessibilityRole="button"
          >
            <Text className={`font-semi text-sm ${!isAvailable ? 'text-paper' : 'text-ink-muted'}`}>OFF</Text>
          </Pressable>
          <Pressable
            className={`flex-1 py-3 items-center rounded-full ${isAvailable ? 'bg-accent' : ''}`}
            onPress={() => !isAvailable && toggleAvailability(true)}
            disabled={toggling}
            accessibilityLabel="Go online"
            accessibilityRole="button"
          >
            {toggling
              ? <ActivityIndicator color={isAvailable ? '#fff' : P.ink} size="small" />
              : <Text className={`font-semi text-sm ${isAvailable ? 'text-paper-elev' : 'text-ink-muted'}`}>ON</Text>}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function Stat({ label, value }) {
  return (
    <View className="items-center flex-1">
      <Text className="text-ink font-semi font-mono text-base">{value}</Text>
      <Text className="text-ink-muted text-[10px] font-semi tracking-wider uppercase mt-0.5">{label}</Text>
    </View>
  );
}

function OfflineHero() {
  return (
    <View
      style={{
        width: 140, height: 140, borderRadius: 70,
        borderWidth: 3, borderStyle: 'dashed', borderColor: P.hairStrong,
        backgroundColor: P.bgElev,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <IconBike size={48} color={P.inkMuted} />
    </View>
  );
}

function WaitingHero() {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, { toValue: 1, duration: 2000, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const rings = [0, 0.4, 0.8];
  return (
    <View style={{ width: 180, height: 180, alignItems: 'center', justifyContent: 'center' }}>
      {rings.map((offset, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            width: 180 - i * 20, height: 180 - i * 20, borderRadius: 180,
            borderWidth: 2, borderColor: P.accent,
            opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.4 - i * 0.1, 0] }),
            transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.7 + offset * 0.1, 1.1] }) }],
          }}
        />
      ))}
      <View
        style={{
          width: 88, height: 88, borderRadius: 44,
          backgroundColor: P.accentSoft,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <IconBike size={40} color={P.accentInk} />
      </View>
    </View>
  );
}
