import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Alert, Pressable,
} from 'react-native';
import api from '../lib/api';
import { InkCard, InkButton, Tamil, IconArrowRight, IconClock } from '../components/ink';
import { palettes } from '../theme/tokens';

const P = palettes.light;

export default function LoginScreen({ onLogin }) {
  const [step, setStep]           = useState('phone');
  const [phone, setPhone]         = useState('');
  const [otp, setOtp]             = useState('');
  const [devHint, setDevHint]     = useState(false);
  const [loading, setLoading]     = useState(false);
  const [resendSec, setResendSec] = useState(30);
  const otpInputRef = useRef(null);

  async function sendOtp() {
    if (phone.length < 10) { Alert.alert('Invalid', 'Enter a valid 10-digit phone number'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/send-otp', { phone, role: 'runner' });
      if (data.dev_otp) { setOtp(String(data.dev_otp)); setDevHint(true); }
      setStep('otp'); setResendSec(30);
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.error || 'Could not send OTP');
    } finally { setLoading(false); }
  }

  async function verifyOtp() {
    if (otp.length !== 6) { Alert.alert('Invalid', 'Enter the 6-digit OTP'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/verify-otp', { phone, code: otp, role: 'runner' });
      onLogin({ user: data.user, token: data.token, refreshToken: data.refreshToken });
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.error || 'Invalid OTP');
    } finally { setLoading(false); }
  }

  useEffect(() => {
    if (step !== 'otp' || resendSec <= 0) return;
    const id = setInterval(() => setResendSec(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [step, resendSec]);

  if (step === 'phone') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-paper">
        <View className="flex-1 px-6 pt-24" style={{ gap: 24 }}>
          <View>
            <Text className="font-serif text-ink" style={{ fontSize: 52, lineHeight: 52 }}>
              Inkiro<Text className="text-accent">.</Text>
            </Text>
            <Text className="text-ink-muted text-[11px] font-semi tracking-widest uppercase mt-1">Runner</Text>
            <Text className="text-ink-soft mt-3 leading-5">Pick up · deliver · earn daily.</Text>
            <Tamil size={13}>வாடிக்கையாளருக்கு டெலிவரி செய்யவும்</Tamil>
          </View>

          <InkCard pad={20}>
            <Text className="text-ink-muted text-[11px] font-semi tracking-wider uppercase">Phone number</Text>
            <View className={`flex-row items-center mt-2 pb-2 border-b-2 ${phone.length === 10 ? 'border-accent' : phone.length > 0 ? 'border-rose' : 'border-ink'}`} style={{ gap: 10 }}>
              <Text className="text-ink text-xl font-semi">+91</Text>
              <TextInput
                value={phone}
                onChangeText={t => setPhone(t.replace(/[^0-9]/g, '').slice(0, 10))}
                placeholder="98765 43210"
                placeholderTextColor={P.inkMuted}
                maxLength={10}
                keyboardType="phone-pad"
                autoFocus
                className="flex-1 text-ink text-xl font-semi"
                style={{ letterSpacing: 1.5 }}
              />
              <Text className="text-ink-muted text-xs font-semi" style={{ minWidth: 28 }}>
                {phone.length}/10
              </Text>
            </View>
          </InkCard>

          <InkButton variant="accent" size="lg" full onPress={sendOtp} disabled={loading}>
            {loading
              ? <ActivityIndicator color="#fff" />
              : (<><Text className="text-paper-elev font-semi text-base">Send OTP</Text><IconArrowRight size={18}/></>)}
          </InkButton>
        </View>
      </KeyboardAvoidingView>
    );
  }

  const focusedIdx = otp.length;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-paper">
      <View className="flex-1 px-6 pt-24" style={{ gap: 20 }}>
        <View>
          <Text className="font-serif text-ink" style={{ fontSize: 34 }}>Enter code</Text>
          <View className="flex-row items-center mt-2" style={{ gap: 4 }}>
            <Text className="text-ink-soft text-sm">Sent to +91 {phone} ·</Text>
            <Pressable onPress={() => { setStep('phone'); setOtp(''); }}>
              <Text className="text-accent font-semi text-sm">change</Text>
            </Pressable>
          </View>
        </View>

        <Pressable onPress={() => otpInputRef.current?.focus()}>
          <View className="flex-row" style={{ gap: 10 }}>
            {Array.from({ length: 6 }).map((_, i) => {
              const d = otp[i] || '';
              const isFocus = i === focusedIdx;
              return (
                <View
                  key={i}
                  className={`flex-1 aspect-square items-center justify-center rounded-2xl border-[1.5px] ${
                    d ? 'bg-accent-soft border-accent'
                      : isFocus ? 'bg-paper-elev border-accent'
                      : 'bg-paper-elev border-hair-strong'
                  }`}
                  style={{ maxHeight: 58 }}
                >
                  <Text className={`font-mono text-2xl font-semi ${d ? 'text-accent-ink' : 'text-ink-muted'}`}>{d}</Text>
                </View>
              );
            })}
          </View>
        </Pressable>
        <TextInput
          ref={otpInputRef}
          value={otp}
          onChangeText={t => setOtp(t.replace(/[^0-9]/g, '').slice(0, 6))}
          keyboardType="number-pad"
          maxLength={6}
          autoFocus
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }}
        />

        <View className="flex-row items-center" style={{ gap: 8 }}>
          <IconClock size={14} />
          <Text className="text-ink-muted text-[13px]">
            {resendSec > 0 ? `Resend in 0:${String(resendSec).padStart(2, '0')}` : "Didn't get it?"}
          </Text>
          {resendSec === 0 && (
            <Pressable onPress={sendOtp}><Text className="text-accent font-semi text-[13px]">Resend</Text></Pressable>
          )}
        </View>

        <InkButton variant="accent" size="lg" full onPress={verifyOtp} disabled={loading || otp.length !== 6}>
          {loading ? <ActivityIndicator color="#fff" /> : 'Verify'}
        </InkButton>

        {devHint && (
          <View className="px-4 py-2.5 rounded-xl bg-sky-soft flex-row items-center" style={{ gap: 8 }}>
            <Text className="text-sky text-xs">⚡ Dev build · code auto-filled</Text>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
