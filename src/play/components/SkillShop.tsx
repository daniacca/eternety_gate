import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import type { Actor, GameSave } from "@eg/engine";
import { evaluatePrerequisites, loadCharacterCatalogs } from "@eg/engine";
import { sigilContentPack } from "@eg/content/src";
import skillsCatalog from "@eg/content/src/catalogs/skills.json";

type SkillDef = {
  id: string;
  name: string;
  baseStat: string;
};

const SKILL_TRAINING_COST = 50;

interface SkillShopProps {
  visible: boolean;
  save: GameSave;
  actor: Actor;
  onClose: () => void;
  onTrainSkill: (skillId: string, cost: number) => void;
}

export function SkillShop({ visible, save, actor, onClose, onTrainSkill }: SkillShopProps) {
  const skills = skillsCatalog as Array<SkillDef & { prerequisites?: any[] }>;
  const catalogs = loadCharacterCatalogs(sigilContentPack as any);
  const currentXp = actor?.resources?.xp ?? 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Skill Training</Text>
              <Text style={styles.subtitle}>{actor?.name}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.resourceBar}>
            <Text style={styles.resourceLabel}>XP:</Text>
            <Text style={styles.resourceValue}>{currentXp}</Text>
            <Text style={styles.costHint}>Cost per rank: {SKILL_TRAINING_COST} XP</Text>
          </View>

          <ScrollView contentContainerStyle={styles.listContent}>
            {skills.map((skill) => {
              const rank = actor?.skills?.[skill.id] ?? 0;
              const prerequisites = skill.prerequisites || [];
              const meetsPrereqs =
                prerequisites.length === 0 || evaluatePrerequisites(save, catalogs, actor, prerequisites).valid;
              const canTrain = currentXp >= SKILL_TRAINING_COST && meetsPrereqs;
              return (
                <View key={skill.id} style={styles.skillCard}>
                  <View style={styles.skillRow}>
                    <View style={styles.skillInfo}>
                      <Text style={styles.skillName}>{skill.name}</Text>
                      <Text style={styles.skillMeta}>
                        {skill.id} · Base {skill.baseStat}
                      </Text>
                    </View>
                    <View style={styles.rankBadge}>
                      <Text style={styles.rankText}>R{rank}</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={[styles.trainButton, !canTrain && styles.trainButtonDisabled]}
                    disabled={!canTrain}
                    onPress={() => onTrainSkill(skill.id, SKILL_TRAINING_COST)}
                  >
                    <Text style={[styles.trainText, !canTrain && styles.trainTextDisabled]}>Train (+1)</Text>
                  </TouchableOpacity>
                  {!meetsPrereqs && (
                    <Text style={styles.skillLockedText}>Prerequisites not met</Text>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    justifyContent: "center",
    alignItems: "center",
  },
  panel: {
    width: "94%",
    maxWidth: 700,
    height: "90%",
    backgroundColor: "#111827",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  header: {
    padding: 16,
    backgroundColor: "#0f172a",
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#f8fafc",
  },
  subtitle: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 4,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#1f2937",
    justifyContent: "center",
    alignItems: "center",
  },
  closeText: {
    color: "#f8fafc",
    fontSize: 20,
  },
  resourceBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#0b1220",
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  resourceLabel: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "600",
  },
  resourceValue: {
    color: "#facc15",
    fontSize: 16,
    fontWeight: "700",
  },
  costHint: {
    color: "#64748b",
    fontSize: 11,
    marginLeft: "auto",
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  skillCard: {
    backgroundColor: "#0f172a",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  skillRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  skillInfo: {
    flex: 1,
    marginRight: 12,
  },
  skillName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#e2e8f0",
  },
  skillMeta: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 4,
  },
  rankBadge: {
    backgroundColor: "#1e293b",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  rankText: {
    color: "#e2e8f0",
    fontWeight: "700",
    fontSize: 12,
  },
  trainButton: {
    marginTop: 12,
    backgroundColor: "#2563eb",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  trainButtonDisabled: {
    backgroundColor: "#334155",
  },
  trainText: {
    color: "#f8fafc",
    fontSize: 13,
    fontWeight: "700",
  },
  trainTextDisabled: {
    color: "#94a3b8",
  },
  skillLockedText: {
    marginTop: 6,
    fontSize: 11,
    color: "#f87171",
  },
});
