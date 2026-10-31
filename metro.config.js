// Metro configuration — Expo's defaults wrap the React Native ones, so both
// `npm start` (bare Metro) and `npx expo start --dev-client` (QR workflow)
// consume the same dependency graph.
const { getDefaultConfig } = require('expo/metro-config');

/**
 * @type {import('expo/metro-config').MetroConfig}
 */
const config = getDefaultConfig(__dirname);

module.exports = config;
