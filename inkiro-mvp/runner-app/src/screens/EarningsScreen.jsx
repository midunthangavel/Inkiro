import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, RefreshControl, ActivityIndicator, Pressable, Alert,
} from 'react-native';
import api from '../lib/api';
import { InkCard, SkeletonBlock, InkButton, Tamil } from '../components/ink';
import { palettes, rupees } from '../theme/tokens';

const P = palettes.light;

function shortId(id) { return id ? `#${String(id).replace(/-/g, '').slice(0, 6).toUpperCase()}` : '#------'; }

export default function EarningsScreen({ runner, onBack }) {
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [error, setError]             = useState(false);
  const [jobs, setJobs]               = useState([]);
  const [withdrawing, setWithdrawing] = useState(false);

  const fetch = useCallback(async () => {
    if (!runner?.id) return;
    setError(false);
    try {
      const [earnings, history] = await Promise.all([
        api.get(`/runners/${runner.id}/earnings`),
        api.get(`/runners/${runner.id}/history`).catch(() => ({ data: { orders: [] } })),
      ]);
      setData(earnings.data);
      setJobs(history.data.orders || []);
    } catch {
      setError(true);
    } finally { setLoading(false); setRefreshing(false); }
  }, [runner?.id]);

  useEffect(() => { fetch(); }, [fetch]);

  if (loading) {
    return (
      <View className="flex-1 bg-paper">
        <View className="px-5 pt-14 pb-3" style={{ gap: 8 }}>
          <SkeletonBlock width="30%" height={11} />
          <SkeletonBlock width="55%" height={36} rounded={8} />
          <SkeletonBlock width="50%" height={14} />
        </View>
        <InkCard className="mx-4 mt-2" pad={16}>
          <SkeletonBlock height={90} rounded={6} />
        </InkCard>
        <View className="px-4 mt-4" style={{ gap: 8 }}>
          <SkeletonBlock width="30%" height={11} />
          {[0, 1, 2].map(i => (
            <View key={i} className="px-3 py-2.5 rounded-ink bg-paper-elev border border-hair flex-row items-center" style={{ gap: 12 }}>
              <View style={{ flex: 1, gap: 6 }}>
                <SkeletonBlock width="35%" height={13} />
                <SkeletonBlock width="55%" height={11} />
              </View>
              <SkeletonBlock width="18%" height={14} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 bg-paper items-center justify-center px-6" style={{ gap: 12 }}>
        <Pressable onPress={onBack} hitSlop={10} className="absolute top-14 left-5">
          <Text className="text-ink-muted font-semi">← Back</Text>
        </Pressable>
        <Text className="text-ink-soft text-sm text-center">Couldn't load earnings.</Text>
        <Pressable onPress={() => { setLoading(true); fetch(); }}>
          <Text className="text-accent font-semi text-sm">Pull to refresh or tap to retry</Text>
        </Pressable>
      </View>
    );
  }

  const days        = data?.daily || [];
  const barData     = days.length === 7 ? days : Array.from({ length: 7 }).map((_, i) => days[i] || { earnings_paise: 0 });
  const maxE        = Math.max(1, ...barData.map(d => d.earnings_paise || 0));
  const weekLabels  = ['M','T','W','T','F','S','S'];

  return (
    <ScrollView
      className="flex-1 bg-paper"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetch(); }} tintColor={P.accent} />}
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      <View className="px-5 pt-14 pb-3">
        <Pressable onPress={onBack} hitSlop={10}>
          <Text className="text-ink-muted font-semi">← Back</Text>
        </Pressable>
      </View>

      <View className="px-5">
        <Text className="text-ink-muted text-[11px] font-semi tracking-widest uppercase">Earnings</Text>
        <Tamil size={10}>வருமானம்</Tamil>
        <Text className="font-serif text-ink mt-1" style={{ fontSize: 36, lineHeight: 38 }}>
          Today · {rupees(data?.today_total ?? 0)}
        </Text>
        <Tamil size={11}>இன்று</Tamil>
        <Text className="text-ink-soft text-sm mt-1">
          {data?.today_orders ?? 0} deliveries · lifetime {rupees(data?.total_earnings ?? 0)}
        </Text>
      </View>

      <InkCard className="mx-4 mt-4" pad={16}>
        <View className="flex-row items-end" style={{ height: 110, gap: 8 }}>
          {barData.slice(0, 7).map((d, i) => {
            const ratio = Math.max(0.05, (d.earnings_paise || 0) / maxE);
            const isToday = i === 6;
            return (
              <View key={i} className="flex-1 items-center" style={{ gap: 6 }}>
                <View style={{
                  width: '100%',
                  height: 90 * ratio,
                  backgroundColor: isToday ? P.accent : P.accentSoft,
                  borderRadius: 6,
                }} />
                <Text className="text-ink-muted text-[11px] font-semi">{weekLabels[i]}</Text>
              </View>
            );
          })}
        </View>
      </InkCard>

      <View className="px-4 mt-4" style={{ gap: 8 }}>
        <Text className="text-ink-muted text-[11px] font-semi tracking-wider uppercase px-2">Recent jobs</Text>
        <Tamil size={10} className="px-2">சமீபத்திய வேலைகள்</Tamil>
        {jobs.length === 0 ? (
          <>
            <Text className="text-ink-soft text-sm italic px-2">No jobs yet</Text>
            <Tamil size={10} className="px-2">இன்னும் வேலை இல்லை</Tamil>
          </>
        ) : (
          jobs.slice(0, 10).map(j => {
            const time = new Date(j.completed_at || j.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
            return (
              <View key={j.id} className="px-3 py-2.5 rounded-ink bg-paper-elev border border-hair flex-row items-center">
                <View className="flex-1">
                  <Text className="text-ink font-semi font-mono text-[13px]">{shortId(j.id)}</Text>
                  <Text className="text-ink-muted text-[11px]">{time} · {j.drop_area || 'Delivery'}</Text>
                </View>
                <Text className="font-mono font-semi text-mint">+{rupees(j.runner_earning_paise || 3000)}</Text>
              </View>
            );
          })
        )}
      </View>

      {(data?.total_earnings ?? 0) > 0 && (
        <View className="px-4 mt-6 mb-2">
          <InkButton
            variant="accent"
            full
            size="md"
            disabled={withdrawing}
            onPress={() => {
              const amt = data.total_earnings;
              Alert.alert(
                'Withdraw earnings',
                `Request a payout of ${rupees(amt)} to your UPI account?`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Request payout',
                    onPress: async () => {
                      setWithdrawing(true);
                      try {
                        await api.post(`/runners/${runner.id}/withdraw`, { amount_paise: amt });
                        Alert.alert('Requested', 'Your payout request has been submitted. We\'ll transfer within 24 hours.');
                      } catch (err) {
                        Alert.alert('Error', err?.response?.data?.error || 'Could not request withdrawal');
                      } finally { setWithdrawing(false); }
                    },
                  },
                ]
              );
            }}
          >
            {withdrawing ? <ActivityIndicator color="#fff" size="small" /> : 'Withdraw earnings'}
          </InkButton>
          <Text className="text-ink-muted text-[11px] text-center mt-2">
            Paid to your UPI ID within 24 hours
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
