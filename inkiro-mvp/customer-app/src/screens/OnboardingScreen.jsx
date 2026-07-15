import { useRef, useState } from 'react';
import { Dimensions, Pressable, ScrollView, Text, View } from 'react-native';
import { InkButton, MicFab, IconBag, IconBike, Tamil } from '../components/ink';
import { palettes } from '../theme/tokens';

const { width: SW } = Dimensions.get('window');
const P = palettes.light;

const SLIDES = [
  {
    icon:  'mic',
    title: 'Speak your list',
    body:  "Say what you need — tomatoes, onions, rice — we'll understand.",
    tamil: 'பட்டியலை சொல்லுங்கள்',
  },
  {
    icon:  'bag',
    title: 'Shop packs it',
    body:  'A nearby shop gets your order and packs it fresh, fast.',
    tamil: 'கடை பொருள்களை தயார் செய்யும்',
  },
  {
    icon:  'bike',
    title: 'Delivered to you',
    body:  'A local runner brings it straight to your door in minutes.',
    tamil: 'நிமிடங்களில் வீட்டிற்கு வரும்',
  },
];

export default function OnboardingScreen({ onDone }) {
  const scrollRef = useRef(null);
  const [slide, setSlide] = useState(0);
  const isLast = slide === SLIDES.length - 1;

  function next() {
    if (!isLast) {
      const n = slide + 1;
      scrollRef.current?.scrollTo({ x: SW * n, animated: true });
      setSlide(n);
    } else {
      onDone();
    }
  }

  return (
    <View className="flex-1 bg-paper">
      <Pressable
        onPress={onDone}
        hitSlop={12}
        style={{ position: 'absolute', top: 56, right: 24, zIndex: 10 }}
      >
        <Text className="text-ink-muted text-sm font-semi">Skip</Text>
      </Pressable>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onMomentumScrollEnd={e =>
          setSlide(Math.round(e.nativeEvent.contentOffset.x / SW))
        }
        style={{ flex: 1 }}
      >
        {SLIDES.map((s, i) => (
          <View
            key={i}
            style={{ width: SW, flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 28 }}
          >
            <SlideIcon icon={s.icon} />
            <View style={{ alignItems: 'center', gap: 10 }}>
              <Text className="font-serif text-ink text-center" style={{ fontSize: 32, lineHeight: 36 }}>
                {s.title}
              </Text>
              <Text className="text-ink-soft text-sm text-center leading-5" style={{ maxWidth: 280 }}>
                {s.body}
              </Text>
              <Tamil size={12}>{s.tamil}</Tamil>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={{ paddingHorizontal: 24, paddingBottom: 48, alignItems: 'center', gap: 20 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={{
                width:           i === slide ? 20 : 6,
                height:          6,
                borderRadius:    3,
                backgroundColor: i === slide ? P.accent : P.hair,
              }}
            />
          ))}
        </View>
        <InkButton variant="accent" full size="md" onPress={next}>
          {isLast ? 'Get started' : 'Next'}
        </InkButton>
      </View>
    </View>
  );
}

function SlideIcon({ icon }) {
  if (icon === 'mic') {
    return (
      <View pointerEvents="none">
        <MicFab state="idle" size={100} />
      </View>
    );
  }
  const bg   = icon === 'bag' ? P.accent : P.mint;
  const Icon = icon === 'bag' ? IconBag : IconBike;
  return (
    <View style={{ width: 100, height: 100, borderRadius: 28, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon size={44} color="#fff" />
    </View>
  );
}
