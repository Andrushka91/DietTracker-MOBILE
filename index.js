/**
 * @format
 */

import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// 'main' is the key the Expo runtime (Expo Go / `expo start`) renders.
registerRootComponent(App);
// The app.json name keeps classic React Native hosts working too.
AppRegistry.registerComponent(appName, () => App);
