import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Animated, View, Text, FlatList, Pressable, ActivityIndicator, RefreshControl,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import api            from '../lib/api';
import { getSocket }  from '../lib/socket';
import {
  InkCard, InkButton, InkPill, Tamil, LanguageToggle, IconBell,
} from '../components/ink';
import { palettes, rupees } from '../theme/tokens';

const P = palettes.light;

const TABS = [
  { id: 'incoming',  label: 'Incoming'  },
  { id: 'preparing', label: 'Preparing' },
  { id: 'today',     label: 'Today'     },
];

const PHASE = {
  pending:         'incoming',
  accepted:        'preparing',
  pending_runner:  'preparing',
  runner_notified: 'preparing',
  runner_assigned: 'preparing',
  picked_up:       'preparing',
  delivered:       'today',
  declined:        'today',
  cancelled:       'today',
  expired:         'today',
};

const STATUS_PILL = {
  pending:         { label: 'New',            color: 'accent' },
  accepted:        { label: 'Packing',        color: 'amber' },
  pending_runner:  { label: 'Finding runner', color: 'amber' },
  runner_notified: { label: 'Finding runner', color: 'amber' },
  runner_assigned: { label: 'Runner coming',  color: 'amber' },
  picked_up:       { label: 'En route',       color: 'mint' },
  delivered:       { label: 'Delivered',      color: 'mint' },
  declined:        { label: 'Declined',       color: 'rose' },
  cancelled:       { label: 'Cancelled',      color: 'rose' },
  expired:         { label: 'Expired',        color: 'ink' },
};

function shortId(id) {
  return id ? `#${String(id).replace(/-/g, '').slice(0, 6).toUpperCase()}` : '#------';
}

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso); const now = new Date();
  return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

function OrderCard({ order, onPress }) {
  const pill   = STATUS_PILL[order.status] || { label: order.status, color: 'ink' };
  const urgent = order.status === 'pending';
  const items  = Array.isArray(order.items) ? order.items : [];
  const preview = items.slice(0, 3).map(i => `${i.name} ×${i.quantity}`).join(', ') + (items.length > 3 ? `, +${items.length - 3}` : '');
  return (
    <Pressable onPress={() => onPress(order)} className="mx-4 mb-3">
      <InkCard pad={14} className={urgent ? 'border-accent border-2' : ''}>
        <View className="flex-row items-center justify-between">
          <Text className="font-mono text-[11px] text-ink-muted font-semi">{shortId(order.id)}</Text>
          <InkPill color={pill.color}>{pill.label}</InkPill>
        </View>
        <View className="flex-row items-start justify-between mt-1">
          <Text className="text-ink font-semi text-base flex-1" numberOfLines={1}>
            {order.customer_name || 'Customer'}
          </Text>
          <Text className="text-ink font-semi font-mono">{rupees(order.total_amount_paise || 0)}</Text>
        </View>
        <Text className="text-ink-soft text-xs mt-1" numberOfLines={2}>{preview}</Text>
        {urgent ? (
          <View className="mt-2 pt-2 border-t border-hair flex-row justify-end">
            <Text className="text-accent font-semi text-xs">Tap to respond →</Text>
          </View>
        ) : null}
      </InkCard>
    </Pressable>
  );
}

export default function OrdersScreen({ shop, user, onLogout, onOpenOrder }) {
  const [tab, setTab]               = useState('incoming');
  const [orders, setOrders]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(false);
  const [socketOk, setSocketOk]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const socketRef = useRef(null);
  const tabAnims = useRef(TABS.map((t) => new Animated.Value(t.id === 'incoming' ? 1 : 0))).current;

  const fetchOrders = useCallback(async () => {
    if (!shop?.id) return;
    setError(false);
    try {
      const { data } = await api.get(`/shops/${shop.id}/orders`);
      setOrders(data.orders || []);
    } catch { setError(true); }
    finally { setLoading(false); setRefreshing(false); }
  }, [shop?.id]);

  useEffect(() => {
    if (!shop?.id) return;
    fetchOrders();
    const socket = getSocket();
    socketRef.current = socket;
    socket.connect();
    socket.emit('join:shop', shop.id);

    socket.on('connect',       () => setSocketOk(true));
    socket.on('connect_error', () => setSocketOk(false));
    socket.on('disconnect',    () => setSocketOk(false));

    socket.on('order:new', (o) => {
      setOrders(prev => [o, ...prev]);
      Notifications.scheduleNotificationAsync({
        content: {
          title: 'New Order!',
          body:  `From ${o.customer_name || 'a customer'} — ${rupees(o.total_amount_paise || 0)}`,
          sound: true,
        },
        trigger: null,
      });
    });
    socket.on('order:updated', (o) => {
      setOrders(prev => prev.map(x => x.id === o.id ? { ...x, ...o } : x));
    });

    return () => {
      socket.off('connect'); socket.off('connect_error'); socket.off('disconnect');
      socket.off('order:new'); socket.off('order:updated');
      socket.disconnect();
    };
  }, [shop?.id, fetchOrders]);

  useEffect(() => {
    TABS.forEach((t, i) => {
      Animated.timing(tabAnims[i], {
        toValue: tab === t.id ? 1 : 0,
        duration: 150,
        useNativeDriver: false,
      }).start();
    });
  }, [tab]);

  const filtered        = orders.filter(o => PHASE[o.status] === tab);
  const todayDelivered  = orders.filter(o => o.status === 'delivered' && isToday(o.completed_at || o.created_at));
  const todayRevenue    = todayDelivered.reduce((s, o) => s + (o.total_amount_paise || 0), 0);
  const incomingCount   = orders.filter(o => o.status === 'pending').length;

  if (loading) {
    return (
      <View className="flex-1 bg-paper items-center justify-center">
        <ActivityIndicator color={P.accent} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-paper">
      <View className="px-5 pt-14 pb-3">
        <View className="flex-row items-start justify-between">
          <View className="flex-1">
            <Text className="font-serif text-ink" style={{ fontSize: 24, lineHeight: 28 }}>
              {shop?.shop_name || 'My shop'}
            </Text>
            <Text className="text-ink-muted text-[11px] font-semi tracking-widest uppercase mt-0.5">
              {user?.phone}
            </Text>
          </View>
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <LanguageToggle />
            <InkPill color={shop?.is_active !== false ? 'mint' : 'ink'}>
              {shop?.is_active !== false ? '● Open' : 'Closed'}
            </InkPill>
          </View>
        </View>

        {!socketOk && (
          <View className="mt-3 px-3 py-1.5 rounded-full bg-amber-soft flex-row items-center self-start" style={{ gap: 6 }}>
            <Text className="text-amber text-xs font-semi">● offline — pull to refresh</Text>
          </View>
        )}
      </View>

      <View className="flex-row px-4 pb-2 border-b border-hair">
        {TABS.map((t, i) => {
          const active = tab === t.id;
          const count = t.id === 'incoming' ? incomingCount : null;
          return (
            <Pressable key={t.id} onPress={() => setTab(t.id)} className="flex-1 items-center pt-2 pb-3">
              <View className="flex-row items-center" style={{ gap: 6 }}>
                <Text className={`font-semi ${active ? 'text-accent' : 'text-ink-muted'}`}>{t.label}</Text>
                {count ? (
                  <View className="px-1.5 rounded-full bg-accent">
                    <Text className="text-paper-elev text-[10px] font-semi">{count}</Text>
                  </View>
                ) : null}
              </View>
              <Animated.View style={{
                height: 2,
                width: '70%',
                backgroundColor: tabAnims[i].interpolate({
                  inputRange: [0, 1],
                  outputRange: ['transparent', P.accent],
                }),
                marginTop: 6,
                borderRadius: 2,
              }} />
            </Pressable>
          );
        })}
      </View>

      {error ? (
        <View className="flex-1 items-center justify-center px-6" style={{ gap: 14 }}>
          <Text className="text-ink-soft">Could not load orders</Text>
          <InkButton variant="accent" onPress={() => { setLoading(true); fetchOrders(); }}>Retry</InkButton>
        </View>
      ) : filtered.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8" style={{ gap: 12 }}>
          <View
            className="w-[110px] h-[110px] rounded-full items-center justify-center"
            style={{ borderWidth: 3, borderStyle: 'dashed', borderColor: P.hairStrong, backgroundColor: P.bgElev }}
          >
            <IconBell size={44} color={P.inkMuted} />
          </View>
          <Text className="font-serif text-ink text-center" style={{ fontSize: 22 }}>
            {tab === 'incoming' ? 'Waiting for orders…' : `No ${tab} orders`}
          </Text>
          {tab === 'incoming' && <Tamil size={12}>ஆர்டர் வரும் வரை காத்திருங்கள்</Tamil>}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={o => o.id}
          renderItem={({ item }) => <OrderCard order={item} onPress={onOpenOrder} />}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 140 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchOrders(); }} tintColor={P.accent} />
          }
        />
      )}

      <View className="absolute left-0 right-0 bottom-0 bg-paper-elev border-t border-hair px-4 pt-3 pb-5 flex-row items-center">
        <View className="flex-1">
          <Text className="text-ink-muted text-[10px] font-semi tracking-widest uppercase">Today</Text>
          <Text className="text-ink font-semi font-mono text-xl">{rupees(todayRevenue)}</Text>
        </View>
        <View className="items-end">
          <Text className="text-ink-muted text-[10px] font-semi tracking-widest uppercase">Orders</Text>
          <Text className="text-ink font-semi font-mono text-xl">{todayDelivered.length}</Text>
        </View>
        <Pressable onPress={onLogout} hitSlop={10} className="ml-6">
          <Text className="text-ink-muted text-xs font-semi">Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}
