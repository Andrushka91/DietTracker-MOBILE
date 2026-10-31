// Onboarding (spec 8.1) - first launch only (OnboardingCompleted flag):
// title + description, "Choose how to keep your data" card with
// "Sign in with Google" and "Continue without an account" (guest caption),
// the consent toggle (sign-in without consent is refused with
// Account_ConsentRequired), busy spinner while busy + a status message line.
// Offline must never block first use: a sign-in failure shows a localized
// reason AND still finishes onboarding.

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp } from '../appContext';
import { BarButton } from '../components/buttons';
import { fonts, cardShadow, themeColors, typeScale } from '../theme';
import { t } from '../strings';

export function OnboardingScreen(): React.JSX.Element {
  const app = useApp();
  const colors = themeColors(app.isDark);
  const insets = useSafeAreaInsets();
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const continueAsGuest = async (): Promise<void> => {
    if (app.preferences !== null && !app.preferences.synchronizationEnabled) {
      await app.setPreference('synchronizationEnabled', false);
    }
    await app.completeOnboarding();
  };

  const signIn = async (): Promise<void> => {
    setError(null);
    const result = await app.signInWithConsent(consent);
    if (!result.ok) {
      setError(t(result.error ?? 'Auth_Unknown'));
      // Offline must never block first use - still finish onboarding.
      await app.completeOnboarding();
      return;
    }
    await app.completeOnboarding();
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 },
      ]}>
      <Text style={[styles.title, { color: colors.text }]}>{t('Onboarding_Title')}</Text>
      <Text style={[styles.description, { color: colors.textSecondary }]}>
        {t('Onboarding_Description')}
      </Text>

      <View style={[styles.card, cardShadow, { backgroundColor: colors.cardFill }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{t('Onboarding_ChooseProvider')}</Text>

        <View style={styles.consentRow}>
          <Switch
            value={consent}
            onValueChange={setConsent}
            accessibilityLabel={t('Onboarding_Consent')}
            trackColor={{ false: colors.border, true: colors.success }}
            thumbColor="#FFFFFF"
          />
          <Text style={[styles.consent, { color: colors.textSecondary }]}>{t('Onboarding_Consent')}</Text>
        </View>
        <Text style={[styles.consentHint, { color: colors.textMuted }]}>
          {t('Onboarding_ConsentText')}
        </Text>

        <View style={styles.buttons}>
          <BarButton label={t('Account_Google')} accent onPress={() => void signIn()} colors={colors} />
          <BarButton label={t('Onboarding_ContinueWithoutAccount')} onPress={() => void continueAsGuest()} colors={colors} />
        </View>
        <Text style={[styles.guest, { color: colors.textMuted }]}>{t('Onboarding_GuestDescription')}</Text>

        {error !== null && (
          <Pressable onPress={() => setError(null)}>
            <Text style={[styles.error, { color: colors.error }]}>{error}</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: typeScale.title, fontFamily: fonts.medium },
  description: { fontSize: 14, lineHeight: 20, marginTop: 10 },
  card: { borderRadius: 16, padding: 18, marginTop: 20, rowGap: 12 },
  cardTitle: { fontSize: typeScale.headline, fontFamily: fonts.medium },
  consentRow: { flexDirection: 'row', alignItems: 'center', columnGap: 10 },
  consent: { flex: 1, fontSize: 13 },
  consentHint: { fontSize: 11, lineHeight: 15 },
  buttons: { rowGap: 10, marginTop: 4 },
  guest: { fontSize: 12, lineHeight: 16 },
  error: { fontSize: 13, fontFamily: fonts.medium },
});