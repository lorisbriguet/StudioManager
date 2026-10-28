import type { ComponentType } from "react";
import type { ConnectionKind } from "../../types/upkeep";

/**
 * Setup form of a connection kind, shown in the "Add connection" dialog. It
 * creates the connection (and its Keychain secret) itself, typically with
 * `useCreateConnection`, then calls `onDone`.
 */
export interface ConnectionFormProps {
  onDone: () => void;
  onCancel: () => void;
}

/** Tasks 13–14 register the Synology and Bambu Lab forms here. */
export const CONNECTION_FORMS: Partial<Record<ConnectionKind, ComponentType<ConnectionFormProps>>> = {};

export const CONNECTION_KINDS: ConnectionKind[] = ["synology", "bambu_cloud"];
