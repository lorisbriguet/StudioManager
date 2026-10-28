import type { ComponentType } from "react";
import type { Connection, ConnectionKind } from "../../types/upkeep";
import { SynologyForm } from "./SynologyForm";

/**
 * Setup form of a connection kind, shown in the "Add connection" dialog. It
 * creates the connection (and its Keychain secret) itself, typically with
 * `useCreateConnection`, then calls `onDone`.
 */
export interface ConnectionFormProps {
  onDone: () => void;
  onCancel: () => void;
  /**
   * Reconnect this existing connection (same id, so machine links keep
   * working) instead of creating one: re-trust a changed certificate, type a
   * new 2-step code or password. Closing never removes it.
   */
  connection?: Connection;
}

/** Setup form per kind. Task 14 registers the Bambu Lab form here. */
export const CONNECTION_FORMS: Partial<Record<ConnectionKind, ComponentType<ConnectionFormProps>>> = {
  synology: SynologyForm,
};

export const CONNECTION_KINDS: ConnectionKind[] = ["synology", "bambu_cloud"];
