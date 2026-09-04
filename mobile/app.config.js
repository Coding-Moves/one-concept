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
module.exports = {
  expo: {
    name: 'One Concept',
    slug: 'one-concept',
    owner: 'coding-moves',
    version: '1.2.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    ios: {
      supportsTablet: true,
    },
    android: {
      package: 'com.codingmoves.oneconcept',
      googleServicesFile: './google-services.json',
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    runtimeVersion: '1.1.1',
    updates: {
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
      url: 'https://u.expo.dev/2ce53ebe-f549-4a33-affc-a50d8e80b483',
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: ['expo-font', 'expo-secure-store'],
    extra: {
      eas: {
        projectId: '2ce53ebe-f549-4a33-affc-a50d8e80b483',
      },
    },
  },
};
