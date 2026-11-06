// The single source of Expo config (there is no app.json). It is a .js file
// specifically so runtimeVersion can carry the warning below — a JSON file
// cannot hold a comment at the value, and getting that value wrong silently
// breaks OTA for every installed app.
//
// runtimeVersion is the native-ABI identity of a build: an OTA update only
// reaches installed apps whose runtimeVersion MATCHES the one it was published
// under. It is deliberately PINNED and DECOUPLED from `version` (the marketing
// version, which every release bumps freely).
//
// DO NOT set runtimeVersion to `version` or bump it on an ordinary release —
// that publishes OTA updates under a runtime no installed binary has, silently
// cutting every phone off from updates. Change it ONLY when you ship a new APK
// containing a native change (new native module, icon, or native app config),
// to that new build's runtime. See mobile/DEPLOYMENT.md.
const variant = process.env.APP_VARIANT || 'production';
if (!['production', 'staging'].includes(variant)) {
  throw new Error('APP_VARIANT must be production or staging');
}
const staging = variant === 'staging';

module.exports = {
  expo: {
    name: staging ? 'One Concept Staging' : 'One Concept',
    slug: 'one-concept',
    owner: 'coding-moves',
    version: '1.10.19',
    scheme: staging ? 'com.codingmoves.oneconcept.staging' : 'com.codingmoves.oneconcept',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    ios: {
      supportsTablet: true,
      bundleIdentifier: staging ? 'com.codingmoves.oneconcept.staging' : 'com.codingmoves.oneconcept',
    },
    android: {
      package: staging ? 'com.codingmoves.oneconcept.staging' : 'com.codingmoves.oneconcept',
      googleServicesFile: staging
        ? (process.env.STAGING_GOOGLE_SERVICES_FILE || './google-services.staging.json')
        : './google-services.json',
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    // Updated Expo native packages require a new APK before this runtime receives updates.
    // Keep staging OTA separate even from older preview builds with the production package.
    // expo-dev-client is a native module, so the next production release needs a new APK.
    runtimeVersion: staging ? '1.10.19-staging.1' : '1.10.19',
    updates: {
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
      url: 'https://u.expo.dev/2ce53ebe-f549-4a33-affc-a50d8e80b483',
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: ['expo-font', 'expo-secure-store', 'expo-splash-screen', ['expo-camera', { cameraPermission: 'Allow One Concept to scan a profile QR code.', microphonePermission: false, recordAudioAndroid: false, barcodeScannerEnabled: true }], ['expo-image-picker', { photosPermission: 'Allow One Concept to choose a profile photo.', cameraPermission: 'Allow One Concept to take a profile photo.', microphonePermission: false }]],
    extra: {
      appVariant: variant,
      eas: {
        projectId: '2ce53ebe-f549-4a33-affc-a50d8e80b483',
      },
    },
  },
};
