import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { ProfilePublishReviewSheet, PublicProfileFields } from '../components/ProfilePublishReviewSheet';
import { ShareProfileSheet } from '../components/ShareProfileSheet';
import { ScreenHeader } from '../components/ScreenHeader';
import { SettingRow } from '../components/SettingRow';
import { useAuth } from '../context/AuthContext';
import { useProgress } from '../context/ProgressContext';
import { useOnline } from '../context/ConnectivityContext';
import { useTheme } from '../context/ThemeContext';
import { ApiError, apiRequest } from '../api/client';
import { getPublicProfile, getSharing, PublicProfile, publicProfileUrl, putSharing, SharingSettings } from '../services/profileSharing';

type Award = { code: string; name: string; description: string; earned_on: string | null };

function reviewFields(settings: SharingSettings | null): PublicProfileFields {
  return {
    displayName: Boolean(settings?.show_name),
    avatar: Boolean(settings?.show_avatar),
    bio: Boolean(settings?.show_bio),
    streak: Boolean(settings?.show_streak),
    concepts: Boolean(settings?.show_learning),
    achievements: Boolean(settings?.achievement_codes.length),
  };
}

/** Profile data remains private until the explicit review-sheet confirmation succeeds. */
export function ProfileSharingScreen() {
  const navigation = useNavigation();
  const { session } = useAuth();
  const { progress } = useProgress();
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
  const [moreChoicesOpen, setMoreChoicesOpen] = useState(false);
  const [preview, setPreview] = useState<{ url: string; profile: PublicProfile } | null>(null);
  const active = useRef(true);
  const owner = useRef(userId);
  owner.current = userId;
  const operation = useRef(0);
  const pending = useRef(false);
  const presentation = useRef(0);

  const load = useCallback(async () => {
    if (pending.current) return;
    const currentOperation = ++operation.current;
    pending.current = true;
    setBusy(true);
    setMessage('');
    setPreview(null);
    try {
      const settings = await getSharing(userId);
      if (!active.current || owner.current !== userId || operation.current !== currentOperation) return;
      // Awards are loaded only to offer earned achievements as a safe allowlist.
      const earned = await apiRequest<{ items: Award[] }>('/v1/me/achievements', { expectedUserId: userId });
      if (active.current && owner.current === userId && operation.current === currentOperation) {
        setSaved(settings);
        setDraft(settings);
        setMoreChoicesOpen(Boolean(settings.show_streak || settings.show_learning || settings.achievement_codes.length));
        setAwards(earned.items.filter(award => award.earned_on));
      }
    } catch {
      if (active.current && owner.current === userId && operation.current === currentOperation) setMessage('We could not load your sharing choices. Check your connection and try again.');
    } finally {
      if (operation.current === currentOperation && owner.current === userId) {
        pending.current = false;
        if (active.current) setBusy(false);
      }
    }
  }, [userId]);

  useEffect(() => {
    active.current = true;
    operation.current += 1;
    pending.current = false;
    setSaved(null);
    setDraft(null);
    setAwards([]);
    setPreview(null);
    void load();
    return () => { active.current = false; operation.current += 1; };
  }, [load]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', () => {
      presentation.current += 1;
      setPreview(null);
    });
    return () => subscription.remove();
  }, []);

  const persist = async (enabled: boolean) => {
    if (!draft || pending.current || !online) return;
    const currentOperation = ++operation.current;
    pending.current = true;
    setBusy(true);
    setMessage('');
    try {
      const result = await putSharing(userId, { ...(enabled ? draft : saved ?? draft), enabled });
      if (active.current && owner.current === userId && operation.current === currentOperation) {
        setSaved(result);
        setDraft(result);
        setReviewing(false);
        setConfirmingTurnOff(false);
        setMessage(enabled ? 'Your public profile is live. You can share its link whenever you like.' : 'Sharing is off. Your previous public link no longer works.');
      }
    } catch (error) {
      if (active.current && owner.current === userId && operation.current === currentOperation) {
        setReviewing(false);
        setMessage(error instanceof ApiError && error.status === 409
          ? 'Sharing changed on another device. Nothing was published. Discard your edits and reload the current choices before trying again.'
          : 'Could not publish. Your choices are still here. Check your connection and review them again.');
      }
    } finally {
      if (operation.current === currentOperation && owner.current === userId) {
        pending.current = false;
        if (active.current) setBusy(false);
      }
    }
  };

  const openShare = async (send = false) => {
    if (pending.current) return;
    const opening = ++presentation.current;
    const currentOperation = ++operation.current;
    pending.current = true;
    setBusy(true);
    setMessage('');
    try {
      const current = await getSharing(userId);
      if (!active.current || owner.current !== userId || operation.current !== currentOperation) return;
      setSaved(current);
      setDraft(current);
      if (!current.enabled || !current.public_path) {
        setMessage('Your profile is private. Review and publish it before sharing a link.');
        return;
      }
      const url = publicProfileUrl(current.public_path);
      const profile = await getPublicProfile(current.public_path.slice(3));
      if (!active.current || owner.current !== userId || operation.current !== currentOperation || opening !== presentation.current) return;
      setPreview({ url, profile });
      if (send) await Share.share({ message: url });
    } catch {
      if (active.current && owner.current === userId && operation.current === currentOperation) {
        setPreview(null);
        setMessage('We could not prepare your public link. Check your connection and try again.');
      }
    } finally {
      if (operation.current === currentOperation && owner.current === userId) {
        pending.current = false;
        if (active.current) setBusy(false);
      }
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
  const draftPreview: PublicProfile = {
    ...(settings?.show_name ? { display_name: progress.displayName || 'Learner' } : {}),
    ...(settings?.show_avatar ? { avatar_ref: progress.avatarRef ?? undefined, avatar_url: progress.avatarUrl ?? undefined } : {}),
    ...(settings?.show_bio && progress.bio ? { bio: progress.bio } : {}),
    ...(settings?.show_streak ? { current_streak: progress.stats?.current ?? 0, longest_streak: progress.stats?.longest ?? 0 } : {}),
    ...(settings?.show_learning ? { concepts_learned: progress.stats?.totalLearned ?? progress.learned.length } : {}),
    achievements: awards.filter(award => visibleAwardCodes.includes(award.code)).map(award => ({ name: award.name, description: award.description })),
  };
  const extraCount = Number(Boolean(settings?.show_streak)) + Number(Boolean(settings?.show_learning)) + visibleAwardCodes.length;

  return <>
    <ProfilePublishReviewSheet
      visible={reviewing}
      fields={reviewFields(settings)}
      profile={draftPreview}
      busy={busy}
      online={online}
      title={saved?.enabled ? 'Review profile changes' : 'Review your public profile'}
      confirmLabel={saved?.enabled ? 'Publish changes' : 'Publish profile'}
      onClose={() => setReviewing(false)}
      onConfirm={() => void persist(true)}
    />
    <ShareProfileSheet value={preview} busy={busy} onClose={() => { presentation.current += 1; setPreview(null); }} onShare={() => void openShare(true)} />
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 20, paddingBottom: 96, gap: 14 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} style={{ alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Ionicons name="chevron-back" size={20} color={colors.primary} />
        <Text style={{ color: colors.primary, fontWeight: '700' }}>Back</Text>
      </Pressable>
      <ScreenHeader title="Public profile" />
      <View accessibilityRole="summary" style={{ gap: 5, padding: 16, borderRadius: 16, backgroundColor: saved?.enabled ? colors.successSurface : colors.surface }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{saved ? saved.enabled ? 'Public profile is live' : 'Profile is private' : 'Loading sharing choices…'}</Text>
        <Text style={{ color: colors.textSecondary }}>{saved?.enabled ? 'People with your link see your published choices.' : 'Only you can see this profile until you publish it.'}</Text>
        {dirty && <Text accessibilityLiveRegion="polite" style={{ color: colors.primary, fontWeight: '700' }}>You have changes that are not published yet.</Text>}
      </View>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 19, fontWeight: '700' }}>Your profile</Text>
        <Text style={{ color: colors.textSecondary }}>Choose what visitors can see.</Text>
      </View>
      {settings ? <>
        <SettingRow icon="person-outline" tone="primary" title="Display name" subtitle="Your profile name" value={settings.show_name} onValueChange={value => updateDraft({ show_name: value })} accessibilityLabel="Share display name" accessibilityHint="Includes or hides your display name on your public profile." disabled={busy} />
        <SettingRow icon="image-outline" tone="primary" title="Profile avatar" subtitle="Your chosen picture" value={settings.show_avatar} onValueChange={value => updateDraft({ show_avatar: value })} accessibilityLabel="Share profile avatar" accessibilityHint="Includes or hides your avatar on your public profile." disabled={busy} />
        <SettingRow icon="document-text-outline" tone="primary" title="Short bio" subtitle={progress.bio ? 'Your short introduction' : 'Add a bio in Edit profile first'} value={settings.show_bio} onValueChange={value => updateDraft({ show_bio: value })} accessibilityLabel="Share short bio" accessibilityHint="Includes or hides your short bio on your public profile." disabled={busy || (!progress.bio && !settings.show_bio)} />
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: moreChoicesOpen }} onPress={() => setMoreChoicesOpen(value => !value)} style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, borderRadius: 16, backgroundColor: colors.surface }}>
          <Text style={{ color: colors.text, fontWeight: '700', flex: 1, paddingRight: 12 }}>Learning highlights {extraCount ? `· ${extraCount} selected` : ''}</Text>
          <Text style={{ color: colors.primary, minWidth: 36, textAlign: 'right' }}>{moreChoicesOpen ? 'Hide' : 'Show'}</Text>
        </Pressable>
        {moreChoicesOpen && <>
          <SettingRow icon="flame-outline" tone="streak" title="Learning streak" subtitle="Current and longest streak" value={settings.show_streak} onValueChange={value => updateDraft({ show_streak: value })} accessibilityLabel="Share learning streak" accessibilityHint="Includes or hides your learning streak on your public profile." disabled={busy} />
          <SettingRow icon="library-outline" tone="saved" title="Concepts learned" subtitle="Your completed concept count" value={settings.show_learning} onValueChange={value => updateDraft({ show_learning: value })} accessibilityLabel="Share concepts learned" accessibilityHint="Includes or hides your completed concept count on your public profile." disabled={busy} />
          <SettingRow icon="ribbon-outline" tone="achievement" title="Earned achievements" subtitle={awards.length ? 'Choose which awards appear' : 'No earned awards yet'} value={visibleAwardCodes.length > 0} onValueChange={value => updateDraft({ achievement_codes: value ? awards.map(award => award.code) : [] })} accessibilityLabel="Share earned achievements" accessibilityHint="Includes or hides your earned achievements on your public profile." disabled={busy || awards.length === 0} />
          {visibleAwardCodes.length > 0 && awards.map(award => <SettingRow key={award.code} icon="medal-outline" tone="achievement" title={award.name} subtitle="Show this earned award" value={visibleAwardCodes.includes(award.code)} onValueChange={value => updateDraft({ achievement_codes: value ? [...visibleAwardCodes, award.code] : visibleAwardCodes.filter(code => code !== award.code) })} accessibilityLabel={`Share ${award.name}`} accessibilityHint="Includes or hides this achievement from your public profile." disabled={busy} />)}
        </>}
      </> : null}
      {!online && <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>Connect to the internet to publish or update your public profile.</Text>}
      {dirty ? <View style={{ gap: 10 }}>
        {action('Review changes', () => setReviewing(true), true)}
        {action('Discard changes', discardDraft)}
      </View> : saved?.enabled ? <View style={{ gap: 10 }}>
        {action('View and share profile', () => void openShare(), true)}
        {confirmingTurnOff ? <View accessibilityRole="alert" style={{ gap: 10, padding: 14, borderRadius: 14, backgroundColor: colors.dangerSurface }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>Turn off public profile?</Text>
          <Text style={{ color: colors.textSecondary }}>Your public link will stop working. Your private learning data stays in your account.</Text>
          {action('Confirm turn off sharing', () => void persist(false))}
          {action('Keep sharing', () => setConfirmingTurnOff(false))}
        </View> : action('Turn off sharing', () => setConfirmingTurnOff(true))}
      </View> : <View style={{ gap: 10 }}>
        {action('Preview before publishing', () => setReviewing(true), true)}
      </View>}
      {message ? <View style={{ gap: 8, padding: 14, borderRadius: 14, backgroundColor: colors.surface }}>
        <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{message}</Text>
        {message.startsWith('We could not load') ? action('Try loading again', () => void load()) : null}
        {message.startsWith('Sharing changed') ? action('Discard edits and reload', () => void load()) : null}
        {message.startsWith('We could not prepare') ? action('Try sharing again', () => void openShare()) : null}
      </View> : null}
    </ScrollView>
  </>;
}
