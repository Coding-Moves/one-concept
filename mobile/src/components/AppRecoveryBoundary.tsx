import { Component, ErrorInfo, ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { contactSupport } from './support';

interface Props { children: ReactNode }
interface State { failed: boolean }

/** Last-resort UI for render errors. Async request failures use screen recovery states. */
export class AppRecoveryBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(_: Error, __: ErrorInfo) {
    // #161 owns production error reporting. Never render or log exception text here.
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View accessibilityRole="alert" style={styles.screen}>
        <View accessible={false} style={styles.artwork}>
          <Ionicons name="sparkles-outline" size={44} color="#4f46e5" />
        </View>
        <Text accessibilityRole="header" style={styles.title}>We’re getting things ready</Text>
        <Text style={styles.message}>Your saved learning is still on this device. Try opening the app again, or contact support if this keeps happening.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Try opening the app again" onPress={() => this.setState({ failed: false })} style={styles.primary}>
          <Text style={styles.primaryLabel}>Try again</Text>
        </Pressable>
        <Pressable accessibilityRole="link" accessibilityLabel="Contact support by email" onPress={() => contactSupport('One Concept app help')} style={styles.secondary}>
          <Text style={styles.secondaryLabel}>Contact support</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#f8f8ff', gap: 16 },
  artwork: { width: 104, height: 104, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ecebff' },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', color: '#171726', textAlign: 'center' },
  message: { maxWidth: 340, fontSize: 16, lineHeight: 23, color: '#55566b', textAlign: 'center' },
  primary: { minHeight: 48, minWidth: 190, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, borderRadius: 999, backgroundColor: '#4f46e5' },
  primaryLabel: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondary: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 16 },
  secondaryLabel: { color: '#4f46e5', fontWeight: '700', fontSize: 16 },
});
