import { View, Text, StyleSheet } from 'react-native';
import { createNewGame, getCurrentScene, listAvailableChoices } from '@eg/engine';

export default function PlayScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Play Screen</Text>
      <Text style={styles.subtitle}>Engine loaded: Yes</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
});

