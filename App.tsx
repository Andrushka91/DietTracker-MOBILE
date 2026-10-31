// Application root (spec 6): bootstraps the database, hosts the five-tab shell
// inside a native stack, and mounts the cross-cutting overlays (busy 6.4,
// floating caption 6.6).
//
// There is no sign-in wall and no synchronization bar: the app opens straight
// into the dashboard, guest mode included, and the account is connected (or a
// manual sync started) from the Settings page. Background cycles stay invisible;
// each list refreshes through its own pull-to-refresh spinner.
//
// Navigation (6.2): bottom tab bar with Dashboard / Calendar / Statistics /
// Templates / Settings; Android hardware back goes to Dashboard before
// exiting; iOS relies on tab persistence.

import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  NavigationContainer,
  type NavigationContainerRef,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  OpenSans_400Regular,
  OpenSans_600SemiBold,
  useFonts,
} from '@expo-google-fonts/open-sans';

import { AppProvider, useApp } from './src/ui/appContext';
import { BusyOverlay } from './src/ui/components/shell';
import { StatusCaption } from './src/ui/components/dialogs';
import { DashboardScreen } from './src/ui/screens/DashboardScreen';
import { CalendarScreen } from './src/ui/screens/CalendarScreen';
import { StatisticsScreen } from './src/ui/screens/StatisticsScreen';
import { TemplatesScreen } from './src/ui/screens/TemplatesScreen';
import { SettingsScreen } from './src/ui/screens/SettingsScreen';
import { argb, fonts, themeColors } from './src/ui/theme';
import { t } from './src/ui/strings';
import { setAppActive, startSyncTriggers, stopSyncTriggers } from './src/cloud/syncEngine';
import {
  ensureNotificationChannels,
  installReminderEventHandlers,
  scheduleReminders,
} from './src/services/reminders';
import { configureGoogle, isGoogleConfigured } from './src/cloud/auth';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

type RootStackParamList = {
  Tabs: undefined;
  Dashboard: { date?: string; mealKey?: number } | undefined;
};

/** Reads the optional runtime client config (no secret in the repo - 7.1.4). */
function loadGoogleConfig(): void {
  try {
    const config = require('./google-client.json') as {
      androidClientId?: string;
      webClientId?: string;
      iosClientId?: string;
    };
    configureGoogle(config);
  } catch {
    configureGoogle({});
  }
  if (!isGoogleConfigured()) {
    // Fails fast later with Auth_google_not_configured (spec 7.1.4).
    console.warn('[auth] Google client not configured - sign-in is disabled.');
  }
}

/**
 * Bottom-tab icon (spec 6.2): the Windows app draws a Segoe Fluent glyph, the
 * phone uses the equivalent emoji so the five tabs stay recognisable without a
 * bundled icon font.
 */
function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }): React.JSX.Element {
  return <Text style={[styles.tabIcon, { opacity: focused ? 1 : 0.55 }]}>{glyph}</Text>;
}

function Tabs(): React.JSX.Element {
  const { isDark } = useApp();
  const colors = themeColors(isDark);
  return (
    <Tab.Navigator
      screenOptions={{
        // No app bar: each page starts with its own large title (the date,
        // the month, "Statistics"...).
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontFamily: fonts.regular },
      }}>
      <Tab.Screen
        name="DashboardTab"
        options={{
          title: t('Nav_Dashboard'),
          tabBarIcon: ({ focused }) => <TabIcon glyph="🏠" focused={focused} />,
        }}
        component={DashboardScreen as unknown as React.ComponentType<object>}
      />
      <Tab.Screen
        name="CalendarTab"
        options={{
          title: t('Nav_Calendar'),
          tabBarIcon: ({ focused }) => <TabIcon glyph="📅" focused={focused} />,
        }}>
        {({ navigation }) => (
          <CalendarScreen
            onOpenDay={(date) => {
              navigation.navigate('DashboardTab', { date } as never);
            }}
          />
        )}
      </Tab.Screen>
      <Tab.Screen
        name="StatisticsTab"
        component={StatisticsScreen}
        options={{
          title: t('Nav_Statistics'),
          tabBarIcon: ({ focused }) => <TabIcon glyph="📊" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="TemplatesTab"
        component={TemplatesScreen}
        options={{
          title: t('Nav_Templates'),
          tabBarIcon: ({ focused }) => <TabIcon glyph="📋" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsScreen}
        options={{
          title: t('Nav_Settings'),
          tabBarIcon: ({ focused }) => <TabIcon glyph="⚙️" focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}

function Root(): React.JSX.Element {
  const { ready, isDark, busy } = useApp();
  // Hook order matters: this must stay above the `!ready` early return.
  const insets = useSafeAreaInsets();
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);

  // Sync triggers + reminder scheduling + deep-link handlers (spec 10.3).
  useEffect(() => {
    loadGoogleConfig();
    startSyncTriggers();
    void (async () => {
      // Each step degrades independently: a native failure in one must not
      // abort the other nor become an uncaught promise rejection.
      try {
        await ensureNotificationChannels();
      } catch (error) {
        console.warn('[reminders] channel setup failed', error);
      }
      try {
        await scheduleReminders();
      } catch (error) {
        console.warn('[reminders] scheduling failed', error);
      }
    })();
    installReminderEventHandlers({
      onOpenMeal: (date, mealCategoryKey) => {
        navigationRef.current?.navigate('Dashboard', { date, mealKey: mealCategoryKey });
      },
      accountId: () => null,
    });

    // The other device's changes are pulled while the app is in front of the
    // user: coming back to it pulls at once, and the poll pauses in background.
    setAppActive(AppState.currentState === 'active');
    const appStateSubscription = AppState.addEventListener('change', (next) => {
      // setAppActive already requests a download when the app comes back.
      setAppActive(next === 'active');
    });

    return () => {
      appStateSubscription.remove();
      stopSyncTriggers();
    };
  }, []);

  // Android hardware back walks to Dashboard before exiting (spec 6.2).
  useEffect(() => {
    if (Platform.OS !== 'android') {
      return undefined;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const ref = navigationRef.current;
      if (ref === null) {
        return false;
      }
      if (ref.getCurrentRoute()?.name === 'Dashboard') {
        return false; // let the system exit
      }
      ref.navigate('Dashboard', undefined);
      return true;
    });
    return () => subscription.remove();
  }, []);

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={argb('#FF007AFF')} />
      </View>
    );
  }

  const colors = themeColors(isDark);
  return (
    <NavigationContainer ref={navigationRef}>
      <StatusBar barStyle={colors.statusBarStyle} />
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          // The pages start right below the system status bar.
          paddingTop: insets.top,
        }}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Dashboard" component={Tabs} />
        </Stack.Navigator>
        <StatusCaption />
        {busy !== null && <BusyOverlay />}
      </View>
    </NavigationContainer>
  );
}

function App(): React.JSX.Element {
  // The bundled typeface has to be ready before the first text renders - a
  // late load would flash the system font and swap it while the user watches.
  // A failed load (a corrupted asset) falls through to the system font instead
  // of pinning the app on its spinner forever.
  const [fontsLoaded, fontError] = useFonts({ OpenSans_400Regular, OpenSans_600SemiBold });
  if (!fontsLoaded && fontError === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={argb('#FF007AFF')} />
      </View>
    );
  }
  if (fontError !== null) {
    console.warn('[fonts] Open Sans could not be loaded - falling back to the system font', fontError);
  }
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Root />
      </AppProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: argb('#FFF3F3F3'),
  },
  tabIcon: { fontSize: 18 },
});

export default App;
