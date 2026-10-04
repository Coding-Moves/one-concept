import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { ProfilePublishReviewSheet, PublicProfileFields } from '../components/ProfilePublishReviewSheet';
import { ShareProfileSheet } from '../components/ShareProfileSheet';
import { ScreenHeader } from '../components/ScreenHeader';
import { SettingRow } from '../components/SettingRow';
import { useAuth } from '../context/AuthContext';
import { useOnline } from '../context/ConnectivityContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../api/client';
import { getPublicProfile, getSharing, PublicProfile, publicProfileUrl, putSharing, SharingSettings } from '../services/profileSharing';

type Award = { code: string; name: string; earned_on: string | null };

function reviewFields(settings: SharingSettings | null): PublicProfileFields {
  return {
    displayName: Boolean(settings?.show_name),
    avatar: Boolean(settings?.show_avatar),
    streak: Boolean(settings?.show_streak),
    concepts: Boolean(settings?.show_learning),
    achievements: Boolean(settings?.achievement_codes.length),
  };
}

/** Profile data remains private until the explicit review-sheet confirmation succeeds. */
export function ProfileSharingScreen() {
  const navigation = useNavigation();
  const { session } = useAuth();
  const userId = session!.user.id;
  const { colors } = useTheme();
  const online = useOnline();
  const [saved, setSaved] = useState<SharingSettings | null>(null);
  const [draft, setDraft] = useState<SharingSettings | null>(null);
  const [awards, setAwards] = useState<Award[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [confirmingTurnOff, setConfirmingTurnOff] = useState(false);
  const [preview, setPreview] = useState<{ url: string; profile: PublicProfile } | null>(null);
  const active = useRef(true);
  const pending = useRef(false);
  const presentation = useRef(0);

  const load = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage('');
    setPreview(null);
    try {
      const settings = await getSharing(userId);
      if (!active.current) return;
      setSaved(settings);
      setDraft(settings);
      // Awards are loaded only to offer earned achievements as a safe allowlist.
      const earned = await apiRequest<{ items: Award[] }>('/v1/me/achievements', { expectedUserId: userId });
      if (active.current) setAwards(earned.items.filter(award => award.earned_on));
    } catch {
      if (active.current) setMessage('We could not load your sharing choices. Check your connection and try again.');
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }, [userId]);

  useEffect(() => {
    active.current = true;
    void load();
    return () => { active.current = false; };
  }, [load]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', () => {
      presentation.current += 1;
      setPreview(null);
    });
    return () => subscription.remove();
  }, []);

  const persist = async (enabled: boolean) => {
    if (!draft || pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage('');
    try {
      const result = await putSharing(userId, { ...(enabled ? draft : saved ?? draft), enabled });
      if (active.current) {
        setSaved(result);
        setDraft(result);
        setReviewing(false);
        setConfirmingTurnOff(false);
        setMessage(enabled ? 'Your public profile is live. You can share its link whenever you like.' : 'Sharing is off. Your previous public link no longer works.');
      }
    } catch {
      if (active.current) setMessage('Your changes were not confirmed. Check your connection and review the current settings before trying again.');
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  };

  const openShare = async (send = false) => {
    if (pending.current) return;
    const opening = ++presentation.current;
    pending.current = true;
    setBusy(true);
    setMessage('');
    try {
      const current = await getSharing(userId);
      if (!active.current) return;
      setSaved(current);
      setDraft(current);
      if (!current.enabled || !current.public_path) {
        setMessage('Your profile is private. Review and publish it before sharing a link.');
        return;
      }
      const url = publicProfileUrl(current.public_path);
      const profile = await getPublicProfile(current.public_path.slice(3));
      if (!active.current || opening !== presentation.current) return;
      setPreview({ url, profile });
      if (send) await Share.share({ message: url });
    } catch {
      if (active.current) setMessage('We could not prepare your public link. Check your connection and try again.');
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const updateDraft = (change: Partial<SharingSettings>) => {
    setPreview(null);
    setMessage('');
    setDraft(current => current ? { ...current, ...change } : current);
  };
  const discardDraft = () => {
    if (saved) {
      setDraft(saved);
      setMessage('Unpublished changes discarded.');
    }
  };
  const action = (label: string, onPress: () => void, primary = false, disabled = busy || !online) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, backgroundColor: primary ? colors.primary : colors.surface, opacity: disabled ? 0.5 : pressed ? 0.75 : 1 })}
    >
      <Text style={{ color: primary ? colors.onPrimary : colors.primary, fontWeight: '700', textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
  const visibleAwardCodes = draft?.achievement_codes ?? [];
  const settings = draft ?? saved;

  return <>
    <ProfilePublishReviewSheet
      visible={reviewing}
      fields={reviewFields(settings)}
      busy={busy}
      title={saved?.enabled ? 'Review profile changes' : 'Review your public profile'}
      confirmLabel={saved?.enabled ? 'Publish changes' : 'Publish profile'}
      onClose={() => setReviewing(false)}
      onConfirm={() => void persist(true)}
    />
    <ShareProfileSheet value={preview} busy={busy} onClose={() => { presentation.current += 1; setPreview(null); }} onShare={() => void openShare(true)} />
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 24, gap: 18 }}>
      {action('← Back', () => navigation.goBack(), false, false)}
      <ScreenHeader title="Public profile" subtitle="Private by default. Choose the learning moments you want to share." />
      <View accessibilityRole="summary" style={{ gap: 5, padding: 16, borderRadius: 16, backgroundColor: saved?.enabled ? colors.successSurface : colors.surface }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{saved ? saved.enabled ? 'Your profile is shared' : 'Your profile is private' : 'Loading sharing choices…'}</Text>
        <Text style={{ color: colors.textSecondary }}>{saved?.enabled ? 'Only the items selected below are visible from your link.' : 'Nothing is public until you review and publish.'}</Text>
      </View>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 19, fontWeight: '700' }}>Choose what to share</Text>
        <Text style={{ color: colors.textSecondary }}>These are independent choices, so you can share more than one.</Text>
      </View>
      {settings ? <>
        <SettingRow icon="image-outline" tone="primary" title="Profile avatar" subtitle="Show your chosen avatar on your public profile." value={settings.show_avatar} onValueChange={value => updateDraft({ show_avatar: value })} accessibilityLabel="Share profile avatar" accessibilityHint="Includes or hides your avatar on your public profile." disabled={busy} />
        <SettingRow icon="person-outline" tone="primary" title="Display name" subtitle="Show the name people see on your profile." value={settings.show_name} onValueChange={value => updateDraft({ show_name: value })} accessibilityLabel="Share display name" accessibilityHint="Includes or hides your display name on your public profile." disabled={busy} />
        <SettingRow icon="flame-outline" tone="streak" title="Learning streak" subtitle="Show your current and longest learning streak." value={settings.show_streak} onValueChange={value => updateDraft({ show_streak: value })} accessibilityLabel="Share learning streak" accessibilityHint="Includes or hides your learning streak on your public profile." disabled={busy} />
        <SettingRow icon="library-outline" tone="saved" title="Concepts learned" subtitle="Show the number of concepts you have completed." value={settings.show_learning} onValueChange={value => updateDraft({ show_learning: value })} accessibilityLabel="Share concepts learned" accessibilityHint="Includes or hides your completed concept count on your public profile." disabled={busy} />
        <SettingRow icon="ribbon-outline" tone="achievement" title="Earned achievements" subtitle={awards.length ? 'Show your earned awards. Select individual awards below.' : 'You have no earned achievements to share yet.'} value={visibleAwardCodes.length > 0} onValueChange={value => updateDraft({ achievement_codes: value ? awards.map(award => award.code) : [] })} accessibilityLabel="Share earned achievements" accessibilityHint="Includes or hides your earned achievements on your public profile." disabled={busy || awards.length === 0} />
        {visibleAwardCodes.length > 0 && awards.map(award => <SettingRow key={award.code} icon="medal-outline" tone="achievement" title={award.name} subtitle="Include this earned achievement." value={visibleAwardCodes.includes(award.code)} onValueChange={value => updateDraft({ achievement_codes: value ? [...visibleAwardCodes, award.code] : visibleAwardCodes.filter(code => code !== award.code) })} accessibilityLabel={`Share ${award.name}`} accessibilityHint="Includes or hides this achievement from your public profile." disabled={busy} />)}
      </> : null}
      {!online && <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>Connect to the internet to publish or update your public profile.</Text>}
      {dirty ? <View style={{ gap: 10 }}>
        <Text style={{ color: colors.textSecondary }}>Your changes have not been published yet.</Text>
        {action('Review changes', () => setReviewing(true), true)}
        {action('Discard changes', discardDraft)}
      </View> : saved?.enabled ? <View style={{ gap: 10 }}>
        {action('Share profile', () => void openShare(), true)}
        {confirmingTurnOff ? <View accessibilityRole="alert" style={{ gap: 10, padding: 14, borderRadius: 14, backgroundColor: colors.dangerSurface }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>Turn off public profile?</Text>
          <Text style={{ color: colors.textSecondary }}>Your public link will stop working. Your private learning data stays in your account.</Text>
          {action('Confirm turn off sharing', () => void persist(false))}
          {action('Keep sharing', () => setConfirmingTurnOff(false))}
        </View> : action('Turn off sharing', () => setConfirmingTurnOff(true))}
      </View> : <View style={{ gap: 10 }}>
        {action('Preview before publishing', () => setReviewing(true), true)}
      </View>}
      {message ? <View style={{ gap: 8, padding: 14, borderRadius: 14, backgroundColor: colors.surface }}><Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{message}</Text>{message.startsWith('We could not') || message.startsWith('Your changes') ? action('Try again', () => void load(), false) : null}</View> : null}
    </ScrollView>
  </>;
}
