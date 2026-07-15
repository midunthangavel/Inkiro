import { useState } from 'react';
import {
  View, Text, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import * as Location from 'expo-location';
import api from '../lib/api';
import { InkCard, InkButton, Tamil, IconLocation } from '../components/ink';
import { palettes } from '../theme/tokens';

const P = palettes.light;

export default function OnboardingNameScreen({ user, onComplete }) {
  const [name, setName]       = useState('');
  const [loading, setLoading] = useState(false);

  async function save(askLocation) {
    const trimmed = name.trim();
    if (!trimmed) { Alert.alert('Required', 'Please enter your name to continue'); return; }
    setLoading(true);
    try {
      if (askLocation) {
        try { await Location.requestForegroundPermissionsAsync(); } catch {}
      }
      const { data } = await api.put(`/users/${user.id}`, { name: trimmed });
      onComplete(data.user);
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.error || 'Could not save your name');
    } finally { setLoading(false); }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-paper">
      <View className="flex-1 px-6 pt-20" style={{ gap: 20 }}>
        <View>
          <Text className="font-serif text-ink" style={{ fontSize: 34, lineHeight: 38 }}>
            What should{'\n'}we call you?
          </Text>
          <Tamil size={14}>உங்கள் பெயர்?</Tamil>
        </View>

        <InkCard pad={18}>
          <Text className="text-ink-muted text-[11px] font-semi tracking-wider uppercase">Your name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Kavitha R."
            placeholderTextColor={P.inkMuted}
            maxLength={100}
            autoFocus
            className="text-ink text-xl font-semi mt-1"
          />
        </InkCard>

        <View className="mt-2 p-4 rounded-[20px] bg-accent-soft border-[1.5px] border-dashed border-accent flex-row items-center" style={{ gap: 12 }}>
          <View className="w-10 h-10 rounded-full bg-accent items-center justify-center">
            <IconLocation size={20} color="#fff" />
          </View>
          <View className="flex-1">
            <Text className="font-semi text-[15px] text-accent-ink">Allow location?</Text>
            <Text className="text-[12px] text-accent-ink opacity-75 mt-0.5">We need it to find shops near you.</Text>
            <Tamil size={11} color={P.accentInk}>இருப்பிடம் அனுமதிக்கவா?</Tamil>
          </View>
        </View>

        <View className="flex-row mt-1" style={{ gap: 10 }}>
          <InkButton variant="ghost" full onPress={() => save(false)} disabled={loading}>Later</InkButton>
          <InkButton variant="accent" full onPress={() => save(true)} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : 'Allow'}
          </InkButton>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
