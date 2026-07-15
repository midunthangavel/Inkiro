import { useState, useEffect, useRef } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Audio } from 'expo-av';

export default function MessageBubble({ message, isMine }) {
  const [playing, setPlaying] = useState(false);
  const soundRef = useRef(null);

  useEffect(() => () => { soundRef.current?.unloadAsync(); }, []);

  const time = new Date(message.created_at).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit',
  });

  if (message.message_type === 'system') {
    return (
      <View style={s.systemRow}>
        <Text style={s.systemText}>{message.text_content}</Text>
      </View>
    );
  }

  if (message.message_type === 'voice') {
    const togglePlay = async () => {
      if (playing) {
        await soundRef.current?.stopAsync();
        setPlaying(false);
        return;
      }
      const { sound } = await Audio.Sound.createAsync(
        { uri: message.voice_url }, { shouldPlay: true }
      );
      soundRef.current = sound;
      setPlaying(true);
      sound.setOnPlaybackStatusUpdate(st => { if (st.didJustFinish) setPlaying(false); });
    };
    return (
      <View style={[s.row, isMine ? s.rowMine : s.rowTheirs]}>
        <TouchableOpacity style={[s.voiceBubble, isMine && s.voiceBubbleMine]} onPress={togglePlay}>
          <Text style={{ fontSize: 18 }}>{playing ? '⏸' : '▶️'}</Text>
          <View style={s.waveRow}>
            {[8, 14, 10, 18, 12, 16, 8, 14, 10].map((h, i) => (
              <View key={i} style={[s.wave, { height: h }, isMine && s.waveMine]} />
            ))}
          </View>
          <Text style={[s.time, isMine && s.timeMine]}>🎤</Text>
        </TouchableOpacity>
        <Text style={[s.time, isMine && s.timeMine, { marginTop: 3 }]}>{time}</Text>
      </View>
    );
  }

  if (message.message_type === 'image') {
    return (
      <View style={[s.row, isMine ? s.rowMine : s.rowTheirs]}>
        <Image source={{ uri: message.image_url }} style={s.img} resizeMode="cover" />
        <Text style={[s.time, isMine && s.timeMine, { marginTop: 3 }]}>{time}</Text>
      </View>
    );
  }

  // Text bubble
  return (
    <View style={[s.row, isMine ? s.rowMine : s.rowTheirs]}>
      <View style={[s.bubble, isMine ? s.bubbleMine : s.bubbleTheirs]}>
        <Text style={[s.bubbleText, isMine && s.bubbleTextMine]}>{message.text_content}</Text>
      </View>
      <View style={s.metaRow}>
        <Text style={[s.time, isMine && s.timeMine]}>{time}</Text>
        {isMine && (
          <Text style={[s.time, { color: message.is_read ? '#4ade80' : '#999' }]}>
            {message.is_read ? ' ✓✓' : ' ✓'}
          </Text>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row:         { marginVertical: 3, maxWidth: '76%' },
  rowMine:     { alignSelf: 'flex-end', alignItems: 'flex-end' },
  rowTheirs:   { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble:      { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleMine:  { backgroundColor: '#22c55e', borderBottomRightRadius: 4 },
  bubbleTheirs:{ backgroundColor: '#f0f0f0', borderBottomLeftRadius: 4 },
  bubbleText:  { fontSize: 15, color: '#1a1a1a', lineHeight: 21 },
  bubbleTextMine: { color: '#fff' },
  metaRow:     { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  time:        { fontSize: 11, color: '#999' },
  timeMine:    { color: 'rgba(255,255,255,0.6)' },
  systemRow:   { alignItems: 'center', marginVertical: 8, paddingHorizontal: 20 },
  systemText:  {
    fontSize: 11, color: '#888', textAlign: 'center',
    backgroundColor: '#f5f5f5', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 10, overflow: 'hidden',
  },
  voiceBubble: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f0f0f0', padding: 12, borderRadius: 18,
  },
  voiceBubbleMine: { backgroundColor: '#22c55e' },
  waveRow:     { flexDirection: 'row', alignItems: 'center', gap: 2 },
  wave:        { width: 3, backgroundColor: '#22c55e', borderRadius: 2 },
  waveMine:    { backgroundColor: 'rgba(255,255,255,0.8)' },
  img:         { width: 200, height: 200, borderRadius: 14 },
});
