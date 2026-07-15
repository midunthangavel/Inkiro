import { ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native';

export default function QuickReplies({ replies, onPress }) {
  if (!replies || replies.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={s.container}
      contentContainerStyle={s.content}
    >
      {replies.map((r, i) => (
        <TouchableOpacity key={i} style={s.chip} onPress={() => onPress(r)} activeOpacity={0.7}>
          <Text style={s.chipText}>{r.emoji} {r.text}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { maxHeight: 52, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  content:   { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  chip:      {
    backgroundColor: '#f0f0f0', paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, flexDirection: 'row', alignItems: 'center',
  },
  chipText:  { fontSize: 13, color: '#333' },
});
