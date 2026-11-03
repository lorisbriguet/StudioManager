import type { Connection, Machine, MachineFile } from "../../types/upkeep";

/**
 * Link schemes shown as remote buttons. Keep in sync with the Rust allow-list.
 * `jump` (Jump Desktop) is confirmed during the on-site check.
 */
export const REMOTE_SCHEMES = ["vnc", "jump"] as const;

export interface NetworkCard {
  machine: Machine;
  /** Its http(s) links, checked and listed with a status dot. */
  services: MachineFile[];
  /** Its remote-access links (vnc, jump). */
  remote: MachineFile[];
  /** The machine's NAS connection, when it has one. */
  nas: Connection | null;
}

const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;

/** Trimmed, with https:// added when there is no scheme ("dsm.local:5001" is a host and a port). */
export function linkUrl(raw: string): string {
  const u = raw.trim();
  return SCHEME.test(u) || /^(mailto|tel):/i.test(u) ? u : `https://${u}`;
}

function schemeOf(raw: string): string {
  return (SCHEME.exec(linkUrl(raw))?.[1] ?? "").toLowerCase();
}

export function isRemoteLink(raw: string): boolean {
  return (REMOTE_SCHEMES as readonly string[]).includes(schemeOf(raw));
}

function isWebLink(raw: string): boolean {
  const s = schemeOf(raw);
  return s === "http" || s === "https";
}

/** The pinned certificate fingerprint of a connection at the URL's host and port, if any. */
export function pinFor(url: string, connections: Connection[]): string | null {
  let parsed: URL;
  try {
    parsed = new URL(linkUrl(url));
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const port = Number(parsed.port || (parsed.protocol === "http:" ? 80 : 443));
  const hit = connections.find((c) => c.host?.toLowerCase() === host && c.port === port && c.cert_fingerprint);
  return hit?.cert_fingerprint ?? null;
}

/** One card per active machine that has a service, a remote link or a NAS connection, in the order given. */
export function buildNetworkCards(machines: Machine[], links: MachineFile[], connections: Connection[]): NetworkCard[] {
  const cards: NetworkCard[] = [];
  for (const machine of machines) {
    if (machine.status === "retired") continue;
    const own = links.filter((f) => f.machine_id === machine.id && f.kind === "link");
    const services = own.filter((f) => isWebLink(f.path_or_url));
    const remote = own.filter((f) => isRemoteLink(f.path_or_url));
    const nas = connections.find((c) => c.id === machine.connection_id && c.kind === "synology") ?? null;
    if (services.length || remote.length || nas) cards.push({ machine, services, remote, nas });
  }
  return cards;
}

/** The machine's first Screen Sharing link: its address is what the online check connects to. */
export function vncLink(card: NetworkCard): MachineFile | undefined {
  return card.remote.find((f) => schemeOf(f.path_or_url) === "vnc");
}
