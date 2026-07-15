import { View, Text, StyleSheet } from 'react-native';

export default function UnreadBadge({ count }) {
  if (!count) return null;
  return (
    <View style={s.badge}>
      <Text style={s.text}>{count > 99 ? '99+' : String(count)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  badge: {
    backgroundColor: '#ef4444', borderRadius: 10, minWidth: 20, height: 20,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6,
  },
  text: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
