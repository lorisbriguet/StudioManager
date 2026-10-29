import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { useT } from "../../i18n/useT";
import { createSim, layoutGraph, placeLabels, type Point, type Sim, type SimNode } from "../../lib/wikiGraph";
import { colorFor } from "./wikiColors";
import { IconButton, ICONS } from "../ui";

export interface GraphNodeInput {
  id: number;
  title: string;
  project_id: number | null;
  project_name?: string;
  /** A project file: drawn as a ring, not a disc. */
  file?: boolean;
}

/** The part of the graph in view, in graph units. */
export interface GraphBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Box = GraphBox;

/** Label size on screen, in pixels, whatever the zoom. */
const LABEL_PX = 11;
const FOCUS_LABEL_PX = 12;
/** Below this many graph units per screen pixel (zoomed in), every label may show. */
const ALL_LABELS_AT = 0.9;
// Drag motion, as in the Art Basel hub: lively while a dot is held, then it cools.
const ALPHA_HELD = 0.35;
const ALPHA_WAKE = 0.3;
const ALPHA_COOL = 0.955;
const ALPHA_REST = 0.004;

function radiusOf(degree: number): number {
  return 5 + Math.sqrt(degree) * 2.2;
}

function bounds(positions: Map<number, Point>, margin: number): Box {
  const pts = [...positions.values()];
  if (pts.length === 0) return { x: -margin, y: -margin, w: 2 * margin, h: 2 * margin };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0 - margin, y: y0 - margin, w: Math.max(...xs) - x0 + 2 * margin, h: Math.max(...ys) - y0 + 2 * margin };
}

/**
 * Articles as dots, links as lines. Drag a dot and its neighbours follow
 * while the rest makes way; drag the background to pan, scroll to zoom
 * (not in `compact`, the side panel's local graph). Labels keep their size
 * on screen at any zoom, and one that would cover another is left out.
 */
export function GraphView({
  nodes,
  edges,
  colors,
  focusId = null,
  compact = false,
  alwaysLabels = false,
  onOpen,
  label,
  initialView = null,
  onViewChange,
  reserveRight = 0,
}: {
  nodes: GraphNodeInput[];
  edges: [number, number][];
  colors: Map<number, string>;
  focusId?: number | null;
  compact?: boolean;
  alwaysLabels?: boolean;
  onOpen: (id: number, newTab: boolean) => void;
  label: string;
  /** Zoom and pan to start from (null: fit everything). */
  initialView?: GraphBox | null;
  /** Called when the zoom or pan changes, to restore it later. */
  onViewChange?: (view: GraphBox | null) => void;
  /** Pixels on the right covered by an overlay: fitting keeps dots out of them. */
  reserveRight?: number;
}) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hot, setHot] = useState<number | null>(null);
  const [view, setView] = useState<Box | null>(initialView);
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  useEffect(() => {
    onViewChangeRef.current?.(view);
  }, [view]);
  // Keyboard: the graph is one tab stop; arrow keys move between dots.
  const [keyId, setKeyId] = useState<number | null>(null);
  const nodeEls = useRef(new Map<number, SVGGElement>());
  const [px, setPx] = useState<{ w: number; h: number } | null>(null);
  const [, setFrame] = useState(0);

  const degree = useMemo(() => {
    const d = new Map<number, number>();
    for (const [a, b] of edges) {
      d.set(a, (d.get(a) ?? 0) + 1);
      d.set(b, (d.get(b) ?? 0) + 1);
    }
    return d;
  }, [edges]);

  const simNodes: SimNode[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        cluster: n.project_id != null ? `p:${n.project_id}` : "none",
        radius: radiusOf(degree.get(n.id) ?? 0),
      })),
    [nodes, degree]
  );

  // Settled layout. A change of graph starts from the last positions, so
  // the dots that stay keep their place.
  const positionsRef = useRef<Map<number, Point>>(new Map());
  const layoutKey = useMemo(
    () => simNodes.map((n) => `${n.id}:${n.cluster}`).join(",") + "|" + edges.map((e) => e.join("-")).join(","),
    [simNodes, edges]
  );
  const laid = useMemo(() => {
    const p = layoutGraph(simNodes, edges, positionsRef.current);
    positionsRef.current = p;
    return p;
    // layoutKey captures exactly the inputs that change the layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);
  // Fit the dots into the part of the view that `reserveRight` leaves free
  // (the graph settings panel floats over the right edge).
  const fit = useMemo(() => {
    const b = bounds(laid, compact ? 50 : 80);
    const free = px ? px.w - reserveRight : 0;
    if (!px || reserveRight <= 0 || free < 160) return b;
    const s = Math.max(b.w / free, b.h / px.h);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    return { x: cx - (free / 2) * s, y: cy - (px.h / 2) * s, w: px.w * s, h: px.h * s };
  }, [laid, compact, px, reserveRight]);

  // A new graph: drop the live simulation and refit.
  const live = useRef<{ sim: Sim; alpha: number; raf: number } | null>(null);
  // The first layout keeps `initialView`; a later change of graph refits.
  // (Compared by identity, so StrictMode's second effect run keeps it too.)
  const firstLaid = useRef(laid);
  useEffect(() => {
    if (laid !== firstLaid.current) setView(null);
    return () => {
      if (live.current?.raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(live.current.raf);
      live.current = null;
    };
  }, [laid]);

  const box = view ?? fit;
  // Graph units per screen pixel (1 in tests, where nothing has a size).
  const scale = px ? Math.max(box.w / px.w, box.h / px.h) : 1;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setPx({ w: width, h: height });
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  const toGraph = useCallback((clientX: number, clientY: number, b: Box, rect?: DOMRect): Point | null => {
    const r = rect ?? svgRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return null;
    const s = Math.max(b.w / r.width, b.h / r.height);
    return { x: b.x + b.w / 2 + (clientX - r.left - r.width / 2) * s, y: b.y + b.h / 2 + (clientY - r.top - r.height / 2) * s };
  }, []);

  const zoomAt = useCallback(
    (factor: number, at?: Point) => {
      const b = view ?? fit;
      const c = at ?? { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      const w = Math.min(fit.w * 4, Math.max(80, b.w * factor));
      const ratio = w / b.w;
      setView({ x: c.x - (c.x - b.x) * ratio, y: c.y - (c.y - b.y) * ratio, w, h: b.h * ratio });
    },
    [view, fit]
  );

  // Wheel zoom around the pointer (non-passive so the page doesn't scroll).
  useEffect(() => {
    const svg = svgRef.current;
    if (compact || !svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toGraph(e.clientX, e.clientY, view ?? fit);
      if (p) zoomAt(Math.exp(e.deltaY * 0.0015), p);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [compact, toGraph, zoomAt, view, fit]);

  const drag = useRef<{ id?: number; from: Point; moved: boolean; view: Box; rect?: DOMRect } | null>(null);

  /** Holds a dot at the pointer and wakes the graph, a frame at a time,
   *  until it is released and everything has settled again. */
  const hold = (id: number, p: Point) => {
    if (!live.current) live.current = { sim: createSim(simNodes, edges, positionsRef.current), alpha: 0, raf: 0 };
    const l = live.current;
    l.sim.fix(id, p);
    const calm =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (calm || typeof requestAnimationFrame !== "function") {
      l.sim.tick(0);
      positionsRef.current = l.sim.positions();
      setFrame((f) => f + 1);
      return;
    }
    if (l.alpha > ALPHA_REST) return; // already running: the loop sees the new position
    l.alpha = ALPHA_REST * 2;
    const frame = () => {
      const cur = live.current;
      if (!cur) return;
      cur.sim.tick(cur.alpha);
      const holding = drag.current?.id !== undefined && drag.current.moved;
      cur.alpha = holding ? cur.alpha + (ALPHA_HELD - cur.alpha) * ALPHA_WAKE : cur.alpha * ALPHA_COOL;
      positionsRef.current = cur.sim.positions();
      setFrame((f) => f + 1);
      if (cur.alpha > ALPHA_REST) cur.raf = requestAnimationFrame(frame);
      else cur.alpha = 0;
    };
    l.raf = requestAnimationFrame(frame);
  };

  const onPointerDown = (e: React.PointerEvent, id?: number) => {
    if (e.button !== 0) return;
    const rect = svgRef.current?.getBoundingClientRect();
    const from = toGraph(e.clientX, e.clientY, box, rect);
    if (!from) return;
    drag.current = { id, from, moved: false, view: box, rect };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    e.stopPropagation();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toGraph(e.clientX, e.clientY, d.view, d.rect);
    if (!p) return;
    if (!d.moved && Math.hypot(p.x - d.from.x, p.y - d.from.y) < 3 * scale) return;
    d.moved = true;
    if (d.id !== undefined) hold(d.id, p);
    else if (!compact) setView({ ...d.view, x: d.view.x - (p.x - d.from.x), y: d.view.y - (p.y - d.from.y) });
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (d?.id !== undefined && d.moved) live.current?.sim.fix(d.id, undefined);
    // Keep `moved` readable by the click that follows, then forget the drag.
    setTimeout(() => {
      if (drag.current === d) drag.current = null;
    }, 0);
  };

  const positions = positionsRef.current;
  const neighbours = useMemo(() => {
    if (hot == null) return null;
    const set = new Set([hot]);
    for (const [a, b] of edges) {
      if (a === hot) set.add(b);
      if (b === hot) set.add(a);
    }
    return set;
  }, [hot, edges]);

  const labelSize = (id: number) => (id === focusId ? FOCUS_LABEL_PX : LABEL_PX) * scale;
  const shownLabels = placeLabels(
    nodes.flatMap((n) => {
      const p = positions.get(n.id);
      if (!p) return [];
      const deg = degree.get(n.id) ?? 0;
      const near = neighbours?.has(n.id) ?? false;
      const isFocus = n.id === focusId || n.id === hot;
      const hub = deg >= 5;
      if (!compact && !alwaysLabels && !isFocus && !near && !hub && scale > ALL_LABELS_AT) return [];
      const size = labelSize(n.id);
      return [
        {
          id: n.id,
          x: p.x,
          y: p.y + radiusOf(deg) + size + 2 * scale,
          text: n.title,
          size,
          priority: (near ? 50 : 0) + deg,
          force: isFocus,
        },
      ];
    })
  );

  // Arrow keys walk the dots in title order; only one dot is a tab stop.
  const keyOrder = useMemo(() => [...nodes].sort((a, b) => a.title.localeCompare(b.title)).map((n) => n.id), [nodes]);
  const tabStop =
    keyId != null && keyOrder.includes(keyId) ? keyId : focusId != null && keyOrder.includes(focusId) ? focusId : keyOrder[0];
  const moveKey = (from: number, step: number) => {
    const i = keyOrder.indexOf(from);
    const next = keyOrder[(i + step + keyOrder.length) % keyOrder.length];
    setKeyId(next);
    nodeEls.current.get(next)?.focus();
  };

  return (
    <div className="relative w-full h-full">
      <svg
        ref={svgRef}
        role="group"
        aria-label={label}
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        preserveAspectRatio="xMidYMid meet"
        className={`w-full h-full select-none touch-none ${compact ? "" : "cursor-grab active:cursor-grabbing"}`}
        onPointerDown={(e) => onPointerDown(e)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {edges.map(([a, b]) => {
          const p = positions.get(a);
          const q = positions.get(b);
          if (!p || !q) return null;
          const lit = neighbours != null && (a === hot || b === hot);
          return (
            <line
              key={`${a}-${b}`}
              x1={p.x}
              y1={p.y}
              x2={q.x}
              y2={q.y}
              style={{
                stroke: lit ? "var(--color-accent)" : "var(--color-border)",
                strokeWidth: (lit ? 1.6 : 1) * scale,
                opacity: neighbours && !lit ? 0.35 : 1,
              }}
            />
          );
        })}
        {nodes.map((n) => {
          const p = positions.get(n.id);
          if (!p) return null;
          const deg = degree.get(n.id) ?? 0;
          const r = radiusOf(deg);
          const lit = !neighbours || neighbours.has(n.id);
          const size = labelSize(n.id);
          return (
            <g
              key={n.id}
              ref={(el) => {
                if (el) nodeEls.current.set(n.id, el);
                else nodeEls.current.delete(n.id);
              }}
              role="button"
              tabIndex={n.id === tabStop ? 0 : -1}
              aria-label={n.project_name ? `${n.title}, ${n.project_name}` : n.title}
              className="cursor-pointer outline-none"
              onPointerEnter={() => setHot(n.id)}
              onPointerLeave={() => {
                if (!drag.current?.moved) setHot(null);
              }}
              onPointerDown={(e) => onPointerDown(e, n.id)}
              onFocus={() => {
                setHot(n.id);
                setKeyId(n.id);
              }}
              onBlur={() => setHot(null)}
              onClick={(e) => {
                if (drag.current?.moved) return;
                onOpen(n.id, e.metaKey || e.ctrlKey);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(n.id, e.metaKey || e.ctrlKey);
                } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  moveKey(n.id, 1);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  moveKey(n.id, -1);
                }
              }}
            >
              <circle
                cx={p.x}
                cy={p.y}
                r={n.id === focusId ? r + 2 : r}
                style={
                  n.file
                    ? {
                        fill: "var(--color-bg)",
                        opacity: lit ? 1 : 0.25,
                        stroke: n.id === focusId || n.id === hot ? "var(--color-text)" : colorFor(colors, n.project_id),
                        strokeWidth: 2 * scale,
                      }
                    : {
                        fill: colorFor(colors, n.project_id),
                        opacity: lit ? 1 : 0.25,
                        stroke: n.id === focusId || n.id === hot ? "var(--color-text)" : "none",
                        strokeWidth: 1.5 * scale,
                      }
                }
              />
              {shownLabels.has(n.id) && (
                <text
                  x={p.x}
                  y={p.y + r + size + 2 * scale}
                  textAnchor="middle"
                  style={{
                    fontSize: size,
                    fontWeight: n.id === focusId ? 600 : 400,
                    fill: lit ? "var(--color-text)" : "var(--color-muted)",
                    opacity: lit ? 1 : 0.5,
                    // A halo in the background colour keeps text readable over lines.
                    stroke: "var(--color-bg)",
                    strokeWidth: 3 * scale,
                    paintOrder: "stroke",
                    pointerEvents: "none",
                  }}
                >
                  {n.title}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {!compact && (
        <div className="absolute left-4 bottom-4 flex gap-0.5 p-0.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          <IconButton icon={ZoomIn} label={t.wiki_graph_zoom_in} onClick={() => zoomAt(0.8)} />
          <IconButton icon={ZoomOut} label={t.wiki_graph_zoom_out} onClick={() => zoomAt(1.25)} />
          <IconButton icon={ICONS.fit} label={t.wiki_graph_fit} onClick={() => setView(null)} />
        </div>
      )}
    </div>
  );
}
