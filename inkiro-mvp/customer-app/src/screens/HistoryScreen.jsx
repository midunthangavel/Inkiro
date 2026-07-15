import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, Pressable, ActivityIndicator, RefreshControl,
} from 'react-native';
import api from '../lib/api';
import { InkCard, InkButton, InkPill, Tamil, IconBag, SkeletonBlock } from '../components/ink';
import { palettes, rupees } from '../theme/tokens';

const P = palettes.light;

const STATUS_META = {
  delivered:       { label: 'Delivered',        color: 'mint' },
  picked_up:       { label: 'On the way',       color: 'amber' },
  runner_assigned: { label: 'Runner assigned',  color: 'amber' },
  accepted:        { label: 'Accepted',         color: 'amber' },
  pending_runner:  { label: 'Finding runner',   color: 'amber' },
  runner_notified: { label: 'Finding runner',   color: 'amber' },
  pending:         { label: 'Broadcasting',     color: 'accent' },
  declined:        { label: 'Declined',         color: 'rose' },
  cancelled:       { label: 'Cancelled',        color: 'rose' },
  expired:         { label: 'Expired',          color: 'ink' },
};

function shortId(id) {
  return id ? `#${String(id).replace(/-/g, '').slice(0, 6).toUpperCase()}` : '#------';
}

function OrderRow({ order, onTrack, onReorder }) {
  const meta    = STATUS_META[order.status] || { label: order.status, color: 'ink' };
  const date    = new Date(order.created_at);
  const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const timeStr = date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  const items   = Array.isArray(order.items) ? order.items : [];
  const preview = items.slice(0, 3).map(i => i.name).join(', ') + (items.length > 3 ? `, +${items.length - 3} more` : '');

  return (
    <Pressable onPress={() => onTrack(order)} className="mx-4 mb-3">
      <InkCard pad={14}>
        <View className="flex-row items-start justify-between">
          <View className="flex-1">
            <Text className="font-mono text-[11px] text-ink-muted font-semi">{shortId(order.id)}</Text>
            <Text className="text-ink font-semi text-base mt-0.5" numberOfLines={1}>
              {order.shop_name || 'Finding shop…'}
            </Text>
          </View>
          <InkPill color={meta.color}>{meta.label}</InkPill>
        </View>
        {items.length > 0 && (
          <Text className="text-ink-soft text-xs mt-2" numberOfLines={1}>{preview}</Text>
        )}
        <View className="flex-row justify-between items-center mt-3 pt-3 border-t border-hair">
          <Text className="text-ink font-semi font-mono">{rupees(order.total_amount_paise || 0)}</Text>
          <Text className="text-ink-muted text-[11px]">{dateStr} · {timeStr}</Text>
        </View>
        {['delivered', 'cancelled', 'expired', 'declined'].includes(order.status) && items.length > 0 && (
          <Pressable
            onPress={() => onReorder(order)}
            hitSlop={8}
            className="items-end mt-2"
          >
            <Text className="text-accent text-xs font-semi">↺ Reorder</Text>
          </Pressable>
        )}
      </InkCard>
    </Pressable>
  );
}

export default function HistoryScreen({ user, onLogout, onTrackOrder, onReorder }) {
  const [orders, setOrders]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOrders = useCallback(async () => {
    if (!user?.phone) return;
    setError(false);
    try {
      const { data } = await api.get(`/orders/customer/phone/${user.phone}`);
      setOrders(data.orders || []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.phone]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const header = (
    <View className="px-5 pt-14 pb-4 flex-row items-center justify-between">
      <View>
        <Text className="font-serif text-ink" style={{ fontSize: 30 }}>My orders</Text>
        <Tamil size={12}>எனது ஆர்டர்கள்</Tamil>
      </View>
      <Pressable onPress={onLogout} hitSlop={10}>
        <Text className="text-ink-muted text-sm font-semi">Sign out</Text>
      </Pressable>
    </View>
  );

  if (loading) {
    return (
      <View className="flex-1 bg-paper">
        {header}
        <View className="px-4 pt-2" style={{ gap: 12 }}>
          {[0, 1, 2, 3].map(i => (
            <View key={i} className="rounded-ink p-4 bg-paper-elev border border-hair" style={{ gap: 10 }}>
              <SkeletonBlock width="38%" height={11} />
              <SkeletonBlock width="68%" height={17} />
              <SkeletonBlock width="90%" height={11} />
              <View className="flex-row justify-between pt-2 mt-1 border-t border-hair">
                <SkeletonBlock width="22%" height={14} />
                <SkeletonBlock width="32%" height={11} />
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 bg-paper">
        {header}
        <View className="flex-1 items-center justify-center px-6" style={{ gap: 16 }}>
          <Text className="text-ink-soft">Could not load your orders.</Text>
          <InkButton variant="accent" onPress={() => { setLoading(true); fetchOrders(); }}>
            Retry
          </InkButton>
        </View>
      </View>
    );
  }

  if (orders.length === 0) {
    return (
      <View className="flex-1 bg-paper">
        {header}
        <View className="flex-1 items-center justify-center px-8" style={{ gap: 14 }}>
          <View
            className="w-[88px] h-[88px] rounded-[22px] items-center justify-center"
            style={{ borderWidth: 2, borderStyle: 'dashed', borderColor: P.hairStrong, backgroundColor: P.bgElev }}
          >
            <IconBag size={36} color={P.inkMuted} />
          </View>
          <Text className="font-serif text-ink text-center" style={{ fontSize: 26 }}>No orders yet</Text>
          <Text className="text-ink-soft text-center text-sm" style={{ maxWidth: 260 }}>
            Your voice orders will appear here once you place one.
          </Text>
          <Tamil size={12}>உங்கள் ஆர்டர்கள் இங்கே தோன்றும்</Tamil>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-paper">
      {header}
      <FlatList
        data={orders}
        keyExtractor={o => o.id}
        renderItem={({ item }) => <OrderRow order={item} onTrack={onTrackOrder} onReorder={onReorder} />}
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchOrders(); }}
            tintColor={P.accent}
          />
        }
      />
    </View>
  );
}
