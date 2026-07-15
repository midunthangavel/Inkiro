import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, Animated, Easing, Linking, Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import Svg, { Path, Rect, G } from 'react-native-svg';
import { getSocket } from '../lib/socket';
import api from '../lib/api';
import {
  InkCard, InkButton, InkPill, Tamil,
  IconCheck, IconBike, IconStar, IconPhone, IconHome, IconClock, IconBag,
} from '../components/ink';
import { palettes, rupees } from '../theme/tokens';
import ChatModal from '../components/ChatModal';

const P = palettes.light;

function phaseOf(status) {
  if (['pending', 'pending_runner', 'runner_notified'].includes(status)) return 'broadcast';
  if (['accepted', 'runner_assigned'].includes(status))                   return 'timeline';
  if (status === 'picked_up')                                             return 'map';
  if (status === 'delivered')                                             return 'delivered';
  if (['declined', 'cancelled', 'expired'].includes(status))              return 'failed';
  return 'timeline';
}

function shortId(id) {
  return id ? `#${String(id).replace(/-/g, '').slice(0, 6).toUpperCase()}` : '#------';
}

export default function OrderTrackerScreen({ order: initialOrder, user, onDone }) {
  const [order, setOrder]           = useState(initialOrder);
  const [rating, setRating]         = useState(0);
  const [socketOk, setSocketOk]     = useState(true);
  const [chatOpen, setChatOpen]     = useState(false);
  const [etaMin, setEtaMin]         = useState(null);
  const [confetti, setConfetti]     = useState(false);
  const [refreshFails, setRefreshFails] = useState(0);
  const socketRef = useRef(null);
  const etaTimerRef = useRef(null);
  const soundRef = useRef(null);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;
    socket.connect();
    socket.emit('join:customer', order.user_id || order.customer_id);

    socket.on('connect',       () => setSocketOk(true));
    socket.on('connect_error', () => setSocketOk(false));
    socket.on('disconnect',    () => setSocketOk(false));
    socket.on('order:updated', (u) => {
      if (u.id === order.id) {
        setOrder(prev => ({ ...prev, ...u }));
        if (u.status === 'delivered') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setConfetti(true);
          Audio.Sound.createAsync(require('../../assets/delivered.wav'))
            .then(({ sound }) => { soundRef.current = sound; sound.playAsync(); })
            .catch(() => {});
        } else {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
      }
    });

    return () => {
      socket.off('connect'); socket.off('connect_error'); socket.off('disconnect'); socket.off('order:updated');
      socket.disconnect();
      soundRef.current?.unloadAsync();
    };
  }, [order.id]);

  // ETA countdown — starts when order has a created_at, refreshes every 60s
  useEffect(() => {
    function calcEta() {
      if (!order.created_at) return;
      const createdMs  = new Date(order.created_at).getTime();
      const etaMs      = createdMs + 25 * 60 * 1000; // 25 minutes
      const remaining  = Math.max(0, Math.ceil((etaMs - Date.now()) / 60000));
      setEtaMin(remaining);
    }
    calcEta();
    etaTimerRef.current = setInterval(calcEta, 60000);
    return () => clearInterval(etaTimerRef.current);
  }, [order.created_at]);

  async function refresh() {
    try {
      const { data } = await api.get(`/orders/${order.id}`);
      if (data.order) setOrder(data.order);
      setRefreshFails(0);
    } catch {
      setRefreshFails(f => f + 1);
    }
  }

  async function cancelOrder() {
    Alert.alert(
      'Cancel order?',
      'This will cancel your order.',
      [
        { text: 'Keep order', style: 'cancel' },
        {
          text: 'Yes, cancel', style: 'destructive',
          onPress: async () => {
            try {
              await api.post(`/orders/${order.id}/cancel`);
            } catch {}
            onDone();
          },
        },
      ]
    );
  }

  async function submitAndExit() {
    if (rating) {
      try { await api.post(`/orders/${order.id}/rate`, { rating }); } catch {}
    }
    onDone();
  }

  const phase = phaseOf(order.status);
  const etaColor = etaMin === null ? P.accent : etaMin > 10 ? P.mint : etaMin > 5 ? P.amber : P.rose;

  const chatModal = (
    <ChatModal
      visible={chatOpen}
      onClose={() => setChatOpen(false)}
      orderId={order.id}
      myType="customer"
      myId={user?.id || order.customer_id}
      otherType={order.runner_id ? 'runner' : 'shop'}
      otherId={order.runner_id || order.shop_id}
      otherName={order.runner_name || order.shop_name || 'Shop'}
    />
  );

  // ─── BROADCASTING ──────────────────────────────────────────────────────
  if (phase === 'broadcast') {
    return (
      <View className="flex-1 bg-paper">
        <Header order={order} socketOk={socketOk} />
        <View className="flex-1 items-center justify-center">
          <RippleHero>
            <View
              className="w-[72px] h-[72px] rounded-full bg-accent items-center justify-center"
              style={{
                shadowColor: P.accent, shadowOpacity: 0.35, shadowRadius: 18,
                shadowOffset: { width: 0, height: 8 }, elevation: 6,
              }}
            >
              <IconBag size={32} color="#fff" />
            </View>
          </RippleHero>
          <Text className="font-serif text-ink mt-6" style={{ fontSize: 28 }}>Finding a shop…</Text>
          <Tamil size={13}>கடை தேடுகிறோம்</Tamil>
        </View>
        <InkCard className="mx-4 mb-6">
          <Text className="font-semi text-ink">Nearby kiranas pinged</Text>
          <Text className="text-ink-soft text-xs mt-1">First to accept takes it. Hang tight.</Text>
          <View className="flex-row items-center mt-3 pt-3 border-t border-hair" style={{ gap: 10 }}>
            <IconClock size={14} />
            <Text className="text-ink-muted text-xs font-mono">waiting…</Text>
            <Pressable onPress={cancelOrder} className="ml-auto" accessibilityLabel="Cancel order" accessibilityRole="button">
              <Text className="text-rose font-semi text-xs">Cancel</Text>
            </Pressable>
          </View>
        </InkCard>
      </View>
    );
  }

  // ─── TIMELINE (accepted / runner_assigned) ─────────────────────────────
  if (phase === 'timeline') {
    const currentIdx = order.status === 'accepted' ? 1 : 2;
    const steps = [
      { label: 'Placed',    done: true },
      { label: 'Accepted',  done: true },
      { label: 'Picked',    done: false, active: currentIdx >= 2 },
      { label: 'Delivered', done: false, active: false },
    ];
    return (
      <>
      <View className="flex-1 bg-paper">
        <Header order={order} socketOk={socketOk} refreshFails={refreshFails}>
          <InkPill color="amber">{order.status === 'runner_assigned' ? 'Runner assigned' : 'Accepted'}</InkPill>
        </Header>
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
          {order.shop_name ? (
            <InkCard>
              <Text className="text-ink-muted text-[10px] font-semi tracking-wider uppercase">Shop</Text>
              <Text className="text-ink font-semi mt-1 text-base">{order.shop_name}</Text>
              {order.shop_address ? <Text className="text-ink-soft text-xs mt-0.5">{order.shop_address}</Text> : null}
            </InkCard>
          ) : null}

          {order.runner_name ? (
            <InkCard>
              <View className="flex-row items-center" style={{ gap: 12 }}>
                <View className="w-11 h-11 rounded-full bg-accent items-center justify-center">
                  <Text className="text-white font-semi text-lg">{order.runner_name[0].toUpperCase()}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-ink-muted text-[10px] font-semi tracking-wider uppercase">Runner</Text>
                  <Text className="text-ink font-semi text-base">{order.runner_name}</Text>
                  <View className="flex-row items-center mt-0.5" style={{ gap: 4 }}>
                    <IconBike size={12} />
                    <Text className="text-ink-soft text-xs">{order.runner_vehicle || 'Cycle'}</Text>
                  </View>
                </View>
                {order.runner_phone ? (
                  <View className="w-9 h-9 rounded-full bg-mint items-center justify-center">
                    <IconPhone size={14} color="#fff" />
                  </View>
                ) : null}
              </View>
            </InkCard>
          ) : null}

          <InkCard>
            <View className="flex-row">
              {steps.map((s, i) => (
                <View key={i} className="flex-1 items-center" style={{ position: 'relative' }}>
                  {i > 0 && (
                    <View style={{
                      position: 'absolute', top: 14, right: '50%', width: '100%', height: 2,
                      backgroundColor: s.done || steps[i - 1].done ? P.accent : P.hair,
                    }} />
                  )}
                  <View
                    className="items-center justify-center"
                    style={{
                      zIndex: 1, width: 30, height: 30, borderRadius: 15,
                      backgroundColor: s.done ? P.accent : s.active ? P.bg : P.bgSunken,
                      borderWidth: 2,
                      borderColor: s.done || s.active ? P.accent : P.hairStrong,
                    }}
                  >
                    {s.done
                      ? <IconCheck size={14} color="#fff" w={2.5} />
                      : <Text className="text-[11px] font-semi" style={{ color: P.accent }}>{i + 1}</Text>}
                  </View>
                  <Text className={`text-[11px] mt-1.5 font-semi ${s.done || s.active ? 'text-ink' : 'text-ink-muted'}`}>
                    {s.label}
                  </Text>
                </View>
              ))}
            </View>
          </InkCard>

          <ItemsAndTotal order={order} />

          <View className="flex-row" style={{ gap: 10 }}>
            <Pressable onPress={refresh} className="flex-1 items-center py-2">
              <Text className="text-accent font-semi text-sm">Refresh status</Text>
            </Pressable>
            {order.shop_id && (
              <Pressable onPress={() => setChatOpen(true)} className="flex-1 items-center py-2">
                <Text className="text-ink font-semi text-sm">💬 Chat shop</Text>
              </Pressable>
            )}
          </View>

          {['accepted', 'runner_assigned'].includes(order.status) && (
            <Pressable onPress={cancelOrder} className="items-center py-1">
              <Text className="text-rose text-xs font-semi">Cancel order</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
      {chatModal}
      </>
    );
  }

  // ─── MAP (en-route) ────────────────────────────────────────────────────
  if (phase === 'map') {
    return (
      <>
      <View className="flex-1" style={{ backgroundColor: '#E8E3D5' }}>
        <Header order={order} socketOk={socketOk} refreshFails={refreshFails} transparent>
          <InkPill color="amber">On the way</InkPill>
        </Header>
        <View className="flex-1">
          <StylizedMap />
        </View>
        <View
          className="bg-paper-elev"
          style={{
            borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 18,
            shadowColor: '#000', shadowOffset: { width: 0, height: -12 },
            shadowOpacity: 0.12, shadowRadius: 32, elevation: 10,
          }}
        >
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: P.hairStrong, alignSelf: 'center', marginTop: -4, marginBottom: 12 }} />
          <View className="flex-row items-center" style={{ gap: 12 }}>
            <View className="w-11 h-11 rounded-full bg-accent-soft items-center justify-center">
              <Text className="text-accent-ink font-semi">{(order.runner_name?.[0] || 'R').toUpperCase()}</Text>
            </View>
            <View className="flex-1">
              <Text className="text-ink font-semi text-sm">{order.runner_name || 'Runner'} is nearby</Text>
              <Text className="text-ink-soft text-xs">
                Picked up · {(order.items?.length ?? 0)} items bagged
              </Text>
            </View>
            <View className="items-end">
              <Text className="font-serif text-accent" style={{ fontSize: 28, lineHeight: 28 }}>~{order.eta_minutes ?? 5}'</Text>
              <Text className="text-ink-muted text-[10px] font-semi tracking-wider uppercase">min</Text>
            </View>
          </View>
          {etaMin !== null && (
            <View className="flex-row items-center mt-1" style={{ gap: 6 }}>
              <IconClock size={13} />
              <Text className="text-xs font-semi" style={{ color: etaColor }}>
                {etaMin > 0 ? `~${etaMin} min away` : 'Arriving now'}
              </Text>
            </View>
          )}
          <View className="flex-row mt-4" style={{ gap: 10 }}>
            {order.runner_phone ? (
              <InkButton variant="mint" size="md" full onPress={() => Linking.openURL(`tel:${order.runner_phone}`)}>
                <IconPhone size={14} /><Text className="text-paper-elev font-semi">Call</Text>
              </InkButton>
            ) : null}
            <InkButton variant="ghost" size="md" full onPress={() => setChatOpen(true)}>
              💬 Chat
            </InkButton>
          </View>
        </View>
      </View>
      {chatModal}
      </>
    );
  }

  // ─── DELIVERED ─────────────────────────────────────────────────────────
  if (phase === 'delivered') {
    const firstName = order.customer_name?.split(' ')[0];
    return (
      <>
      <View className="flex-1" style={{ backgroundColor: P.bg }}>
        <View style={{ paddingTop: 60, paddingHorizontal: 24, backgroundColor: P.mintSoft, paddingBottom: 28 }}>
          <View
            className="w-16 h-16 rounded-full bg-mint items-center justify-center"
            style={{
              shadowColor: P.mint, shadowOpacity: 0.3, shadowRadius: 16,
              shadowOffset: { width: 0, height: 8 }, elevation: 6,
            }}
          >
            <IconCheck size={32} color="#fff" w={3} />
          </View>
          <Text className="font-serif text-ink mt-5" style={{ fontSize: 38, lineHeight: 40 }}>Delivered.</Text>
          <Text className="text-ink-soft mt-2">
            Enjoy your groceries{firstName ? `, ${firstName}` : ''}.
          </Text>
          <Tamil size={13}>நன்றி · அடுத்த முறை சந்திப்போம்</Tamil>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
          <InkCard>
            <View className="flex-row justify-between items-center">
              <Text className="text-ink-soft text-sm">Paid</Text>
              <View className="flex-row items-baseline" style={{ gap: 8 }}>
                <Text className="text-ink font-semi font-mono text-lg">{rupees(order.total_amount_paise || 0)}</Text>
                <Text className="text-ink-muted text-[11px] font-semi tracking-wider uppercase">Cash</Text>
              </View>
            </View>
          </InkCard>

          {order.runner_name ? (
            <InkCard>
              <Text className="text-ink-muted text-[11px] font-semi tracking-wider uppercase">
                How was {order.runner_name.split(' ')[0]}?
              </Text>
              <View className="flex-row mt-3 justify-between">
                {[1, 2, 3, 4, 5].map(n => (
                  <Pressable
                    key={n}
                    onPress={() => setRating(n)}
                    accessibilityLabel={`Rate ${n} star${n === 1 ? '' : 's'}`}
                    accessibilityRole="button"
                    className="flex-1 aspect-square items-center justify-center rounded-2xl bg-paper-sunk"
                    style={{ maxHeight: 48, marginHorizontal: 4 }}
                  >
                    <IconStar size={22} color={n <= rating ? P.amber : P.hairStrong} filled={n <= rating} />
                  </Pressable>
                ))}
              </View>
            </InkCard>
          ) : null}

          <ItemsAndTotal order={order} />
        </ScrollView>

        <View className="px-4 pb-6">
          <InkButton variant="accent" size="lg" full onPress={submitAndExit}>Reorder</InkButton>
        </View>
      </View>
      <ConfettiBurst visible={confetti} onDone={() => setConfetti(false)} />
      {chatModal}
      </>
    );
  }

  // ─── FAILED ────────────────────────────────────────────────────────────
  return (
    <>
      <View className="flex-1 bg-paper">
        <Header order={order} socketOk={socketOk} />
        <View className="flex-1 items-center justify-center px-6" style={{ gap: 14 }}>
          <View className="w-14 h-14 rounded-full bg-rose-soft items-center justify-center">
            <Text style={{ fontSize: 28, color: P.rose }}>✕</Text>
          </View>
          <Text className="font-serif text-ink text-center" style={{ fontSize: 30 }}>
            {order.status === 'expired'  ? 'No shops accepted'
              : order.status === 'declined' ? 'Shop declined'
              : 'Order cancelled'}
          </Text>
          <Text className="text-ink-soft text-center">
            {order.status === 'expired'
              ? 'Kiranas nearby may be closed. Try again later.'
              : 'Sorry — this order could not go through.'}
          </Text>
          <InkButton variant="accent" size="lg" onPress={onDone}>Place new order</InkButton>
        </View>
      </View>
      <ConfettiBurst visible={confetti} onDone={() => setConfetti(false)} />
      <ChatModal
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        orderId={order.id}
        myType="customer"
        myId={user?.id || order.customer_id}
        otherType={order.runner_id ? 'runner' : 'shop'}
        otherId={order.runner_id || order.shop_id}
        otherName={order.runner_name || order.shop_name || 'Shop'}
      />
    </>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────
function Header({ order, socketOk, refreshFails = 0, children, transparent = false }) {
  const showBanner = !socketOk || refreshFails >= 2;
  return (
    <View style={transparent ? { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 } : undefined}>
      <View className="px-5 pt-14 pb-3 flex-row items-center justify-between">
        <View>
          <Text className="text-ink-muted text-[11px] font-semi tracking-wider uppercase">Order</Text>
          <Text className="font-mono text-ink font-semi" style={{ fontSize: 14 }}>{shortId(order.id)}</Text>
        </View>
        <View className="flex-row items-center" style={{ gap: 8 }}>
          {children}
        </View>
      </View>
      {showBanner && (
        <View className="mx-4 mb-2 px-3 py-1.5 rounded-full bg-amber-soft flex-row items-center" style={{ gap: 6 }}>
          <Text className="text-amber text-xs font-semi">● Connection lost — reconnecting…</Text>
        </View>
      )}
    </View>
  );
}

function ItemsAndTotal({ order }) {
  return (
    <InkCard pad={14}>
      <Text className="text-ink-muted text-[11px] font-semi tracking-wider uppercase">Your items</Text>
      <View className="mt-2" style={{ gap: 4 }}>
        {(order.items || []).map((it, i) => (
          <View key={i} className="flex-row justify-between">
            <Text className="text-ink text-sm flex-1">{it.name} ×{it.quantity}</Text>
            <Text className="text-ink-soft text-sm font-mono">
              {it.price_paise ? rupees(it.price_paise * it.quantity) : ''}
            </Text>
          </View>
        ))}
      </View>
      {order.total_amount_paise ? (
        <View className="flex-row justify-between pt-2 mt-2 border-t border-hair">
          <Text className="text-ink font-semi">Total</Text>
          <Text className="text-ink font-semi font-mono">{rupees(order.total_amount_paise)}</Text>
        </View>
      ) : null}
    </InkCard>
  );
}

function RippleHero({ children }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, { toValue: 1, duration: 2200, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const rings = [0, 0.4, 0.8];
  return (
    <View style={{ width: 240, height: 240, alignItems: 'center', justifyContent: 'center' }}>
      {rings.map((offset, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            width: 240 - i * 24, height: 240 - i * 24, borderRadius: 240,
            borderWidth: 1.5, borderColor: P.accent,
            opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.5 - i * 0.1, 0] }),
            transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.7 + offset * 0.1, 1.1] }) }],
          }}
        />
      ))}
      <View
        style={{
          width: 96, height: 96, borderRadius: 48,
          backgroundColor: P.accentSoft,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        {children}
      </View>
    </View>
  );
}

// ─── ConfettiBurst ──────────────────────────────────────────────────────────
// Simple animated confetti using emoji, no external dependency.
function ConfettiBurst({ visible, onDone }) {
  const items = ['🎉', '🎊', '✨', '🌟', '🎈', '💚', '🌿', '✅'];
  const anims = useRef(items.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!visible) return;
    const animations = anims.map((a) => {
      a.setValue(0);
      return Animated.timing(a, { toValue: 1, duration: 1400 + Math.random() * 400, useNativeDriver: true });
    });
    Animated.stagger(60, animations).start(() => { onDone?.(); });
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }}>
      {items.map((emoji, i) => {
        const x = 30 + (i / items.length) * 320;
        return (
          <Animated.Text
            key={i}
            style={{
              position: 'absolute', left: x, fontSize: 28,
              top: anims[i].interpolate({ inputRange: [0, 1], outputRange: [-40, 700] }),
              opacity: anims[i].interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
              transform: [{ rotate: anims[i].interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${(i % 2 === 0 ? 360 : -360)}deg`] }) }],
            }}
          >
            {emoji}
          </Animated.Text>
        );
      })}
    </View>
  );
}

function StylizedMap() {
  return (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      <Svg viewBox="0 0 390 520" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
        <Rect width="390" height="520" fill="#E8E3D5" />
        <Rect x="20"  y="60"  width="80"  height="120" rx="6" fill="#D0D8BD" />
        <Rect x="240" y="280" width="130" height="160" rx="8" fill="#D0D8BD" />
        <Rect x="30"  y="340" width="80"  height="100" rx="6" fill="#CAD8DE" />
        <G stroke="#F5EFE4" strokeWidth="20" strokeLinecap="round">
          <Path d="M-10 220 L400 220" />
          <Path d="M-10 380 L400 380" />
          <Path d="M120 -10 L120 540" />
          <Path d="M280 -10 L280 540" />
        </G>
        <G stroke="#FFFBF2" strokeWidth="10" strokeLinecap="round">
          <Path d="M-10 120 L400 120" />
          <Path d="M200 -10 L200 540" />
        </G>
        <Path d="M90 150 Q 150 220, 200 260 T 300 380" stroke={P.accent} strokeWidth="5" strokeDasharray="2 6" fill="none" strokeLinecap="round" />
      </Svg>
      <View style={{ position: 'absolute', top: 130, left: 66, alignItems: 'center' }}>
        <View style={{ backgroundColor: P.ink, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
          <Text className="text-paper text-[10px] font-semi">Shop</Text>
        </View>
      </View>
      <View style={{ position: 'absolute', top: 360, left: 270 }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: P.bg, borderWidth: 2, borderColor: P.ink, alignItems: 'center', justifyContent: 'center' }}>
          <IconHome size={14} color={P.ink} />
        </View>
      </View>
      <View style={{ position: 'absolute', top: 240, left: 180 }}>
        <View
          style={{
            width: 44, height: 44, borderRadius: 22, backgroundColor: P.accent,
            alignItems: 'center', justifyContent: 'center',
            shadowColor: P.accent, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
          }}
        >
          <IconBike size={22} color="#fff" />
        </View>
      </View>
    </View>
  );
}
