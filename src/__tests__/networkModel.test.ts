import { describe, it, expect } from "vitest";
import { uiLabels } from "../i18n/ui";
import { buildNetworkCards, isRemoteLink, linkUrl, pinFor } from "../lib/network/model";
import { formatAgo } from "../lib/network/format";
import type { Connection, Machine, MachineFile } from "../types/upkeep";

const t = uiLabels.EN;
const m = (id: number, extra: Partial<Machine> = {}) =>
  ({ id, name: `M${id}`, kind: "server", status: "working", connection_id: null, ...extra }) as Machine;
const l = (id: number, machine_id: number, path_or_url: string) =>
  ({ id, machine_id, label: `L${id}`, kind: "link", path_or_url }) as MachineFile;
const c = (id: number, extra: Partial<Connection> = {}) =>
  ({ id, kind: "synology", host: "nas.local", port: 5001, cert_fingerprint: "ab12", ...extra }) as Connection;

describe("network model", () => {
  it("formatAgo steps from just now to minutes, hours and days", () => {
    const now = 1_000_000_000_000;
    expect(formatAgo(now - 30_000, now, t)).toBe("just now");
    expect(formatAgo(now - 5 * 60_000, now, t)).toBe("5 min ago");
    expect(formatAgo(now - 3 * 3_600_000, now, t)).toBe("3 h ago");
    expect(formatAgo(now - 2 * 86_400_000, now, t)).toBe("2 d ago");
  });

  it("linkUrl adds https to bare hosts", () => {
    expect(linkUrl(" dsm.local:5001 ")).toBe("https://dsm.local:5001");
    expect(linkUrl("example.test")).toBe("https://example.test");
    expect(linkUrl("vnc://mini")).toBe("vnc://mini");
    expect(linkUrl("http://example.test/x")).toBe("http://example.test/x");
  });

  it("isRemoteLink recognises vnc and jump only", () => {
    expect(isRemoteLink("vnc://mini")).toBe(true);
    expect(isRemoteLink("jump://mini")).toBe(true);
    expect(isRemoteLink("https://example.test")).toBe(false);
    expect(isRemoteLink("smb://nas.local")).toBe(false);
    expect(isRemoteLink("nas.local")).toBe(false);
  });

  it("pinFor matches host and port, default 443", () => {
    const conns = [c(1), c(2, { host: "other.test", port: 443, cert_fingerprint: "ff" }), c(3, { host: "plain.test", port: 80, cert_fingerprint: "80" })];
    expect(pinFor("https://NAS.local:5001/x", conns)).toBe("ab12");
    expect(pinFor("https://nas.local/x", conns)).toBeNull();
    expect(pinFor("other.test", conns)).toBe("ff");
    expect(pinFor("http://plain.test", conns)).toBe("80");
    expect(pinFor("https://plain.test", conns)).toBeNull();
    expect(pinFor("https://unknown.test", conns)).toBeNull();
  });

  it("buildNetworkCards keeps machines with links or a NAS connection, in order, without retired ones", () => {
    const machines = [m(3, { connection_id: 1 }), m(1), m(2), m(4, { status: "retired" }), m(5)];
    const links = [l(1, 1, "https://a.test"), l(2, 4, "https://b.test"), l(3, 2, "https://c.test")];
    const cards = buildNetworkCards(machines, links, [c(1)]);
    expect(cards.map((x) => x.machine.id)).toEqual([3, 1, 2]);
    expect(cards[0].nas?.id).toBe(1);
    expect(cards[1].nas).toBeNull();
  });

  it("buildNetworkCards splits services and remote links", () => {
    const links = [l(1, 1, "https://a.test"), l(2, 1, "vnc://mini"), l(3, 1, "jump://mini"), l(4, 1, "smb://nas.local"), l(5, 1, "b.test")];
    const [card] = buildNetworkCards([m(1)], links, []);
    expect(card.services.map((f) => f.id)).toEqual([1, 5]);
    expect(card.remote.map((f) => f.id)).toEqual([2, 3]);
  });
});
