import { useFonts } from 'expo-font';
import {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif';
import { JetBrainsMono_500Medium }    from '@expo-google-fonts/jetbrains-mono';
import {
  NotoSansTamil_500Medium,
  NotoSansTamil_700Bold,
} from '@expo-google-fonts/noto-sans-tamil';

export function useAppFonts() {
  const [loaded] = useFonts({
    PlusJakartaSans_500Medium,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    InstrumentSerif_400Regular,
    JetBrainsMono_500Medium,
    NotoSansTamil_500Medium,
    NotoSansTamil_700Bold,
  });
  return loaded;
}
