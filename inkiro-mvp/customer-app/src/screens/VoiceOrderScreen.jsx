import { useRef, useState, useEffect } from 'react';
import {
  View, Text, ScrollView, ActivityIndicator, Alert, TextInput, Pressable,
} from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import api from '../lib/api';
import LocationPicker from '../components/LocationPicker';
import AddressBookModal from '../components/AddressBookModal';
import {
  InkCard, InkButton, Tamil, MicFab, InkWaveform, IconArrowRight,
} from '../components/ink';
import { palettes, rupees } from '../theme/tokens';
import { useLanguage } from '../hooks/useLanguage';

const P = palettes.light;
const STEPS = { idle: 'idle', recording: 'recording', parsing: 'parsing', review: 'review', placing: 'placing' };

export default function VoiceOrderScreen({ user, onOrderPlaced, initialCart, onReset }) {
  const [step, setStep]                     = useState(initialCart ? STEPS.review : STEPS.idle);
  const [parsedOrder, setParsedOrder]       = useState(initialCart || null);
  const [address, setAddress]               = useState('');
  const [selectedCoords, setSelectedCoords] = useState({ lat: null, lng: null });
  const [recordSecs, setRecordSecs]         = useState(0);
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [addrBookOpen, setAddrBookOpen]     = useState(false);
  const recordingRef = useRef(null);
  const timerRef     = useRef(null);
  const { lang }     = useLanguage();

  useEffect(() => {
    api.get('/addresses').then(({ data }) => setSavedAddresses(data.addresses || [])).catch(() => {});
  }, []);

  async function startRecording() {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) { Alert.alert('Permission denied', 'Microphone access is required'); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      setStep(STEPS.recording);
      setRecordSecs(0);
      timerRef.current = setInterval(() => setRecordSecs(s => s + 1), 1000);
    } catch {
      Alert.alert('Error', 'Could not start recording');
    }
  }

  async function stopAndParse() {
    clearInterval(timerRef.current);
    setStep(STEPS.parsing);
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri    = recordingRef.current.getURI();
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      const sttLang = lang === 'ta' ? 'ta-IN' : 'en-IN';
      const { data } = await api.post('/orders/parse-voice', {
        audio_base64: base64, language: sttLang,
      }, { timeout: 60000 });
      setParsedOrder(data);
      setStep(STEPS.review);
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.error || err?.message || 'Could not parse voice order');
      setStep(STEPS.idle);
    }
  }

  async function confirmOrder() {
    if (!address.trim())                              { Alert.alert('Required', 'Enter your delivery address'); return; }
    if (!parsedOrder?.items?.length)                  { Alert.alert('No items', 'No items were detected. Please re-record.'); return; }
    if (!selectedCoords.lat || !selectedCoords.lng)   { Alert.alert('Pin required', 'Drop the pin on your exact delivery location'); return; }

    setStep(STEPS.placing);
    const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const { data } = await api.post('/orders/confirm', {
        customer_phone: user.phone,
        items: parsedOrder.items,
        address: address.trim(),
        lat: selectedCoords.lat,
        lng: selectedCoords.lng,
      }, { headers: { 'X-Idempotency-Key': idempotencyKey } });
      const { data: orderData } = await api.get(`/orders/${data.order_id}`);
      onReset?.();
      onOrderPlaced(orderData.order || { id: data.order_id, status: 'pending', items: parsedOrder.items });
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.error || 'Could not place order');
      setStep(STEPS.review);
    }
  }

  function reset() {
    setParsedOrder(null); setAddress(''); setSelectedCoords({ lat: null, lng: null }); setStep(STEPS.idle);
    onReset?.();
  }

  // ─── IDLE — Hero mic ────────────────────────────────────────────────────
  if (step === STEPS.idle) {
    const first = user.name?.split(' ')[0] || 'there';
    return (
      <View className="flex-1 bg-paper">
        <View style={{ position: 'absolute', top: 60, left: 20 }}>
          <Text className="font-serif text-ink" style={{ fontSize: 22 }}>
            Inkiro<Text className="text-accent">.</Text>
          </Text>
          <Tamil size={11}>வணக்கம் {first}</Tamil>
        </View>

        <View className="flex-1 px-6 items-center justify-center" style={{ gap: 24 }}>
          <View style={{ alignItems: 'center' }}>
            <Text className="font-serif text-ink text-center" style={{ fontSize: 40, lineHeight: 44 }}>
              Tap and speak{'\n'}your list.
            </Text>
            <Tamil size={16}>பட்டியலை சொல்லுங்கள்</Tamil>
          </View>

          <View style={{ marginVertical: 12 }}>
            <MicFab state="idle" size={140} onPress={startRecording} />
          </View>

          <Text className="text-ink-muted text-center text-[13px] px-4" style={{ maxWidth: 280 }}>
            "Half kilo tomato, one kilo onion…" — we'll understand.
          </Text>
        </View>
      </View>
    );
  }

  // ─── RECORDING ──────────────────────────────────────────────────────────
  if (step === STEPS.recording) {
    return (
      <Pressable onPress={stopAndParse} className="flex-1" style={{ backgroundColor: P.accent }}>
        <View className="flex-1 items-center justify-center px-8" style={{ gap: 26 }}>
          <Text className="text-white font-semi tracking-widest uppercase" style={{ fontSize: 11, opacity: 0.85 }}>
            ● Listening
          </Text>
          <Text className="font-serif text-white text-center" style={{ fontSize: 36 }}>
            Listening<Text style={{ letterSpacing: 4 }}>…</Text>
          </Text>
          <Text className="text-white/70 font-mono" style={{ fontSize: 13 }}>
            {`0:${String(recordSecs).padStart(2, '0')}`}
          </Text>
          <MicFab state="recording" size={120} color="#fff" onPress={stopAndParse} />
          <InkWaveform active bars={22} height={48} color="rgba(255,255,255,0.85)" />
          <Text className="text-white text-[13px]" style={{ opacity: 0.75 }}>Tap anywhere to stop</Text>
        </View>
      </Pressable>
    );
  }

  // ─── PARSING / PLACING ──────────────────────────────────────────────────
  if (step === STEPS.parsing || step === STEPS.placing) {
    return (
      <View className="flex-1 bg-paper items-center justify-center" style={{ gap: 16 }}>
        <ActivityIndicator size="large" color={P.accent} />
        <Text className="text-ink-soft">
          {step === STEPS.parsing ? 'Understanding your order…' : 'Placing your order…'}
        </Text>
        <Tamil size={12}>{step === STEPS.parsing ? 'புரிந்துகொள்கிறோம்…' : 'ஆர்டர் அனுப்புகிறோம்…'}</Tamil>
      </View>
    );
  }

  // ─── REVIEW — Chat style ────────────────────────────────────────────────
  const greetName = user.name?.split(' ')[0] || 'there';
  return (
    <ScrollView className="flex-1 bg-paper" contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View className="px-5 pt-16 pb-3 flex-row items-center justify-between">
        <View>
          <Text className="font-serif text-ink" style={{ fontSize: 26 }}>
            Inkiro<Text className="text-accent">.</Text>
          </Text>
          <Tamil size={11}>பேசு · அனுப்பு · முடிந்தது</Tamil>
        </View>
      </View>

      <View className="px-4" style={{ gap: 10 }}>
        {/* Bot greeting */}
        <View className="self-start" style={{ maxWidth: '85%' }}>
          <View className="bg-paper-elev border border-hair rounded-[20px] rounded-bl-[4px] px-4 py-3">
            <Text className="text-ink text-sm leading-5">
              {initialCart ? `Reordering for you, ${greetName}.` : `Hi ${greetName} — here's what I heard.`}
            </Text>
          </View>
        </View>

        {/* Voice bubble */}
        {parsedOrder?.raw_text ? (
          <View className="self-end" style={{ maxWidth: '85%' }}>
            <View className="bg-accent rounded-[20px] rounded-br-[4px] px-4 py-3">
              <Text className="text-white text-sm leading-5 italic">"{parsedOrder.raw_text}"</Text>
            </View>
            <Text className="text-ink-muted text-[10px] text-right mt-1">heard clearly</Text>
          </View>
        ) : null}

        {/* Parsed items */}
        <View className="self-stretch">
          <InkCard pad={0} style={{ overflow: 'hidden' }}>
            <View className="px-4 py-3 bg-accent-soft flex-row items-center" style={{ gap: 8 }}>
              <View>
                <Text className="text-accent-ink text-[11px] font-semi tracking-wider uppercase">I heard</Text>
                <Tamil size={9}>பொருட்கள்</Tamil>
              </View>
              <Text className="text-accent-ink text-[11px] ml-auto" style={{ opacity: 0.7 }}>
                {parsedOrder?.items?.length || 0} items
              </Text>
            </View>
            {(parsedOrder?.items || []).map((it, i) => (
              <View
                key={i}
                className="flex-row items-center px-4 py-2.5"
                style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: P.hair }}
              >
                <View className="flex-1">
                  <Text className="text-ink text-[14px] font-semi">{it.name}</Text>
                </View>
                <Text className="text-ink-muted text-xs mr-3">{it.quantity} {it.unit}</Text>
                <Text className="text-ink font-semi font-mono text-[14px]">
                  ₹{it.estimated_price_rupees * it.quantity}
                </Text>
              </View>
            ))}
            <View className="px-4 py-3 bg-paper-sunk border-t border-hair" style={{ gap: 3 }}>
              <Row label="Subtotal"     value={rupees(parsedOrder?.subtotal ?? 0)} />
              <Row label="Platform fee" value={rupees(parsedOrder?.platform_fee ?? 0)} />
              <Row label="Delivery"     value={rupees(parsedOrder?.delivery_fee ?? 0)} />
              <View className="flex-row justify-between mt-1">
                <View>
                  <Text className="text-ink font-semi text-base">Total</Text>
                  <Tamil size={9}>மொத்தம்</Tamil>
                </View>
                <Text className="text-ink font-semi font-mono text-base">{rupees(parsedOrder?.total ?? 0)}</Text>
              </View>
            </View>
          </InkCard>
        </View>

        {/* Address */}
        <InkCard pad={14} className="mt-2">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-ink-muted text-[11px] font-semi tracking-wider uppercase">Deliver to</Text>
              <Tamil size={9}>டெலிவரி முகவரி</Tamil>
            </View>
            {savedAddresses.length > 0 && (
              <Pressable onPress={() => setAddrBookOpen(true)} hitSlop={8}>
                <Text className="text-accent text-xs font-semi">📍 Saved</Text>
              </Pressable>
            )}
          </View>
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="Move the pin to auto-fill"
            placeholderTextColor={P.inkMuted}
            multiline
            className="text-ink text-sm mt-2 pb-2 border-b border-hair"
            style={{ minHeight: 32 }}
          />
          <View className="mt-3">
            <LocationPicker
              height={180}
              onLocationSelect={({ lat, lng, address: addr }) => {
                setSelectedCoords({ lat, lng });
                if (addr) setAddress(addr);
              }}
            />
          </View>
          {selectedCoords.lat ? (
            <Text className="text-ink-muted text-[11px] text-center mt-2 font-mono">
              📍 {selectedCoords.lat.toFixed(5)}, {selectedCoords.lng.toFixed(5)}
            </Text>
          ) : null}
        </InkCard>
      </View>

      <View className="mx-4 mt-4 flex-row" style={{ gap: 10 }}>
        <InkButton variant="ghost" onPress={reset} size="md">Try again</InkButton>
        <InkButton variant="accent" full size="md" onPress={confirmOrder}>
          <Text className="text-paper-elev font-semi">Confirm &amp; send</Text>
          <IconArrowRight size={16} />
        </InkButton>
      </View>

      <AddressBookModal
        visible={addrBookOpen}
        onClose={() => setAddrBookOpen(false)}
        onSelect={({ address: a, lat, lng }) => {
          setAddress(a || '');
          if (lat && lng) setSelectedCoords({ lat, lng });
        }}
        currentAddress={address}
        currentLat={selectedCoords.lat}
        currentLng={selectedCoords.lng}
        addresses={savedAddresses}
        onAddressesChange={setSavedAddresses}
      />
    </ScrollView>
  );
}

function Row({ label, value }) {
  return (
    <View className="flex-row justify-between">
      <Text className="text-ink-soft text-xs">{label}</Text>
      <Text className="text-ink-soft font-mono text-xs">{value}</Text>
    </View>
  );
}
