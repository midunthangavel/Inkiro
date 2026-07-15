import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import * as Location from 'expo-location';
import api from '../lib/api';
import { InkCard, InkButton, Tamil, IconLocation } from '../components/ink';
import { palettes } from '../theme/tokens';

const P = palettes.light;

export default function RegisterShopScreen({ user, onRegistered }) {
  const [shopName, setShopName] = useState('');
  const [address, setAddress]   = useState('');
  const [category, setCategory] = useState('');
  const [coords, setCoords]     = useState(null);
  const [locating, setLocating] = useState(false);
  const [loading, setLoading]   = useState(false);

  useEffect(() => { getLocation(); }, []);

  async function getLocation() {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission denied', 'Location is needed to register your shop'); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    } catch {
      Alert.alert('Error', 'Could not get location');
    } finally { setLocating(false); }
  }

  async function register() {
    if (!shopName.trim()) { Alert.alert('Required', 'Enter your shop name'); return; }
    if (!coords)          { Alert.alert('Required', 'Location not set — tap Retry'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/shops/register', {
        user_id: user.id,
        shop_name: shopName.trim(),
        address: address.trim(),
        category: category.trim() || 'General',
        lat: coords.lat, lng: coords.lng,
      });
      onRegistered(data.shop);
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.error || 'Registration failed');
    } finally { setLoading(false); }
  }

  return (
    <ScrollView className="flex-1 bg-paper" keyboardShouldPersistTaps="handled">
      <View className="px-6 pt-20">
        <Text className="font-serif text-ink" style={{ fontSize: 34, lineHeight: 38 }}>
          Register{'\n'}your shop.
        </Text>
        <Tamil size={14}>உங்கள் கடையை பதிவு செய்யுங்கள்</Tamil>
        <Text className="text-ink-soft mt-2">One-time setup.</Text>
      </View>

      <View className="px-4 mt-6" style={{ gap: 12 }}>
        <Field label="Shop name *">
          <TextInput
            value={shopName}
            onChangeText={setShopName}
            placeholder="e.g. Sri Murugan Provision"
            placeholderTextColor={P.inkMuted}
            className="text-ink text-lg font-semi mt-1"
          />
        </Field>

        <Field label="Address">
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="Street, area, city"
            placeholderTextColor={P.inkMuted}
            multiline
            className="text-ink text-sm mt-1"
            style={{ minHeight: 32 }}
          />
        </Field>

        <Field label="Category">
          <TextInput
            value={category}
            onChangeText={setCategory}
            placeholder="Grocery / Pharmacy / Bakery"
            placeholderTextColor={P.inkMuted}
            className="text-ink text-sm mt-1"
          />
        </Field>

        <InkCard pad={14}>
          <View className="flex-row items-center" style={{ gap: 10 }}>
            <View className="w-10 h-10 rounded-full bg-accent-soft items-center justify-center">
              <IconLocation size={18} color={P.accentInk} />
            </View>
            <View className="flex-1">
              <Text className="text-ink-muted text-[11px] font-semi tracking-wider uppercase">Shop location</Text>
              {locating ? (
                <View className="flex-row items-center mt-0.5" style={{ gap: 6 }}>
                  <ActivityIndicator color={P.accent} size="small" />
                  <Text className="text-ink-soft text-sm">Getting GPS…</Text>
                </View>
              ) : coords ? (
                <Text className="text-ink font-mono text-sm mt-0.5">{coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</Text>
              ) : (
                <Text className="text-ink-muted text-sm mt-0.5">Tap Retry</Text>
              )}
            </View>
            <InkButton variant="ghost" size="sm" onPress={getLocation}>Retry</InkButton>
          </View>
        </InkCard>

        <InkButton variant="accent" size="lg" full onPress={register} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : 'Register shop'}
        </InkButton>
      </View>
      <View className="h-10" />
    </ScrollView>
  );
}

function Field({ label, children }) {
  return (
    <InkCard pad={14}>
      <Text className="text-ink-muted text-[11px] font-semi tracking-wider uppercase">{label}</Text>
      {children}
    </InkCard>
  );
}
