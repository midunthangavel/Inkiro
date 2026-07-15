// src/components/ink.jsx — Inkiro shared primitives (RN + NativeWind)
import { useEffect, useRef } from 'react';
import { View, Text, Pressable, Animated, Easing } from 'react-native';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { palettes } from '../theme/tokens';
import { useLanguage } from '../hooks/useLanguage';

const P = palettes.light;

export function InkCard({ children, className = '', style, pad = 16, tone = 'elev', ...rest }) {
  const bg = { elev: 'bg-paper-elev', sunk: 'bg-paper-sunk', plain: 'bg-paper' }[tone] || 'bg-paper-elev';
  return (
    <View className={`rounded-ink border border-hair ${bg} ${className}`} style={[{ padding: pad }, style]} {...rest}>
      {children}
    </View>
  );
}

export function InkButton({ children, onPress, variant = 'accent', size = 'md', full = false, disabled = false, className = '', accessibilityLabel }) {
  const V = {
    accent: ['bg-accent',                                   'text-paper-elev'],
    ghost:  ['bg-paper-elev border border-hair-strong',     'text-ink'],
    mint:   ['bg-mint',                                     'text-paper-elev'],
    rose:   ['bg-rose',                                     'text-paper-elev'],
    dark:   ['bg-ink',                                      'text-paper'],
  }[variant] || ['bg-accent', 'text-paper-elev'];
  const S = { sm: 'px-3 py-2', md: 'px-4 py-3', lg: 'px-5 py-4' }[size];
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      className={`${V[0]} ${S} rounded-full ${full ? 'flex-1' : 'self-start'} ${disabled ? 'opacity-40' : ''} ${className}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <View className="flex-row items-center justify-center gap-2">
        {typeof children === 'string'
          ? <Text className={`font-semi ${size === 'lg' ? 'text-base' : 'text-sm'} ${V[1]}`}>{children}</Text>
          : children}
      </View>
    </Pressable>
  );
}

export function InkPill({ children, color = 'ink', className = '' }) {
  const P2 = {
    ink:    ['bg-ink',         'text-paper'],
    accent: ['bg-accent-soft', 'text-accent-ink'],
    mint:   ['bg-mint-soft',   'text-mint'],
    rose:   ['bg-rose-soft',   'text-rose'],
    amber:  ['bg-amber-soft',  'text-amber'],
    sky:    ['bg-sky-soft',    'text-sky'],
  }[color] || ['bg-ink', 'text-paper'];
  return (
    <View className={`self-start px-2.5 py-1 rounded-full ${P2[0]} ${className}`}>
      <Text className={`text-[11px] font-semi tracking-wider uppercase ${P2[1]}`}>{children}</Text>
    </View>
  );
}

export function Tamil({ children, size = 13, color, className = '', style }) {
  const { lang } = useLanguage();
  if (lang === 'en') return null;
  return (
    <Text className={`font-tamil ${className}`} style={[{ fontSize: size, color: color || P.inkSoft, marginTop: 2 }, style]}>
      {children}
    </Text>
  );
}

export function LanguageToggle() {
  const { lang, setLang } = useLanguage();
  const cycle = () => setLang(lang === 'en' ? 'ta' : lang === 'ta' ? 'both' : 'en');
  const label = lang === 'en' ? 'EN' : lang === 'ta' ? 'த' : 'EN/த';
  return (
    <Pressable onPress={cycle} className="bg-paper-elev rounded-full px-3 py-1 border border-hair">
      <Text className="font-semi text-xs text-ink">{label}</Text>
    </Pressable>
  );
}

export function InkWaveform({ active = true, bars = 16, height = 36, color }) {
  const anims = useRef(Array.from({ length: bars }, () => new Animated.Value(0.2))).current;
  useEffect(() => {
    if (!active) return;
    const loops = anims.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1,   duration: 400 + (i % 4) * 80, useNativeDriver: false, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(v, { toValue: 0.2, duration: 380,                useNativeDriver: false, easing: Easing.inOut(Easing.ease) }),
        ]),
      ),
    );
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [active]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', height, gap: 3 }}>
      {anims.map((v, i) => (
        <Animated.View key={i} style={{
          width: 3,
          height: v.interpolate({ inputRange: [0, 1], outputRange: [4, height] }),
          backgroundColor: color || P.accent, borderRadius: 2,
        }} />
      ))}
    </View>
  );
}

export function MicFab({ state = 'idle', size = 120, onPress, color }) {
  const rec = state === 'recording';
  const ring = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!rec) return;
    const loop = Animated.loop(Animated.timing(ring, { toValue: 1, duration: 1800, useNativeDriver: true, easing: Easing.out(Easing.ease) }));
    loop.start();
    return () => loop.stop();
  }, [rec]);
  const c = color || P.accent;
  return (
    <Pressable onPress={onPress}>
      <View style={{ width: size * 1.8, height: size * 1.8, alignItems: 'center', justifyContent: 'center' }}>
        {rec && (
          <Animated.View style={{
            position: 'absolute', width: size * 1.6, height: size * 1.6,
            borderRadius: size, borderWidth: 2, borderColor: c,
            opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
            transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.1] }) }],
          }} />
        )}
        <View style={{
          width: size, height: size, borderRadius: size / 2,
          backgroundColor: rec ? '#FFF' : c,
          alignItems: 'center', justifyContent: 'center',
          shadowColor: c, shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.35, shadowRadius: 20, elevation: 6,
        }}>
          <IconMic size={size * 0.42} color={rec ? c : '#FFF'} />
        </View>
      </View>
    </Pressable>
  );
}

export const IconMic = ({ size = 20, color = '#fff' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x="9" y="3" width="6" height="12" rx="3" stroke={color} strokeWidth={2} />
    <Path d="M5 11a7 7 0 0 0 14 0" stroke={color} strokeWidth={2} strokeLinecap="round" />
    <Path d="M12 18v3" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </Svg>
);
export const IconCheck = ({ size = 16, color = '#fff', w = 2.5 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M20 6L9 17l-5-5" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
export const IconArrowRight = ({ size = 18, color = '#fff' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M5 12h14M13 5l7 7-7 7" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
export const IconBike = ({ size = 18, color = P.ink }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="5" cy="17" r="3" stroke={color} strokeWidth={2} />
    <Circle cx="19" cy="17" r="3" stroke={color} strokeWidth={2} />
    <Path d="M5 17L12 6l3 5h4" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
export const IconPhone = ({ size = 16, color = '#fff' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M5 4h4l2 5-3 2a12 12 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
export const IconStar = ({ size = 14, color = P.amber, filled = true }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : 'none'}>
    <Path d="M12 2l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
  </Svg>
);
export const IconHome = ({ size = 14, color = P.ink }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M3 10l9-7 9 7v10a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2z" stroke={color} strokeWidth={2} strokeLinejoin="round" />
  </Svg>
);
export const IconPlus = ({ size = 14, color = '#fff' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M12 5v14M5 12h14" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
  </Svg>
);
export const IconMinus = ({ size = 14, color = P.ink }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M5 12h14" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
  </Svg>
);
export const IconClock = ({ size = 14, color = P.inkMuted }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={2} />
    <Path d="M12 7v5l3 2" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </Svg>
);
export const IconBell = ({ size = 18, color = P.inkMuted }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M18 16V11a6 6 0 0 0-12 0v5l-2 2h16z" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    <Path d="M10 20a2 2 0 0 0 4 0" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </Svg>
);
export const IconBag = ({ size = 18, color = '#fff' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M4 7h16l-1 13H5L4 7z" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    <Path d="M9 7V5a3 3 0 0 1 6 0v2" stroke={color} strokeWidth={2} />
  </Svg>
);
export const IconUser = ({ size = 18, color = P.ink }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="8" r="4" stroke={color} strokeWidth={2} />
    <Path d="M4 20c1.5-4 5-6 8-6s6.5 2 8 6" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </Svg>
);
export const IconLocation = ({ size = 20, color = '#fff' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M12 22s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12z" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    <Circle cx="12" cy="10" r="2.5" stroke={color} strokeWidth={2} />
  </Svg>
);
export const IconChat = ({ size = 14, color = P.ink }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M3 5h18v12H8l-5 4V5z" stroke={color} strokeWidth={2} strokeLinejoin="round" />
  </Svg>
);
export const IconChevRight = ({ size = 18, color = P.inkMuted }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M9 6l6 6-6 6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

// ─── Skeleton ────────────────────────────────────────────────────────────────
export function SkeletonBlock({ width = '100%', height = 14, rounded = 6, style }) {
  const anim = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 0.9,  duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View
      style={[{ width, height, borderRadius: rounded, backgroundColor: P.bgElev, opacity: anim }, style]}
    />
  );
}
