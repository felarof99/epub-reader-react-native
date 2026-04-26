import { ReaderProvider } from '@epubjs-react-native/core';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ReaderProvider>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: '#fff' },
              headerTintColor: '#111',
              contentStyle: { backgroundColor: '#fff' },
            }}
          />
        </ReaderProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
