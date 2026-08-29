import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/PrimaryButton';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { radius, spacing, ThemeColors, typography } from '../theme';

type Mode = 'signIn' | 'signUp';

export function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { colors, mode: themeMode, toggle } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canSubmit = email.trim().length > 3 && password.length >= 6 && !busy;

  const submit = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'signIn') {
        await signIn(email, password);
      } else {
        const { needsConfirmation } = await signUp(email, password);
        if (needsConfirmation) {
          setNotice('Check your email to confirm your account, then sign in.');
          setMode('signIn');
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={toggle}
          style={styles.themeButton}
          accessibilityRole="button"
          accessibilityLabel={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          <Ionicons
            name={themeMode === 'dark' ? 'sunny-outline' : 'moon-outline'}
            size={20}
            color={colors.textSecondary}
          />
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.title}>One Concept</Text>
          <Text style={styles.tagline}>
            {mode === 'signIn'
              ? 'Welcome back — sign in to pick up your streak.'
              : 'Create an account to keep your streak across devices.'}
          </Text>
        </View>

        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              editable={!busy}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="At least 6 characters"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
              secureTextEntry
              editable={!busy}
            />
          </View>

          {error ? (
            <View style={[styles.banner, styles.errorBanner]}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.streak} />
              <Text style={[styles.bannerText, { color: colors.streak }]}>{error}</Text>
            </View>
          ) : null}

          {notice ? (
            <View style={[styles.banner, styles.noticeBanner]}>
              <Ionicons name="mail-outline" size={18} color={colors.success} />
              <Text style={[styles.bannerText, { color: colors.success }]}>{notice}</Text>
            </View>
          ) : null}

          {busy ? (
            <View style={styles.busy}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <PrimaryButton
              label={mode === 'signIn' ? 'Sign in' : 'Create account'}
              onPress={submit}
              disabled={!canSubmit}
            />
          )}

          <Pressable
            onPress={() => {
              setMode(mode === 'signIn' ? 'signUp' : 'signIn');
              setError(null);
              setNotice(null);
            }}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={styles.switchText}>
              {mode === 'signIn'
                ? "New here? Create an account"
                : 'Already have an account? Sign in'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: spacing.lg, gap: spacing.xl, flexGrow: 1, justifyContent: 'center' },
    themeButton: {
      position: 'absolute',
      right: spacing.lg,
      top: spacing.lg,
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    header: { gap: spacing.sm },
    title: { ...typography.title, fontSize: 34, color: colors.text },
    tagline: { fontSize: 15, color: colors.textMuted, lineHeight: 22 },
    form: { gap: spacing.md },
    field: { gap: spacing.sm },
    label: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: colors.textMuted,
    },
    input: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      fontSize: 16,
      color: colors.text,
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      borderRadius: radius.md,
      padding: spacing.md,
    },
    errorBanner: { backgroundColor: colors.categoryChip },
    noticeBanner: { backgroundColor: colors.successSurface },
    bannerText: { flex: 1, fontSize: 14, lineHeight: 20 },
    busy: { paddingVertical: spacing.md, alignItems: 'center' },
    switchText: {
      textAlign: 'center',
      color: colors.primary,
      fontSize: 14,
      fontWeight: '600',
      paddingVertical: spacing.sm,
    },
  });
