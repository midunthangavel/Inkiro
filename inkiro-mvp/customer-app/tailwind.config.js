/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.{js,jsx}', './src/**/*.{js,jsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        paper:         '#F5EFE4',
        'paper-elev':  '#FFFBF2',
        'paper-sunk':  '#ECE3D2',
        ink:           '#2A1810',
        'ink-soft':    '#5C4A3E',
        'ink-muted':   '#8C7A6C',
        hair:          'rgba(42,24,16,0.10)',
        'hair-strong': 'rgba(42,24,16,0.18)',
        accent:        '#C2410C',
        'accent-soft': '#FED7AA',
        'accent-ink':  '#7C2D12',
        mint:          '#047857',
        'mint-soft':   '#D1FAE5',
        rose:          '#BE185D',
        'rose-soft':   '#FCE7F3',
        amber:         '#B45309',
        'amber-soft':  '#FEF3C7',
        sky:           '#0369A1',
        'sky-soft':    '#E0F2FE',

        // Legacy aliases — keep so existing Login/VoiceOrder/History keep rendering
        primary: '#C2410C',
        danger:  '#BE185D',
        warning: '#B45309',
        muted:   '#8C7A6C',
        surface: '#F5EFE4',
        border:  'rgba(42,24,16,0.10)',
      },
      fontFamily: {
        sans:   ['PlusJakartaSans_500Medium'],
        semi:   ['PlusJakartaSans_700Bold'],
        bold:   ['PlusJakartaSans_800ExtraBold'],
        serif:  ['InstrumentSerif_400Regular'],
        mono:   ['JetBrainsMono_500Medium'],
        tamil:  ['NotoSansTamil_500Medium'],
        tamilB: ['NotoSansTamil_700Bold'],
      },
      borderRadius: { ink: '18px', inkLg: '24px' },
    },
  },
  plugins: [],
};
