import Constants from 'expo-constants';
import { Text, View } from 'react-native';

/** Remains visible on signed-in and signed-out staging screens. */
export function StagingBanner() {
  if (Constants.expoConfig?.extra?.appVariant !== 'staging') return null;
  return (
    <View accessibilityRole="text" style={{ backgroundColor: '#794400', paddingVertical: 5, paddingHorizontal: 12 }}>
      <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800', textAlign: 'center', letterSpacing: 1 }}>
        STAGING · TEST DATA
      </Text>
    </View>
  );
}
