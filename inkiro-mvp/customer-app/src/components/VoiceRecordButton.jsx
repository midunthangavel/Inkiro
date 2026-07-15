import { useEffect, useRef } from 'react';
import { TouchableOpacity, Animated, StyleSheet, Text } from 'react-native';

export default function VoiceRecordButton({ isRecording, onStart, onStop }) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isRecording) {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.25, duration: 500, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1,    duration: 500, useNativeDriver: true }),
        ])
      );
      anim.start();
      return () => anim.stop();
    }
    pulse.setValue(1);
  }, [isRecording]);

  return (
    <TouchableOpacity onPress={isRecording ? onStop : onStart} activeOpacity={0.8}>
      <Animated.View style={[s.btn, isRecording && s.btnRecording, { transform: [{ scale: pulse }] }]}>
        <Text style={{ fontSize: 18 }}>{isRecording ? '⏹' : '🎤'}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  btn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#22c55e', alignItems: 'center', justifyContent: 'center',
    marginRight: 8,
  },
  btnRecording: { backgroundColor: '#ef4444' },
});
