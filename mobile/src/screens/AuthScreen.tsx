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
import { describeAuthError } from '../services/authErrors';
import { scaleIcon, scaleFont, radius, shadows, spacing, ThemeColors, typography } from '../theme';

type Mode = 'signIn' | 'signUp';

export function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { colors, mode: themeMode, toggle } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { signIn, signUp, resetPassword } = useAuth();

  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A banner with a bold header + body. The reset variant carries the email so
  // it can be shown back for a quick typo check (issue #136).
  const [notice, setNotice] = useState<
    { title: string; body: string } | { title: string; sentTo: string } | null
  >(null);

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
          setNotice({
            title: 'Check your email',
            body: 'Confirm your account from the email we just sent, then sign in.',
          });
          setMode('signIn');
        }
      }
    } catch (e) {
      setError(describeAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const forgotPassword = async () => {
    const trimmed = email.trim();
    if (trimmed.length <= 3 || !trimmed.includes('@')) {
      setNotice(null);
      setError('Enter your email above first, then tap “Forgot password?”.');
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await resetPassword(trimmed);
      // Show the email back for a typo check, but stay neutral about whether an
      // account exists ("if it's registered") — no account enumeration.
      setNotice({ title: 'Check your email', sentTo: trimmed });
    } catch (e) {
      setError(describeAuthError(e));
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
            size={scaleIcon(20)}
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
              onChangeText={(t) => {
                setEmail(t);
                // Editing the address invalidates the previous banner (#136).
                if (notice) setNotice(null);
                if (error) setError(null);
              }}
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
            {mode === 'signIn' ? (
              <Pressable
                onPress={forgotPassword}
                disabled={busy}
                accessibilityRole="button"
                style={styles.forgot}
              >
                <Text style={styles.forgotText}>Forgot password?</Text>
              </Pressable>
            ) : null}
          </View>

          {error ? (
            <View style={[styles.banner, styles.errorBanner]} accessibilityRole="alert">
              <Ionicons name="alert-circle-outline" size={scaleIcon(18)} color={colors.streak} />
              <Text style={[styles.bannerText, { color: colors.streak }]}>{error}</Text>
            </View>
          ) : null}

          {notice ? (
            <View
              style={[styles.banner, styles.noticeBanner]}
              accessibilityRole="alert"
            >
              <Ionicons name="mail-outline" size={scaleIcon(18)} color={colors.success} />
              <View style={styles.bannerBody}>
                <Text style={styles.noticeTitle}>{notice.title}</Text>
                <Text style={styles.noticeText}>
                  {'sentTo' in notice ? (
                    <>
                      We’ve sent a password reset link to{' '}
                      <Text style={styles.noticeStrong}>{notice.sentTo}</Text> (if it’s
                      registered). Check your inbox and spam folder.
                    </>
                  ) : (
                    notice.body
                  )}
                </Text>
              </View>
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
    title: { ...typography.title, fontSize: scaleFont(38), color: colors.text },
    tagline: { fontSize: scaleFont(15), color: colors.textMuted, lineHeight: scaleFont(22) },
    form: { gap: spacing.md },
    field: { gap: spacing.sm },
    label: {
      fontSize: scaleFont(12),
      fontWeight: '700',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: colors.textMuted,
    },
    input: {
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radius.lg,
      paddingHorizontal: spacing.md + 2,
      paddingVertical: spacing.md,
      fontSize: scaleFont(16),
      color: colors.text,
      ...shadows.card,
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      borderRadius: radius.lg,
      padding: spacing.md,
    },
    errorBanner: { backgroundColor: colors.categoryChip },
    noticeBanner: { backgroundColor: colors.successSurface },
    bannerText: { flex: 1, fontSize: scaleFont(14), lineHeight: scaleFont(20) },
    bannerBody: { flex: 1, gap: 2 },
    noticeTitle: {
      fontSize: scaleFont(15),
      fontWeight: '700',
      color: colors.success,
    },
    // Body in the primary text colour, not green-on-green — high contrast on
    // the success surface in both light and dark themes (issue #136).
    noticeText: {
      fontSize: scaleFont(14),
      lineHeight: scaleFont(20),
      color: colors.text,
    },
    noticeStrong: { fontWeight: '700', color: colors.text },
    busy: { paddingVertical: spacing.md, alignItems: 'center' },
    switchText: {
      textAlign: 'center',
      color: colors.primary,
      fontSize: scaleFont(14),
      fontWeight: '600',
      paddingVertical: spacing.sm,
    },
    forgot: { alignSelf: 'flex-end', paddingTop: spacing.xs },
    forgotText: {
      color: colors.primary,
      fontSize: scaleFont(13),
      fontWeight: '600',
    },
  });
