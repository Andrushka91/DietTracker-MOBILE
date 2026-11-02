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
  OpenSans_700Bold,
  useFonts,
} from '@expo-google-fonts/open-sans';

import { AppProvider, useApp } from './src/ui/appContext';
import { TabBarGlyph, TabBarLabel, tabActiveChipFill } from './src/ui/components/TabBar';
import { BusyOverlay } from './src/ui/components/shell';
import { StatusCaption } from './src/ui/components/dialogs';
import { DashboardScreen } from './src/ui/screens/DashboardScreen';
import { CalendarScreen } from './src/ui/screens/CalendarScreen';
import { StatisticsScreen } from './src/ui/screens/StatisticsScreen';
import { TemplatesScreen } from './src/ui/screens/TemplatesScreen';
import { SettingsScreen } from './src/ui/screens/SettingsScreen';
import { themeColors } from './src/ui/theme';
import {
  TAB_BAR_EDGE_PADDING,
  TAB_BAR_PADDING_TOP,
  TAB_GLYPH_CHIP_HEIGHT,
  tabBarHeight,
} from './src/ui/tabBar';
import { t } from './src/ui/strings';
import { dateHandoff } from './src/ui/dates';
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
 * Bottom-tab item (spec 6.2, r3 mockup `.ds-nav`): ONE outline glyph per tab -
 * house, calendar, bar chart, layers, gear - drawn unchanged in both states
 * exactly as the mockup does. The active tab is told apart by the tinted chip
 * behind its glyph and the bolder caption under it (accent ink on both), never
 * by swapping the glyph for a filled twin. Layers and gear are Ionicons; the
 * house, the calendar and the stats bars have no Ionicons twin of the mockup's
 * shape, so they come from Feather and MaterialCommunityIcons (see the glyph
 * exceptions in `src/ui/components/icons.tsx`). Both pieces live in
 * `src/ui/components/TabBar.tsx`; the navigator's tint carries the accent /
 * muted colours, so neither hardcodes an ink.
 */
function Tabs(): React.JSX.Element {
  const { isDark } = useApp();
  const colors = themeColors(isDark);
  const insets = useSafeAreaInsets();
  /** Wash behind the ACTIVE tab's glyph - one accent tint for every theme. */
  const chipFill = tabActiveChipFill(colors);
  // DOCKED bar (r3 mockups, `.ds-nav`): react-navigation lays it out as a normal
  // sibling BELOW the pages, so the pages are inset by its full height and can
  // never slide under it - no absolute positioning, no side insets, no rounded
  // outer corners, no floating shadow. Its own surface paints across the bottom
  // safe area (the navigator supplies that inset as the bar's paddingBottom), so
  // no page background shows around or below it. Height and content gap come
  // from src/ui/tabBar.ts, which is also the only number the pages read.
  const barHeight = tabBarHeight(insets.bottom);
  return (
    <Tab.Navigator
      screenOptions={{
        // No app bar: each page starts with its own large title (the date,
        // the month, "Statistics"...).
        headerShown: false,
        tabBarStyle: {
          // Everything the floating bar used to add is gone on purpose.
          height: barHeight,
          paddingTop: TAB_BAR_PADDING_TOP,
          paddingHorizontal: TAB_BAR_EDGE_PADDING,
          // Opaque, theme-aware surface with ONE hairline divider as its edge.
          // The navigator's own theme is light-only here, so both colours are
          // set from ours.
          backgroundColor: colors.surface,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          // A docked bar casts no shadow: the divider separates it from the page.
          elevation: 0,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        /**
         * A custom label so the active caption can be semibold and so the five
         * single-word captions stay whole on a 360 pt phone with large system
         * text. This is the one place where the scale is capped (1.15); every
         * page keeps following the system font scale.
         */
        tabBarLabel: ({ color, focused, children }) => (
          <TabBarLabel color={color} focused={focused}>
            {children}
          </TabBarLabel>
        ),
        // The navigator reserves a fixed 31 x 28 box for the glyph; the chip is
        // 49 x 31, so the box is set to the chip's height to keep the tab at
        // exactly TAB_BAR_ITEM_HEIGHT and every caption on the same baseline.
        tabBarIconSize: TAB_GLYPH_CHIP_HEIGHT,
        tabBarIconStyle: { marginTop: 0 },
        // react-navigation already pads a tab by 5 pt; anything more here would
        // push the caption off the bar's bottom edge.
        tabBarItemStyle: { paddingVertical: 0, paddingHorizontal: 0 },
        // With the keyboard up the window shrinks (adjustResize): the docked bar
        // would eat most of the editor, so it steps out of the way instead.
        tabBarHideOnKeyboard: true,
      }}>
      <Tab.Screen
        name="DashboardTab"
        options={{
          title: t('Nav_Dashboard'),
          tabBarIcon: ({ focused, color }) => (
            <TabBarGlyph
              feather="home"
              color={color}
              focused={focused}
              chipFill={chipFill}
            />
          ),
        }}
        component={DashboardScreen as unknown as React.ComponentType<object>}
      />
      <Tab.Screen
        name="CalendarTab"
        options={{
          title: t('Nav_Calendar'),
          tabBarIcon: ({ focused, color }) => (
            <TabBarGlyph
              material="calendar-month-outline"
              color={color}
              focused={focused}
              chipFill={chipFill}
            />
          ),
        }}>
        {({ navigation, route }) => {
          // A date hand-off carries the day AND a request id, so a repeated tap
          // on the diary date re-opens the same day even after the calendar was
          // browsed to another month.
          const params = route.params as { date?: string; requestId?: number } | undefined;
          return (
            <CalendarScreen
              initialDate={params?.date}
              initialDateRequestId={params?.requestId}
              onOpenDay={(date) => {
                navigation.navigate('DashboardTab', dateHandoff(date) as never);
              }}
            />
          );
        }}
      </Tab.Screen>
      <Tab.Screen
        name="StatisticsTab"
        component={StatisticsScreen}
        options={{
          // The bar caption is the mockup's short "Stats" (all five captions
          // share one row); the page itself keeps its "Statistics" title.
          title: t('Rn_NavStats'),
          tabBarIcon: ({ focused, color }) => (
            <TabBarGlyph
              feather="bar-chart"
              color={color}
              focused={focused}
              chipFill={chipFill}
            />
          ),
        }}
      />
      <Tab.Screen
        name="TemplatesTab"
        component={TemplatesScreen}
        options={{
          title: t('Nav_Templates'),
          tabBarIcon: ({ focused, color }) => (
            <TabBarGlyph
              name="layers-outline"
              color={color}
              focused={focused}
              chipFill={chipFill}
            />
          ),
        }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsScreen}
        options={{
          title: t('Nav_Settings'),
          tabBarIcon: ({ focused, color }) => (
            <TabBarGlyph
              name="settings-outline"
              color={color}
              focused={focused}
              chipFill={chipFill}
            />
          ),
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
        <ActivityIndicator size="large" color={themeColors(isDark).accent} />
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
  const [fontsLoaded, fontError] = useFonts({
    OpenSans_400Regular,
    OpenSans_600SemiBold,
    OpenSans_700Bold,
  });
  if (!fontsLoaded && fontError === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={themeColors(false).accent} />
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
    backgroundColor: themeColors(false).background,
  },
});

export default App;
