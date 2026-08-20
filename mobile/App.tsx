import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ProgressProvider } from './src/context/ProgressContext';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { StatsScreen } from './src/screens/StatsScreen';
import { TodayScreen } from './src/screens/TodayScreen';
import { colors } from './src/theme';

const Tab = createBottomTabNavigator();

function tabIcon(emoji: string) {
  return ({ focused }: { focused: boolean }) => (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ProgressProvider>
        <NavigationContainer>
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
              options={{ tabBarIcon: tabIcon('☀️') }}
            />
            <Tab.Screen
              name="History"
              component={HistoryScreen}
              options={{ tabBarIcon: tabIcon('📚') }}
            />
            <Tab.Screen
              name="Stats"
              component={StatsScreen}
              options={{ tabBarIcon: tabIcon('📈') }}
            />
          </Tab.Navigator>
        </NavigationContainer>
        <StatusBar style="dark" />
      </ProgressProvider>
    </SafeAreaProvider>
  );
}
