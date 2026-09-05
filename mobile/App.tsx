import { Ionicons } from '@expo/vector-icons';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  Theme,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SpaceGrotesk_700Bold, useFonts } from '@expo-google-fonts/space-grotesk';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { ComponentProps, useCallback, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { WhatsNewCard } from './src/components/WhatsNewCard';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { ProgressProvider } from './src/context/ProgressContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { useWhatsNew } from './src/hooks/useWhatsNew';
import { AuthScreen } from './src/screens/AuthScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { AboutScreen } from './src/screens/AboutScreen';
import { PersonalizationScreen } from './src/screens/PersonalizationScreen';
import { ProfileScreen, ProfileStackParamList } from './src/screens/ProfileScreen';
import { StatsScreen } from './src/screens/StatsScreen';
import { TodayScreen } from './src/screens/TodayScreen';

// Hold the native splash up until we're ready to paint, instead of hiding it
// automatically and flashing a blank screen while the font loads (issue #93).
// Best-effort: if it's already hidden, ignore the error.
SplashScreen.preventAutoHideAsync().catch(() => {});

const Tab = createBottomTabNavigator();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();

function ProfileStackScreen() {
  return (
    <ProfileStack.Navigator screenOptions={{ headerShown: false }}>
      <ProfileStack.Screen name="ProfileHome" component={ProfileScreen} />
      <ProfileStack.Screen
        name="Personalization"
        component={PersonalizationScreen}
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
      />
      <ProfileStack.Screen
        name="About"
        component={AboutScreen}
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
      />
    </ProfileStack.Navigator>
  );
}

type IoniconName = ComponentProps<typeof Ionicons>['name'];

function tabIcon(focusedName: IoniconName, name: IoniconName) {
  return ({ focused, color, size }: { focused: boolean; color: string; size: number }) => (
    <Ionicons name={focused ? focusedName : name} size={size} color={color} />
  );
}

function ThemedApp() {
  const { colors, mode } = useTheme();
  const { loading, session } = useAuth();
  const whatsNew = useWhatsNew();

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
        <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      </View>
    );
  }

  if (!session) {
    return (
      <>
        <AuthScreen />
        <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      </>
    );
  }

  const base = mode === 'dark' ? DarkTheme : DefaultTheme;
  const navigationTheme: Theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
    },
  };

  return (
    <>
      <NavigationContainer theme={navigationTheme}>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.textMuted,
            tabBarStyle: {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
            },
            tabBarLabelStyle: { fontWeight: '600' },
          }}
        >
          <Tab.Screen
            name="Today"
            component={TodayScreen}
            options={{ tabBarIcon: tabIcon('sunny', 'sunny-outline') }}
          />
          <Tab.Screen
            name="History"
            component={HistoryScreen}
            options={{ tabBarIcon: tabIcon('library', 'library-outline') }}
          />
          <Tab.Screen
            name="Stats"
            component={StatsScreen}
            options={{ tabBarIcon: tabIcon('stats-chart', 'stats-chart-outline') }}
          />
          <Tab.Screen
            name="Profile"
            component={ProfileStackScreen}
            options={{ tabBarIcon: tabIcon('person', 'person-outline') }}
          />
        </Tab.Navigator>
      </NavigationContainer>
      {whatsNew.entry && (
        <WhatsNewCard entry={whatsNew.entry} onDismiss={whatsNew.dismiss} />
      )}
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
    </>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({ SpaceGrotesk_700Bold });
  // Proceed even if the font fails to load: falling back to the system font is
  // far better than hanging on the splash forever (preventAutoHideAsync would
  // otherwise never be undone).
  const ready = fontsLoaded || !!fontError;

  // Hide the native splash once the first frame has actually laid out, so it
  // hands straight over to real UI with no blank frame. Guard with a ref so
  // later layout passes (rotation, keyboard) don't call hideAsync again.
  const splashHidden = useRef(false);
  const onLayoutRootView = useCallback(() => {
    if (splashHidden.current) return;
    splashHidden.current = true;
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // The native splash stays up (preventAutoHideAsync above) until we're ready —
  // titles never flash in the fallback font, and there's no blank flash.
  if (!ready) return null;

  return (
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <ProgressProvider>
              <ThemedApp />
            </ProgressProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </View>
  );
}
