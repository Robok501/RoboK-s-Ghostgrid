// Metro config: the default Expo setup. For the web build only (used to render screens for layout reviews),
// expo-file-system is replaced by an in-memory stand-in.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const config = getDefaultConfig(__dirname);
const original = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'expo-file-system') {
    return { type: 'sourceFile', filePath: path.resolve(__dirname, 'src/web/fs-mock.ts') };
  }
  if (platform === 'web' && moduleName === 'expo-keep-awake') {
    return { type: 'sourceFile', filePath: path.resolve(__dirname, 'src/web/keep-awake.ts') };
  }
  return (original ?? context.resolveRequest)(context, moduleName, platform);
};
module.exports = config;
