import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { scaleFont, spacing } from '../theme';

/** One action for native pull gestures and an accessible button on every platform. */
export function useRefreshControl(label: string, task: () => Promise<unknown>) {
  const { colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const onRefresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    setFailed(false);
    try { await task(); } catch { if (mounted.current) setFailed(true); }
    finally { busy.current = false; if (mounted.current) setRefreshing(false); }
  }, [task]);
  const control = <RefreshControl refreshing={refreshing} onRefresh={onRefresh}
    tintColor={colors.primary} colors={[colors.primary]} />;
  const action = <View>
    <Pressable accessibilityRole="button" accessibilityLabel={`Refresh ${label}`}
      accessibilityState={{ disabled: refreshing, busy: refreshing }} disabled={refreshing} onPress={onRefresh}
      style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingVertical: spacing.sm }}>
      <Text style={{color: colors.textSecondary, fontSize: scaleFont(14), fontWeight: '600'}}>
        {refreshing ? 'Refreshing…' : `Refresh ${label}`}
      </Text>
    </Pressable>
    {failed ? <Text accessibilityRole="alert" style={{color: colors.textSecondary}}>Couldn’t refresh. Try again.</Text> : null}
  </View>;
  return { control, action, refreshing, onRefresh };
}
