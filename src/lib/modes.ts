import { invoke } from "@tauri-apps/api/core";
import { switchDb, seedPresentationDb } from "../db";
import { useAppStore } from "../stores/app-store";

export async function enterTestMode(): Promise<void> {
  await invoke<string>("enter_test_mode");
  await switchDb("studiomanager_test.db");
  useAppStore.getState().setTestMode(true);
}

export async function exitTestMode(): Promise<void> {
  await invoke("exit_test_mode");
  await switchDb("studiomanager.db");
  useAppStore.getState().setTestMode(false);
}

export async function enterPresentationMode(): Promise<void> {
  await invoke<string>("enter_presentation_mode");
  await switchDb("studiomanager_presentation.db");
  await seedPresentationDb();
  useAppStore.getState().setPresentationMode(true);
}

export async function exitPresentationMode(): Promise<void> {
  await invoke("exit_presentation_mode");
  await switchDb("studiomanager.db");
  useAppStore.getState().setPresentationMode(false);
}
