import { View, Text, Pressable } from "react-native";
import type { Choice } from "@eg/engine";

interface ChoiceListProps {
  choices: Choice[];
  handleChoice: (choiceId: string) => void;
  styles: any;
}

export function ChoiceList({ choices, handleChoice, styles }: ChoiceListProps) {
  if (choices.length === 0) return null;

  return (
    <View style={styles.choicesContainer}>
      <Text style={styles.choicesTitle}>Choices:</Text>
      {choices.map((choice) => (
        <Pressable key={choice.id} style={styles.choiceButton} onPress={() => handleChoice(choice.id)}>
          <Text style={styles.choiceText}>{choice.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

