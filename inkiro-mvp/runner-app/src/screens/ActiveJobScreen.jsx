import { useState, useEffect } from 'react';
import {
  View, Text, Pressable, ActivityIndicator, ScrollView, Linking, Alert, Platform,
} from 'react-native';
import Svg, { Path, Rect, Circle, G } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import api from '../lib/api';
import {
  InkCard, InkButton, InkPill, IconCheck, IconPhone, IconHome, IconChevRight,
} from '../components/ink';
import { palettes, rupees } from '../theme/tokens';
import ChatModal from '../components/ChatModal';

const P = palettes.light;

const PHASE = {
  runner_assigned: {
    phase: 'Phase 1 · Pickup',
    action: 'Mark picked up',
    next: 'picked_up',
    targetLabel: 'From',
    destKey: 'shop',
  },
  picked_up: {
    phase: 'Phase 2 · Drop',
    action: 'Mark delivered',
    next: 'delivered',
    targetLabel: 'Drop',
    destKey: 'customer',
  },
};

export default function ActiveJobScreen({ order: initialOrder, runner, onOrderComplete }) {
  const [order, setOrder]       = useState(initialOrder);
  const [updating, setUpdating] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatTarget, setChatTarget] = useState(null); // { type, id, name }

  useEffect(() => { setOrder(initialOrder); }, [initialOrder]);

  function openChat(type, id, name) {
    setChatTarget({ type, id, name });
    setChatOpen(true);
  }

  const meta = PHASE[order?.status];
  if (!order || !meta) return null;

  const shopLat = order.shop?.lat  ?? null;
  const shopLng = order.shop?.lng  ?? null;
  const custLat = order.lat        ?? null;
  const custLng = order.lng        ?? null;
  const destLat = meta.destKey === 'shop' ? shopLat : custLat;
  const destLng = meta.destKey === 'shop' ? shopLng : custLng;

  async function updateStatus() {
    Alert.alert('Confirm', `${meta.action}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Yes', onPress: async () => {
          setUpdating(true);
          try {
            await api.post('/runners/update-status', { order_id: order.id, status: meta.next });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            if (meta.next === 'delivered') onOrderComplete();
            else setOrder(o => ({ ...o, status: meta.next }));
          } catch (err) {
            Alert.alert('Error', err?.response?.data?.error || 'Failed to update status');
          } finally { setUpdating(false); }
        },
      },
    ]);
  }

  function openMaps(lat, lng, label) {
    if (!lat || !lng) { Alert.alert('Location unavailable', 'Coordinates not available'); return; }
    const url = Platform.OS === 'ios'
      ? `maps://?q=${encodeURIComponent(label)}&ll=${lat},${lng}`
      : `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`;
    Linking.openURL(url).catch(() =>
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`)
    );
  }

  const earnings = rupees(order.runner_earning_paise || 3000);
  const dist     = meta.destKey === 'shop'
    ? (order.pickup_distance_km ? `${order.pickup_distance_km} km` : '—')
    : (order.drop_distance_km   ? `${order.drop_distance_km} km`   : '—');

  return (
    <View className="flex-1 bg-paper">
      <View className="px-4 pt-14 pb-3 flex-row items-center justify-between">
        <InkPill color="accent">{meta.phase}</InkPill>
        <Text className="font-mono font-semi text-accent" style={{ fontSize: 18 }}>{earnings}</Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 120 }}>
        <InkCard pad={16}>
          <Text className="text-ink-muted text-[10px] font-semi tracking-widest uppercase">{meta.targetLabel}</Text>
          <Text className="font-serif text-ink mt-1" style={{ fontSize: 26, lineHeight: 28 }}>
            {meta.destKey === 'shop' ? (order.shop?.shop_name || 'Shop') : (order.customer_name || 'Customer')}
          </Text>
          <Text className="text-ink-soft text-sm mt-1">
            {meta.destKey === 'shop' ? (order.shop?.address || '—') : (order.address || '—')} · ~{dist}
          </Text>

          {meta.destKey === 'shop' && (
            <View className="mt-3 px-3 py-2.5 bg-amber-soft rounded-xl flex-row justify-between items-center">
              <Text className="text-amber font-semi text-xs">Cash to collect</Text>
              <Text className="text-amber font-semi font-mono text-sm">{rupees(order.total_amount_paise || 0)}</Text>
            </View>
          )}
        </InkCard>

        <InkCard pad={12}>
          <Pressable onPress={() => openMaps(
            meta.destKey === 'shop' ? custLat : shopLat,
            meta.destKey === 'shop' ? custLng : shopLng,
            meta.destKey === 'shop' ? (order.customer_name || 'Customer') : (order.shop?.shop_name || 'Shop')
          )}>
            <View className="flex-row items-center" style={{ gap: 10 }}>
              <View className="w-7 h-7 rounded-lg bg-paper-sunk items-center justify-center">
                <IconHome size={14} color={P.inkSoft} />
              </View>
              <View className="flex-1">
                <Text className="text-ink-muted text-[10px] font-semi tracking-widest uppercase">
                  {meta.destKey === 'shop' ? 'Next · Drop' : 'Picked up from'}
                </Text>
                <Text className="text-ink font-semi text-[13px]">
                  {meta.destKey === 'shop'
                    ? (order.drop_area || order.address || 'Customer')
                    : (order.shop?.shop_name || 'Shop')}
                </Text>
              </View>
              <IconChevRight size={18} />
            </View>
          </Pressable>
        </InkCard>

        <View className="rounded-ink overflow-hidden border border-hair" style={{ height: 160, backgroundColor: '#E8E3D5' }}>
          <Svg viewBox="0 0 300 160" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
            <Rect width="300" height="160" fill="#E8E3D5" />
            <G stroke="#F5EFE4" strokeWidth="14">
              <Path d="M-10 80 L310 80" />
              <Path d="M150 -10 L150 170" />
            </G>
            <Path d="M40 60 Q 120 80, 180 110 T 260 130" stroke={P.accent} strokeWidth="4" strokeDasharray="2 5" fill="none" />
            <Circle cx="40" cy="60" r="7" fill={P.accent} />
            <Rect x="253" y="123" width="14" height="14" rx="2" fill={P.ink} />
          </Svg>
          <Pressable
            onPress={() => openMaps(destLat, destLng, meta.destKey === 'shop' ? 'Shop' : 'Customer')}
            style={{ position: 'absolute', right: 10, top: 10 }}
          >
            <View className="bg-paper-elev rounded-full px-3 py-1.5 border border-hair">
              <Text className="text-ink font-semi text-xs">Open in Maps ↗</Text>
            </View>
          </Pressable>
        </View>

        <InkCard pad={14}>
          <Text className="text-ink-muted text-[11px] font-semi tracking-wider uppercase">Items</Text>
          <View className="mt-2" style={{ gap: 4 }}>
            {(order.items || []).map((it, i) => (
              <View key={i} className="flex-row justify-between">
                <Text className="text-ink text-sm flex-1">{it.name}</Text>
                <Text className="text-ink-soft text-sm">×{it.quantity}</Text>
              </View>
            ))}
          </View>
        </InkCard>

        <View className="flex-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {meta.destKey === 'shop' && order.shop?.phone && (
            <InkButton variant="mint" full size="md" onPress={() => Linking.openURL(`tel:${order.shop.phone}`)}>
              <IconPhone size={14} /><Text className="text-paper-elev font-semi">Call shop</Text>
            </InkButton>
          )}
          {meta.destKey === 'customer' && order.customer_phone && (
            <InkButton variant="mint" full size="md" onPress={() => Linking.openURL(`tel:${order.customer_phone}`)}>
              <IconPhone size={14} /><Text className="text-paper-elev font-semi">Call customer</Text>
            </InkButton>
          )}
          {meta.destKey === 'shop' && order.shop_id && (
            <InkButton variant="ghost" full size="md" onPress={() => openChat('shop', order.shop_id, order.shop?.shop_name || 'Shop')}>
              <Text className="text-ink font-semi">💬 Chat shop</Text>
            </InkButton>
          )}
          {meta.destKey === 'customer' && order.customer_id && (
            <InkButton variant="ghost" full size="md" onPress={() => openChat('customer', order.customer_id, order.customer_name || 'Customer')}>
              <Text className="text-ink font-semi">💬 Chat customer</Text>
            </InkButton>
          )}
        </View>
      </ScrollView>

      <View className="absolute left-0 right-0 bottom-0 bg-paper-elev border-t border-hair px-4 pt-3 pb-5">
        <InkButton variant="accent" size="lg" full onPress={updateStatus} disabled={updating}>
          {updating
            ? <ActivityIndicator color="#fff" />
            : (<><IconCheck size={18} color="#fff" w={2.5} /><Text className="text-paper-elev font-semi">{meta.action}</Text></>)}
        </InkButton>
      </View>

      {chatTarget && (
        <ChatModal
          visible={chatOpen}
          onClose={() => setChatOpen(false)}
          orderId={order.id}
          myType="runner"
          myId={runner?.id}
          otherType={chatTarget.type}
          otherId={chatTarget.id}
          otherName={chatTarget.name}
        />
      )}
    </View>
  );
}
