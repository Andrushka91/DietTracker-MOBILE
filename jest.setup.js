// Jest setup: mocks for every native module the domain tests touch through
// module imports (the rules themselves stay pure TypeScript).

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  },
}));

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(() => ({
    closeSync: jest.fn(),
    execAsync: jest.fn(async () => undefined),
    execSync: jest.fn(),
    getAllAsync: jest.fn(async () => [{ user_version: 12 }]),
    getAllSync: jest.fn(() => [{ user_version: 12 }]),
    withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => fn()),
  })),
}));

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///mock/documents/',
  getInfoAsync: jest.fn(async () => ({ exists: false, size: 0, uri: '', isDirectory: false })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  copyAsync: jest.fn(async () => undefined),
  readDirectoryAsync: jest.fn(async () => []),
}));

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async () => undefined),
  getItemAsync: jest.fn(async () => null),
  deleteItemAsync: jest.fn(async () => undefined),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
}));

// @expo/vector-icons ships ESM (`Ionicons.js` is `import ...`), which Jest cannot
// require without transforming all of node_modules. The icon is pure decoration
// in the tests - the component tests assert content and behaviour, and the icon
// NAMES are already checked at build time by TypeScript - so it renders as an
// empty Text carrying the name as its accessibility label.
jest.mock('@expo/vector-icons/Ionicons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: (props: { name: string }) =>
      React.createElement(Text, { accessibilityLabel: `icon:${props.name}` }),
  };
});

jest.mock('expo-modules-core', () => ({
  requireNativeModule: jest.fn(() => ({
    playServicesAvailable: jest.fn(async () => true),
    authorize: jest.fn(async () => ({ accessToken: 'test-access-token', grantedScopes: [] })),
  })),
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationCategoryAsync: jest.fn(async () => ({})),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  scheduleNotificationAsync: jest.fn(async () => 'notification-id'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  dismissNotificationAsync: jest.fn(async () => undefined),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: {
    manipulate: jest.fn(() => ({
      renderAsync: jest.fn(async () => ({ width: 256, height: 256 })),
    })),
  },
  manipulateAsync: jest.fn(async () => ({
    uri: 'file:///tmp/t.jpg',
    width: 256,
    height: 256,
    size: 1,
  })),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));