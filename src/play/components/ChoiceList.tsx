import { View, Text, Pressable } from "react-native";
import type { Choice } from "@eg/engine";

interface ChoiceListProps {
  choices: Choice[];
  handleChoice: (choiceId: string) => void;
  styles: any;
  disabled?: boolean;
}

const statLabels: Record<string, string> = {
  STR: "Forza",
  TOU: "Robustezza",
  AGI: "Agilità",
  INT: "Intelligenza",
  WIL: "Volontà",
  CHA: "Carisma",
  WS: "Abilità Armi",
  BS: "Balistica",
  INI: "Iniziativa",
  PER: "Percezione",
};

const titleCase = (value: string) =>
  value
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const formatKeyLabel = (key: string) => {
  if (statLabels[key]) return statLabels[key];
  if (key.startsWith("SKILL:")) {
    return titleCase(key.replace("SKILL:", ""));
  }
  return key;
};

const collectCheckKeys = (choice: Choice): string[] => {
  if (!choice.checks || choice.checks.length === 0) return [];
  const keys: string[] = [];
  for (const check of choice.checks) {
    switch (check.kind) {
      case "multi":
        for (const option of check.options) {
          keys.push(option.key);
        }
        break;
      case "sequence":
        for (const step of check.steps) {
          if ("key" in step && step.key) {
            keys.push(step.key);
          }
        }
        break;
      default:
        if ("key" in check && check.key) {
          keys.push(check.key);
        }
        break;
    }
  }
  return Array.from(new Set(keys));
};

export function ChoiceList({ choices, handleChoice, styles, disabled }: ChoiceListProps) {
  if (choices.length === 0) return null;

  return (
    <View style={styles.choicesContainer}>
      <Text style={styles.choicesTitle}>Choices:</Text>
      {choices.map((choice) => {
        const indicatorKeys = collectCheckKeys(choice);
        const indicatorLabel =
          indicatorKeys.length > 0 ? ` [${indicatorKeys.map(formatKeyLabel).join(" / ")}]` : "";
        return (
          <Pressable
            key={choice.id}
            style={[styles.choiceButton, disabled && styles.choiceButtonDisabled]}
            onPress={() => handleChoice(choice.id)}
            disabled={disabled}
          >
            <Text style={[styles.choiceText, disabled && styles.choiceTextDisabled]}>
              {choice.label}
              {indicatorLabel}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

