import { useState } from 'react';
import {
  View, Text, TextInput, ScrollView, Pressable,
  ActivityIndicator, Alert, Switch,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import Constants from 'expo-constants';
import api from '../lib/api';
import { InkCard, InkButton } from '../components/ink';
import { palettes } from '../theme/tokens';

const P = palettes.light;

const VEHICLE_OPTIONS = [
  { id: 'bike',     label: '🏍 Bike' },
  { id: 'bicycle',  label: '🚲 Bicycle' },
  { id: 'auto',     label: '🛺 Auto' },
  { id: 'walk',     label: '🚶 Walk' },
];

export default function SettingsScreen({ user, runner, onBack, onLogout, onUserUpdated }) {
  const [name, setName]               = useState(user?.name || '');
  const [vehicle, setVehicle]         = useState(runner?.vehicle_type || 'bike');
  const [upiId, setUpiId]             = useState(runner?.upi_id || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingRunner, setSavingRunner]   = useState(false);
  const [notifEnabled, setNotifEnabled]   = useState(true);

  async function saveProfile() {
    const trimmed = name.trim();
    if (!trimmed) { Alert.alert('Name required', 'Please enter your name'); return; }
    setSavingProfile(true);
    try {
      const { data } = await api.put(`/users/${user.id}`, { name: trimmed });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onUserUpdated?.(data.user);
      Alert.alert('Saved', 'Your name has been updated.');
    } catch {
      Alert.alert('Error', 'Could not save name. Try again.');
    } finally { setSavingProfile(false); }
  }

  async function saveRunner() {
    if (!runner?.id) return;
    setSavingRunner(true);
    try {
      await api.post('/runners/update-profile', { vehicle_type: vehicle, upi_id: upiId.trim() || null });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Saved', 'Runner profile updated.');
    } catch {
      Alert.alert('Error', 'Could not save runner profile.');
    } finally { setSavingRunner(false); }
  }

  async function toggleNotifications(val) {
    if (val) {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status === 'granted') {
        setNotifEnabled(true);
        try {
          const { data: token } = await Notifications.getExpoPushTokenAsync({
            projectId: Constants.expoConfig.extra?.eas?.projectId,
          });
          await api.post('/auth/register-push-token', { token, role: 'runner' });
        } catch (e) {
          console.log('push token registration:', e?.message);
        }
      } else {
        Alert.alert('Notifications blocked', 'Enable notifications in your device Settings app.');
      }
    } else {
      Alert.alert(
        'Turn off notifications?',
        'You will stop receiving job alerts. Go to Settings → Inkiro Runner → Notifications.',
        [{ text: 'OK' }],
      );
      setNotifEnabled(false);
    }
  }

  function confirmLogout() {
    Alert.alert('Log out?', 'You will need to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: onLogout },
    ]);
  }

  return (
    <ScrollView className="flex-1 bg-paper" contentContainerStyle={{ paddingBottom: 48 }}>
      {/* Header */}
      <View className="px-5 pt-14 pb-3 flex-row items-center" style={{ gap: 12 }}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Text className="text-ink-muted font-semi">← Back</Text>
        </Pressable>
      </View>

      <View className="px-5 mb-5">
        <Text className="text-ink-muted text-[11px] font-semi tracking-widest uppercase">Settings</Text>
        <Text className="font-serif text-ink mt-1" style={{ fontSize: 32, lineHeight: 34 }}>Your profile</Text>
      </View>

      {/* Name */}
      <InkCard className="mx-4" pad={16}>
        <Text className="text-ink-muted text-[11px] font-semi tracking-wider uppercase mb-2">Display name</Text>
        <View className="flex-row items-center pb-2 border-b border-hair" style={{ gap: 10 }}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your full name"
            placeholderTextColor={P.inkMuted}
            className="flex-1 text-ink text-base font-semi"
            maxLength={60}
            returnKeyType="done"
          />
        </View>
        <View className="mt-3">
          <InkButton variant="accent" size="sm" onPress={saveProfile} disabled={savingProfile}>
            {savingProfile ? <ActivityIndicator color="#fff" size="small" /> : 'Save name'}
          </InkButton>
        </View>
      </InkCard>

      {/* Vehicle type */}
      <InkCard className="mx-4 mt-3" pad={16}>
        <Text className="text-ink-muted text-[11px] font-semi tracking-wider uppercase mb-3">Vehicle type</Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {VEHICLE_OPTIONS.map(v => {
            const active = vehicle === v.id;
            return (
              <Pressable
                key={v.id}
                onPress={() => setVehicle(v.id)}
                className={`px-4 py-2 rounded-full border ${active ? 'bg-accent border-accent' : 'bg-paper-elev border-hair'}`}
              >
                <Text className={`font-semi text-sm ${active ? 'text-paper-elev' : 'text-ink-muted'}`}>{v.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text className="text-ink-muted text-[11px] font-semi tracking-wider uppercase mt-4 mb-2">UPI ID (for payouts)</Text>
        <View className="pb-2 border-b border-hair">
          <TextInput
            value={upiId}
            onChangeText={setUpiId}
            placeholder="yourname@upi"
            placeholderTextColor={P.inkMuted}
            className="text-ink text-base font-semi"
            keyboardType="email-address"
            autoCapitalize="none"
            maxLength={60}
          />
        </View>

        <View className="mt-3">
          <InkButton variant="accent" size="sm" onPress={saveRunner} disabled={savingRunner}>
            {savingRunner ? <ActivityIndicator color="#fff" size="small" /> : 'Save runner info'}
          </InkButton>
        </View>
      </InkCard>

      {/* Notifications */}
      <InkCard className="mx-4 mt-3" pad={16}>
        <View className="flex-row items-center justify-between">
          <View style={{ flex: 1 }}>
            <Text className="text-ink font-semi text-sm">Job notifications</Text>
            <Text className="text-ink-muted text-xs mt-0.5">Get alerted when new jobs are available</Text>
          </View>
          <Switch
            value={notifEnabled}
            onValueChange={toggleNotifications}
            trackColor={{ false: P.hair, true: P.accentSoft }}
            thumbColor={notifEnabled ? P.accent : P.inkMuted}
          />
        </View>
      </InkCard>

      {/* Account info */}
      <InkCard className="mx-4 mt-3" pad={16}>
        <Text className="text-ink-muted text-[11px] font-semi tracking-wider uppercase mb-2">Account</Text>
        <Text className="text-ink-soft text-sm">+91 {user?.phone}</Text>
        <Text className="text-ink-soft text-xs mt-1 mb-4">
          Runner since {new Date(user?.created_at || Date.now()).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
        </Text>
        <Pressable
          onPress={confirmLogout}
          className="py-2.5 rounded-lg bg-paper-elev border border-hair items-center"
        >
          <Text className="text-rose font-semi text-sm">Sign out</Text>
        </Pressable>
      </InkCard>
    </ScrollView>
  );
}
