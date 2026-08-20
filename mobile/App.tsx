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
import { StatusBar } from 'expo-status-bar';
import { ComponentProps } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ProgressProvider } from './src/context/ProgressContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { PersonalizationScreen } from './src/screens/PersonalizationScreen';
import { ProfileScreen, ProfileStackParamList } from './src/screens/ProfileScreen';
import { StatsScreen } from './src/screens/StatsScreen';
import { TodayScreen } from './src/screens/TodayScreen';

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
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
    </>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({ SpaceGrotesk_700Bold });

  // Keep the splash visible until the display font is ready — titles must
  // never flash in the fallback font.
  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ProgressProvider>
          <ThemedApp />
        </ProgressProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
