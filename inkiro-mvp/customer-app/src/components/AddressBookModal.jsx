import { useState } from 'react';
import {
  Modal, View, Text, Pressable, ScrollView, TextInput,
  ActivityIndicator, Alert,
} from 'react-native';
import api from '../lib/api';
import { palettes } from '../theme/tokens';

const P = palettes.light;

/**
 * Props:
 *   visible         boolean
 *   onClose         () => void
 *   onSelect        ({ address, lat, lng }) => void
 *   currentAddress  string | null   — shown as "save this" suggestion
 *   currentLat      number | null
 *   currentLng      number | null
 *   addresses       array           — pre-fetched list (passed down to avoid refetch)
 *   onAddressesChange (newList) => void
 */
export default function AddressBookModal({
  visible, onClose, onSelect,
  currentAddress, currentLat, currentLng,
  addresses = [], onAddressesChange,
}) {
  const [saveLabel, setSaveLabel] = useState('');
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState(null);

  async function saveCurrentAddress() {
    if (!currentAddress?.trim()) return;
    setSaving(true);
    try {
      const { data } = await api.post('/addresses', {
        label:   saveLabel.trim() || 'Address',
        address: currentAddress.trim(),
        lat:     currentLat  || null,
        lng:     currentLng  || null,
      });
      onAddressesChange([data.address, ...addresses]);
      setSaveLabel('');
      Alert.alert('Saved', 'Address saved to your book.');
    } catch {
      Alert.alert('Error', 'Could not save address.');
    } finally { setSaving(false); }
  }

  async function deleteAddress(id) {
    setDeleting(id);
    try {
      await api.delete(`/addresses/${id}`);
      onAddressesChange(addresses.filter(a => a.id !== id));
    } catch {
      Alert.alert('Error', 'Could not delete address.');
    } finally { setDeleting(null); }
  }

  function pickAddress(addr) {
    onSelect({ address: addr.address, lat: addr.lat, lng: addr.lng });
    onClose();
  }

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: P.bg }}>
        {/* Header */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20,
          paddingTop: 24, paddingBottom: 16,
          borderBottomWidth: 1, borderBottomColor: P.hair,
        }}>
          <Text style={{ flex: 1, fontSize: 20, fontWeight: '700', color: P.ink }}>Saved addresses</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={{ fontSize: 16, color: P.inkMuted }}>✕</Text>
          </Pressable>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10 }}>
          {/* Save current address */}
          {!!currentAddress && (
            <View style={{
              backgroundColor: P.bgElev, borderRadius: 12, padding: 14,
              borderWidth: 1, borderColor: P.hair, gap: 10,
            }}>
              <Text style={{ color: P.inkMuted, fontSize: 11, fontWeight: '600', letterSpacing: 1 }}>
                SAVE CURRENT ADDRESS
              </Text>
              <Text style={{ color: P.ink, fontSize: 13 }} numberOfLines={2}>{currentAddress}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  value={saveLabel}
                  onChangeText={setSaveLabel}
                  placeholder="Label (e.g. Home, Office…)"
                  placeholderTextColor={P.inkMuted}
                  style={{
                    flex: 1, backgroundColor: P.bg, borderRadius: 8, paddingHorizontal: 12,
                    paddingVertical: 8, fontSize: 14, color: P.ink,
                    borderWidth: 1, borderColor: P.hairStrong,
                  }}
                  maxLength={30}
                  returnKeyType="done"
                />
                <Pressable
                  onPress={saveCurrentAddress}
                  disabled={saving}
                  style={{
                    backgroundColor: P.accent, borderRadius: 8, paddingHorizontal: 16,
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>Save</Text>}
                </Pressable>
              </View>
            </View>
          )}

          {/* Saved list */}
          {addresses.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 32 }}>
              <Text style={{ color: P.inkMuted, fontSize: 14 }}>No saved addresses yet.</Text>
            </View>
          ) : (
            addresses.map(addr => (
              <Pressable
                key={addr.id}
                onPress={() => pickAddress(addr)}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  backgroundColor: P.bgElev, borderRadius: 12, padding: 14,
                  borderWidth: 1, borderColor: P.hair, gap: 10,
                }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: P.ink, fontWeight: '600', fontSize: 14 }}>{addr.label}</Text>
                  <Text style={{ color: P.inkSoft, fontSize: 13 }} numberOfLines={2}>{addr.address}</Text>
                </View>
                <Pressable
                  onPress={() => deleteAddress(addr.id)}
                  disabled={deleting === addr.id}
                  hitSlop={10}
                >
                  {deleting === addr.id
                    ? <ActivityIndicator size="small" color={P.inkMuted} />
                    : <Text style={{ color: P.rose, fontSize: 18, fontWeight: '300' }}>×</Text>}
                </Pressable>
              </Pressable>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
