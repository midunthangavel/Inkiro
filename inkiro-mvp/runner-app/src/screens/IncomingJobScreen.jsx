import { useState, useEffect } from 'react';
import {
  View, Text, ActivityIndicator, Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import api from '../lib/api';
import { InkButton, IconBike, IconCheck, Tamil } from '../components/ink';
import { palettes, rupees } from '../theme/tokens';
const P = palettes.light;

function shortId(id) { return id ? `#${String(id).replace(/-/g, '').slice(0, 6).toUpperCase()}` : '#------'; }

export default function IncomingJobScreen({ order, onAccepted, onDismiss }) {
  const [loading, setLoading]   = useState(false);
  const [secsLeft, setSecsLeft] = useState(20);

  useEffect(() => {
    if (secsLeft <= 0) { onDismiss(); return; }
    if (secsLeft === 10 || secsLeft === 5) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    }
    const t = setTimeout(() => setSecsLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secsLeft, onDismiss]);

  async function accept() {
    setLoading(true);
    try {
      const { data } = await api.post('/runners/accept-job', { order_id: order.id });
      onAccepted(data.order || order);
    } catch (err) {
      Alert.alert('Already taken', err?.response?.data?.error || 'Another runner got it');
      onDismiss();
    } finally { setLoading(false); }
  }

  const earnings   = rupees(order.runner_earning_paise || 3000);
  const pickupDist = order.pickup_distance_km ? `${order.pickup_distance_km} km` : '—';
  const dropDist   = order.drop_distance_km   ? `${order.drop_distance_km} km`   : '—';

  return (
    <View className="flex-1" style={{ backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' }}>
      <View
        className="bg-paper-elev"
        style={{
          borderTopLeftRadius: 28, borderTopRightRadius: 28,
          padding: 18, paddingBottom: 34,
          shadowColor: '#000', shadowOffset: { width: 0, height: -16 },
          shadowOpacity: 0.25, shadowRadius: 40, elevation: 20,
        }}
      >
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: P.hairStrong, alignSelf: 'center', marginTop: -4, marginBottom: 14 }} />

        <View className="flex-row items-center justify-between mb-3">
          <View className="flex-row items-center" style={{ gap: 10 }}>
            <View className="w-8 h-8 rounded-full bg-accent items-center justify-center">
              <IconBike size={16} color="#fff" />
            </View>
            <View>
              <Text className="text-accent-ink text-[11px] font-semi tracking-wider uppercase">New job</Text>
              <Tamil size={9}>புதிய வேலை</Tamil>
              <Text className="text-ink-muted text-[10px] font-mono">{shortId(order.id)}</Text>
            </View>
          </View>
          <Text className="font-mono font-semi text-accent" style={{ fontSize: 24 }}>{earnings}</Text>
        </View>

        <View className="bg-paper-sunk p-3.5 rounded-ink border border-hair flex-row" style={{ gap: 12 }}>
          <View className="items-center" style={{ gap: 4, paddingTop: 3 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: P.accent }} />
            <View style={{ width: 2, height: 28, backgroundColor: P.hairStrong }} />
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: P.ink }} />
          </View>
          <View className="flex-1" style={{ gap: 14 }}>
            <View>
              <Text className="text-ink-muted text-[10px] font-semi tracking-widest uppercase">Pickup</Text>
              <Tamil size={8}>பிக்கப்</Tamil>
              <Text className="text-ink font-semi text-sm">{order.shop_name || 'Shop'}</Text>
              <Text className="text-ink-muted text-[11px]">{order.shop_area || order.shop_address || '—'} · {pickupDist}</Text>
            </View>
            <View>
              <Text className="text-ink-muted text-[10px] font-semi tracking-widest uppercase">Drop</Text>
              <Tamil size={8}>டெலிவரி</Tamil>
              <Text className="text-ink font-semi text-sm">{order.drop_area || 'Customer'}</Text>
              <Text className="text-ink-muted text-[11px]" numberOfLines={1}>{order.address || ''} · {dropDist}</Text>
            </View>
          </View>
        </View>

        <View className="flex-row items-center justify-between mt-3.5 mx-1">
          <Text className="text-rose font-semi text-[11px]">
            Auto-skip in 0:{String(Math.max(0, secsLeft)).padStart(2, '0')}
          </Text>
          <View className="flex-1 mx-3" style={{ height: 3, backgroundColor: P.hair, borderRadius: 100 }}>
            <View style={{ width: `${Math.max(0, secsLeft) / 20 * 100}%`, height: '100%', backgroundColor: P.rose, borderRadius: 100 }} />
          </View>
        </View>

        <View className="flex-row mt-3.5" style={{ gap: 10 }}>
          <InkButton variant="ghost" full size="md" onPress={onDismiss} disabled={loading} accessibilityLabel="Skip this job">Skip</InkButton>
          <InkButton variant="accent" full size="md" onPress={accept} disabled={loading} accessibilityLabel="Accept this job">
            {loading
              ? <ActivityIndicator color="#fff" />
              : (<><IconCheck size={16} color="#fff" w={2.5} /><Text className="text-paper-elev font-semi">Accept</Text></>)}
          </InkButton>
        </View>
      </View>
    </View>
  );
}
