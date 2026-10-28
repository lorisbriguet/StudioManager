import type { ComponentType } from "react";
import type { ConnectionKind } from "../../types/upkeep";
import { SynologyForm } from "./SynologyForm";

/**
 * Setup form of a connection kind, shown in the "Add connection" dialog. It
 * creates the connection (and its Keychain secret) itself, typically with
 * `useCreateConnection`, then calls `onDone`.
 */
export interface ConnectionFormProps {
  onDone: () => void;
  onCancel: () => void;
}

/** Setup form per kind. Task 14 registers the Bambu Lab form here. */
export const CONNECTION_FORMS: Partial<Record<ConnectionKind, ComponentType<ConnectionFormProps>>> = {
  synology: SynologyForm,
};

export const CONNECTION_KINDS: ConnectionKind[] = ["synology", "bambu_cloud"];
