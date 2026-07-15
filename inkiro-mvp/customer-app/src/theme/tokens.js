// src/theme/tokens.js — Inkiro design tokens (warm paper, Tamil-ready)
// Duplicated across apps; keep in sync when you tweak the palette.

export const palettes = {
  light: {
    bg:         '#F5EFE4',
    bgElev:     '#FFFBF2',
    bgSunken:   '#ECE3D2',
    ink:        '#2A1810',
    inkSoft:    '#5C4A3E',
    inkMuted:   '#8C7A6C',
    hair:       'rgba(42,24,16,0.10)',
    hairStrong: 'rgba(42,24,16,0.18)',
    accent:     '#C2410C',
    accentSoft: '#FED7AA',
    accentInk:  '#7C2D12',
    mint:       '#047857',
    mintSoft:   '#D1FAE5',
    rose:       '#BE185D',
    roseSoft:   '#FCE7F3',
    amber:      '#B45309',
    amberSoft:  '#FEF3C7',
    sky:        '#0369A1',
    skySoft:    '#E0F2FE',
  },
  dark: {
    bg:         '#1A1410',
    bgElev:     '#241C17',
    bgSunken:   '#120E0A',
    ink:        '#F5EFE4',
    inkSoft:    '#D4C5B2',
    inkMuted:   '#8C7A6C',
    hair:       'rgba(245,239,228,0.08)',
    hairStrong: 'rgba(245,239,228,0.16)',
    accent:     '#FB923C',
    accentSoft: '#4A1F08',
    accentInk:  '#FED7AA',
    mint:       '#34D399',
    mintSoft:   '#064E3B',
    rose:       '#F472B6',
    roseSoft:   '#500724',
    amber:      '#FBBF24',
    amberSoft:  '#451A03',
    sky:        '#38BDF8',
    skySoft:    '#082F49',
  },
};

export const rnFonts = {
  sans:   'PlusJakartaSans_500Medium',
  semi:   'PlusJakartaSans_700Bold',
  bold:   'PlusJakartaSans_800ExtraBold',
  serif:  'InstrumentSerif_400Regular',
  mono:   'JetBrainsMono_500Medium',
  tamil:  'NotoSansTamil_500Medium',
  tamilB: 'NotoSansTamil_700Bold',
};

export const webFonts = {
  sans:  "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif",
  serif: "'Instrument Serif', ui-serif, Georgia, serif",
  mono:  "'JetBrains Mono', ui-monospace, monospace",
  tamil: "'Noto Sans Tamil', 'Plus Jakarta Sans', sans-serif",
};

export function getTokens(mode = 'light') {
  return { ...palettes[mode], fonts: rnFonts, mode };
}

export function rupees(paise) {
  return `₹${Math.round((paise || 0) / 100).toLocaleString('en-IN')}`;
}

// ── Back-compat: keep the old `tokens` shape for screens already using it ────
export const tokens = {
  ...palettes.light,
  fonts: {
    // old keys preserved so existing screens keep resolving
    sans:     rnFonts.sans,
    sansMed:  rnFonts.sans,
    sansBold: rnFonts.semi,
    sansX:    rnFonts.bold,
    serif:    rnFonts.serif,
    mono:     rnFonts.mono,
    monoBold: rnFonts.mono,
    tamil:    rnFonts.tamil,
    tamilB:   rnFonts.tamilB,
  },
  radius: { card: 22, input: 16, button: 9999, pill: 9999 },
  shadow: {
    card: {
      shadowColor: '#2A1810',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.08,
      shadowRadius: 24,
      elevation: 3,
    },
    btn3D: {
      shadowColor: '#7C2D12',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 1,
      shadowRadius: 0,
      elevation: 6,
    },
  },
};
