import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "Main Menu" }} />
      <Stack.Screen name="wizard" options={{ title: "New Game" }} />
      <Stack.Screen name="play" options={{ title: "Play" }} />
    </Stack>
  );
}

