import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { GameSave } from "@eg/engine";

export type SaveSlot = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  save: GameSave;
};

const STORAGE_KEY = "eg:saves:v1";

type StorageAdapter = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const webStorageAdapter: StorageAdapter = {
  getItem: async (key) => {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  },
  setItem: async (key, value) => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  },
  removeItem: async (key) => {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(key);
  },
};

const storage: StorageAdapter = Platform.OS === "web" ? webStorageAdapter : AsyncStorage;

const parseSlots = (raw: string | null): SaveSlot[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SaveSlot[]) : [];
  } catch {
    return [];
  }
};

export const loadSaveSlots = async (): Promise<SaveSlot[]> => {
  const raw = await storage.getItem(STORAGE_KEY);
  return parseSlots(raw);
};

const writeSaveSlots = async (slots: SaveSlot[]): Promise<void> => {
  await storage.setItem(STORAGE_KEY, JSON.stringify(slots));
};

export const upsertSaveSlot = async (slot: SaveSlot): Promise<SaveSlot[]> => {
  const slots = await loadSaveSlots();
  const index = slots.findIndex((entry) => entry.id === slot.id);
  const updatedSlot = { ...slot, updatedAt: new Date().toISOString() };
  if (index >= 0) {
    const next = [...slots];
    next[index] = updatedSlot;
    await writeSaveSlots(next);
    return next;
  }
  const next = [updatedSlot, ...slots];
  await writeSaveSlots(next);
  return next;
};

export const deleteSaveSlot = async (slotId: string): Promise<SaveSlot[]> => {
  const slots = await loadSaveSlots();
  const next = slots.filter((entry) => entry.id !== slotId);
  await writeSaveSlots(next);
  return next;
};

export const getSaveSlot = async (slotId: string): Promise<SaveSlot | null> => {
  const slots = await loadSaveSlots();
  return slots.find((entry) => entry.id === slotId) ?? null;
};

export const resetAllSaveSlots = async (): Promise<void> => {
  await storage.removeItem(STORAGE_KEY);
};
