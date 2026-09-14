module.exports = ({ config }) => {
  const googleMapsApiKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
  const isEasBuild = process.env.EAS_BUILD === 'true';

  // A development/preview/production native build without this value produces
  // an APK that crashes as soon as Google Maps mounts. Fail the build instead
  // of silently shipping a broken binary.
  if (isEasBuild && !googleMapsApiKey) {
    throw new Error(
      'GOOGLE_MAPS_ANDROID_API_KEY is missing from the selected EAS environment.'
    );
  }

  const plugins = [...(config.plugins ?? [])];
  if (!plugins.some((plugin) => plugin === 'expo-iap' || (Array.isArray(plugin) && plugin[0] === 'expo-iap'))) {
    plugins.push('expo-iap');
  }

  if (googleMapsApiKey) {
    // Current react-native-maps Expo config plugin path.
    plugins.push([
      'react-native-maps',
      {
        androidGoogleMapsApiKey: googleMapsApiKey,
      },
    ]);
  }

  return {
    ...config,
    android: {
      ...config.android,
      ...(googleMapsApiKey
        ? {
            config: {
              ...(config.android?.config ?? {}),
              googleMaps: {
                ...(config.android?.config?.googleMaps ?? {}),
                apiKey: googleMapsApiKey,
              },
            },
          }
        : {}),
    },
    plugins,
  };
};
