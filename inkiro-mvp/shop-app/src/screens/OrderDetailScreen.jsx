import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, Pressable, ActivityIndicator, Alert, Modal,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import api from '../lib/api';
import {
  InkCard, InkButton, InkPill, Tamil,
  IconCheck, IconBike, IconStar, IconChevRight,
} from '../components/ink';
import { palettes, rupees } from '../theme/tokens';
import ChatModal from '../components/ChatModal';

const P = palettes.light;

const PH = {
  pending:          'incoming',
  accepted:         'packing',
  pending_runner:   'await_runner',
  runner_notified:  'await_runner',
  runner_assigned:  'handoff',
  picked_up:        'enroute',
  delivered:        'done',
  declined:         'done',
  cancelled:        'done',
  expired:          'done',
};

function shortId(id) { return id ? `#${String(id).replace(/-/g, '').slice(0, 6).toUpperCase()}` : '#------'; }

function runnerCode(order) {
  // Prefer server-generated handoff_code; fall back to deterministic id-derived code.
  if (order?.handoff_code) return String(order.handoff_code).padStart(4, '0');
  const id = order?.id;
  if (!id) return '0000';
  const hex = String(id).replace(/-/g, '').slice(-4);
  return String(parseInt(hex, 16) % 10000).padStart(4, '0');
}

export default function OrderDetailScreen({ order, shop, onBack, onUpdated }) {
  const [loading, setLoading]     = useState(false);
  const [checked, setChecked]     = useState({});
  const [rejectOpen, setRejectOpen] = useState(false);
  const [chatOpen, setChatOpen]   = useState(false);
  const phase = PH[order.status] || 'incoming';

  const [secsLeft, setSecsLeft] = useState(90);
  useEffect(() => {
    if (phase !== 'incoming') return;
    setSecsLeft(90);
    const id = setInterval(() => setSecsLeft(s => s - 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  async function respond(action, reason = null) {
    setLoading(true);
    try {
      await api.post(`/orders/${order.id}/shop-respond`, reason ? { action, decline_reason: reason } : { action });
      if (action === 'accept') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
      const { data } = await api.get(`/orders/${order.id}`);
      onUpdated(data.order || { ...order, status: action === 'accept' ? 'accepted' : 'declined' });
      if (action === 'decline') onBack();
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.error || 'Action failed');
    } finally { setLoading(false); }
  }

  async function markReady() {
    setLoading(true);
    try {
      await api.post(`/orders/${order.id}/mark-ready`);
      const { data } = await api.get(`/orders/${order.id}`);
      onUpdated(data.order || { ...order, status: 'pending_runner' });
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.error || 'Could not mark ready (Phase E will add the endpoint)');
    } finally { setLoading(false); }
  }

  const items       = Array.isArray(order.items) ? order.items : [];
  const packedCount = items.filter((_, i) => checked[i]).length;
  const allChecked  = items.length > 0 && packedCount === items.length;

  return (
    <View className="flex-1 bg-paper">
      <View className="px-5 pt-14 pb-3 flex-row items-center justify-between">
        <Pressable onPress={onBack} hitSlop={10}><Text className="text-ink-muted font-semi">← Back</Text></Pressable>
        <Text className="font-mono text-ink font-semi">{shortId(order.id)}</Text>
        <View style={{ width: 50 }} />
      </View>

      {phase === 'incoming' && (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 130 }}>
          <InkPill color="accent">● NEW ORDER</InkPill>
          <View className="flex-row items-end justify-between">
            <View className="flex-1">
              <Text className="font-serif text-ink" style={{ fontSize: 28 }}>
                {order.customer_name || 'Customer'}
              </Text>
              <Text className="text-ink-soft text-xs mt-0.5">
                {order.delivery_address || 'No address'}
              </Text>
            </View>
            <Text className="font-mono font-semi text-2xl text-ink">{rupees(order.total_amount_paise || 0)}</Text>
          </View>

          <ItemsCard items={items} />
          {order.voice_text ? (
            <InkCard pad={14} tone="sunk">
              <Text className="text-ink-muted text-[11px] font-semi tracking-wider uppercase">Voice note</Text>
              <Text className="text-ink-soft italic text-sm mt-1">"{order.voice_text}"</Text>
            </InkCard>
          ) : null}

          <View className="mt-1">
            <View className="flex-row justify-between items-center mb-1.5">
              <Text className="text-rose font-semi text-xs">
                Auto-decline in 0:{String(Math.max(0, secsLeft)).padStart(2, '0')}
              </Text>
              <Text className="text-ink-muted text-xs">90s window</Text>
            </View>
            <View className="h-1 bg-hair rounded-full overflow-hidden">
              <View style={{ height: '100%', width: `${Math.max(0, secsLeft) / 90 * 100}%`, backgroundColor: P.rose }} />
            </View>
          </View>
        </ScrollView>
      )}

      {phase === 'packing' && (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 130 }}>
          <InkPill color="mint">Accepted · packing</InkPill>
          <Text className="font-serif text-ink" style={{ fontSize: 26 }}>Pack these items.</Text>
          <Tamil size={13}>இவற்றை பொதியுங்கள்</Tamil>

          <View style={{ gap: 8 }}>
            {items.map((it, i) => {
              const done = !!checked[i];
              return (
                <Pressable key={i} onPress={() => setChecked(prev => ({ ...prev, [i]: !prev[i] }))}>
                  <View
                    className="flex-row items-center px-3.5 py-3.5 rounded-ink"
                    style={{
                      gap: 12,
                      backgroundColor: done ? P.mintSoft : P.bgElev,
                      borderWidth: 1.5,
                      borderColor:     done ? P.mint    : P.hair,
                    }}
                  >
                    <View
                      className="items-center justify-center"
                      style={{
                        width: 28, height: 28, borderRadius: 8,
                        backgroundColor: done ? P.mint : 'transparent',
                        borderWidth: 1.5, borderColor: done ? P.mint : P.hairStrong,
                      }}
                    >
                      {done ? <IconCheck size={14} color="#fff" w={2.5} /> : null}
                    </View>
                    <View className="flex-1">
                      <Text className="font-semi" style={{ fontSize: 15, color: done ? P.inkMuted : P.ink, textDecorationLine: done ? 'line-through' : 'none' }}>
                        {it.name}
                      </Text>
                      <Text className="text-ink-soft text-xs">{it.quantity} {it.unit}</Text>
                    </View>
                    <Text className="text-ink-muted text-[11px] font-semi">Out of stock?</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <InkCard tone="sunk" pad={12}>
            <View className="flex-row justify-between items-center">
              <Text className="text-ink-soft text-xs">Collect on delivery</Text>
              <Text className="font-mono font-semi text-ink">{rupees(order.total_amount_paise || 0)}</Text>
            </View>
          </InkCard>
        </ScrollView>
      )}

      {phase === 'await_runner' && (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 130 }}>
          <InkPill color="amber">Finding runner</InkPill>
          <Text className="font-serif text-ink" style={{ fontSize: 26 }}>Packed — finding a runner.</Text>
          <Tamil size={13}>ரன்னரை தேடுகிறோம்</Tamil>
          <InkCard>
            <Text className="text-ink-muted text-[10px] font-semi tracking-wider uppercase">Estimated arrival</Text>
            <Text className="font-serif text-accent" style={{ fontSize: 34 }}>~5 min</Text>
          </InkCard>
          <ItemsCard items={items} />
        </ScrollView>
      )}

      {phase === 'handoff' && (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 130 }}>
          <InkPill color="amber">Runner here</InkPill>
          <InkCard>
            <View className="flex-row items-center" style={{ gap: 12 }}>
              <View className="rounded-full bg-accent items-center justify-center" style={{ width: 52, height: 52 }}>
                <Text className="text-white font-semi text-lg">{(order.runner_name?.[0] || 'R').toUpperCase()}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-ink font-semi text-base">{order.runner_name || 'Runner'}</Text>
                <View className="flex-row items-center" style={{ gap: 4 }}>
                  <IconBike size={12} />
                  <Text className="text-ink-soft text-xs">{order.runner_vehicle || 'Cycle'}</Text>
                  {order.runner_rating ? (<><Text className="text-ink-soft text-xs">·</Text><IconStar size={12} /><Text className="text-ink-soft text-xs">{order.runner_rating}</Text></>) : null}
                </View>
                {order.runner_vehicle_number ? (
                  <Text className="text-ink-muted text-[10px] font-mono mt-0.5">{order.runner_vehicle_number}</Text>
                ) : null}
              </View>
            </View>
          </InkCard>

          <InkCard style={{ backgroundColor: P.accentSoft, borderColor: P.accent, borderWidth: 1.5 }}>
            <Text className="text-accent-ink text-[11px] font-semi tracking-wider uppercase">Collect cash</Text>
            <View className="flex-row items-baseline justify-between mt-1">
              <Text className="font-serif text-accent-ink" style={{ fontSize: 40, lineHeight: 42 }}>
                {rupees(order.total_amount_paise || 0)}
              </Text>
              <Text className="text-accent-ink text-[11px]" style={{ opacity: 0.7 }}>Paid out EOD</Text>
            </View>
          </InkCard>

          <View className="rounded-ink bg-ink p-4 items-center">
            <Text className="text-paper-elev text-[11px] font-semi tracking-widest uppercase" style={{ opacity: 0.6 }}>Runner code</Text>
            <Text className="text-paper-elev font-mono font-semi" style={{ fontSize: 36, letterSpacing: 6, marginTop: 2 }}>
              {runnerCode(order)}
            </Text>
            <Text className="text-paper-elev text-[11px] mt-1" style={{ opacity: 0.6 }}>Ask runner to read before handing over</Text>
          </View>
        </ScrollView>
      )}

      {(phase === 'enroute' || phase === 'done') && (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
          <InkPill color={order.status === 'delivered' ? 'mint' : order.status === 'declined' || order.status === 'cancelled' ? 'rose' : 'amber'}>
            {order.status}
          </InkPill>
          <Text className="font-serif text-ink" style={{ fontSize: 26 }}>
            {order.status === 'delivered' ? 'Delivered to customer'
              : order.status === 'picked_up' ? 'Runner en route'
              : order.status === 'declined' ? 'You declined this order'
              : order.status === 'expired' ? 'No runner found — expired'
              : 'Cancelled'}
          </Text>
          <ItemsCard items={items} />
        </ScrollView>
      )}

      {phase === 'incoming' && (
        <View className="absolute left-0 right-0 bottom-0 bg-paper-elev border-t border-hair px-4 pt-3 pb-5 flex-row" style={{ gap: 10 }}>
          <InkButton variant="ghost" full size="md" onPress={() => setRejectOpen(true)} disabled={loading}>Decline</InkButton>
          <InkButton variant="accent" full size="md" onPress={() => respond('accept')} disabled={loading}>
            {loading
              ? <ActivityIndicator color="#fff" />
              : (<><IconCheck size={16} color="#fff" /><Text className="text-paper-elev font-semi">Accept</Text></>)}
          </InkButton>
        </View>
      )}

      {phase === 'packing' && (
        <View className="absolute left-0 right-0 bottom-0 bg-paper-elev border-t border-hair px-4 pt-3 pb-5" style={{ gap: 8 }}>
          {order.customer_id && (
            <Pressable onPress={() => setChatOpen(true)} hitSlop={8}>
              <Text className="text-accent font-semi text-sm text-center">💬 Chat with customer</Text>
            </Pressable>
          )}
          <InkButton variant="accent" size="lg" full onPress={markReady} disabled={loading || !allChecked}>
            {loading
              ? <ActivityIndicator color="#fff" />
              : (<><IconCheck size={18} color="#fff" w={2.5} /><Text className="text-paper-elev font-semi">
                  {allChecked ? 'Ready for pickup' : `${packedCount} / ${items.length} packed`}
                </Text></>)}
          </InkButton>
        </View>
      )}

      {phase === 'handoff' && (
        <View className="absolute left-0 right-0 bottom-0 bg-paper-elev border-t border-hair px-4 pt-3 pb-5">
          <InkButton variant="accent" size="lg" full onPress={onBack}>
            <IconCheck size={18} color="#fff" w={2.5} />
            <Text className="text-paper-elev font-semi">Handed off</Text>
          </InkButton>
        </View>
      )}

      {order.customer_id && shop?.id && (
        <ChatModal
          visible={chatOpen}
          onClose={() => setChatOpen(false)}
          orderId={order.id}
          myType="shop"
          myId={shop.id}
          otherType="customer"
          otherId={order.customer_id}
          otherName={order.customer_name || 'Customer'}
        />
      )}

      <Modal transparent visible={rejectOpen} animationType="slide" onRequestClose={() => setRejectOpen(false)}>
        <Pressable onPress={() => setRejectOpen(false)} className="flex-1" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
          <View style={{ flex: 1 }} />
          <View
            className="bg-paper-elev px-5 pt-5 pb-8"
            style={{ borderTopLeftRadius: 28, borderTopRightRadius: 28 }}
            onStartShouldSetResponder={() => true}
          >
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: P.hairStrong, alignSelf: 'center', marginBottom: 14 }} />
            <Text className="font-serif text-ink mb-3" style={{ fontSize: 22 }}>Why decline?</Text>
            <View style={{ gap: 8 }}>
              {['🕐 Too busy', '📦 Out of stock', '🚫 Area too far', '🏠 Shop closing'].map(r => (
                <Pressable key={r} onPress={() => { setRejectOpen(false); respond('decline', r); }}>
                  <View className="flex-row items-center justify-between px-4 py-3 rounded-ink bg-paper-sunk border border-hair">
                    <Text className="text-ink font-semi text-sm">{r}</Text>
                    <IconChevRight size={16} />
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function ItemsCard({ items }) {
  return (
    <InkCard pad={14}>
      <Text className="text-ink-muted text-[11px] font-semi tracking-wider uppercase">Items</Text>
      <View className="mt-2" style={{ gap: 4 }}>
        {items.map((it, i) => (
          <View key={i} className="flex-row justify-between items-center">
            <Text className="text-ink text-sm flex-1">{it.name}</Text>
            <Text className="text-ink-soft text-xs mx-2">×{it.quantity}</Text>
            <Text className="text-ink font-mono text-sm">
              {it.price_paise ? rupees(it.price_paise * it.quantity) : ''}
            </Text>
          </View>
        ))}
      </View>
    </InkCard>
  );
}
