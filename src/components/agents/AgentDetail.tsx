import { useEffect, useRef, useState } from "react";
import { ArrowUp, ImagePlus } from "lucide-react";
import { readFile } from "@tauri-apps/plugin-fs";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { dismissAgent, deleteAgent, saveImage, sendMessage, stopAgent, switchModel, type Agent } from "../../lib/agents";
import { useT } from "../../i18n/useT";
import { Badge, Button, HEADING_2, ICONS, IconButton, PANEL_TOP_BAR, Textarea } from "../ui";
import { useConfirm } from "../../lib/confirm";
import { agentLabel, GROUP_LABEL_KEYS, GROUP_STYLE } from "./AgentList";
import { agentGroupVariant } from "../../lib/statusColors";
import { Conversation } from "./Conversation";
import { PromptAnswer } from "./PromptAnswer";
import { MODELS, ModelMenu } from "./ModelMenu";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

/** The image type of a dropped file's path, or null for anything else. */
export function imageTypeOf(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXT[ext] ?? null;
}

/** Appends text to a draft, separated by a space unless the draft ends with whitespace. */
export function appendToDraft(draft: string, text: string): string {
  if (!draft) return text;
  return /\s$/.test(draft) ? draft + text : `${draft} ${text}`;
}

interface Attachment {
  file: File;
  url: string;
}

/** The file's bytes as base64 (no data: prefix). */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",", 2)[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

interface AgentDetailProps {
  agent: Agent;
  onOpenTerminal: (shortId: string) => void;
  /** Called after the agent was deleted. */
  onDeleted?: () => void;
  /** Called with the short id of the new agent after a model switch. */
  onSwitched?: (shortId: string) => void;
}

export function AgentDetail({ agent, onOpenTerminal, onDeleted, onSwitched }: AgentDetailProps) {
  const t = useT();
  const confirm = useConfirm();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<Attachment[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const background = agent.kind === "background";
  const canSend = background && agent.status !== "waiting";
  const imagesRef = useRef(images);
  imagesRef.current = images;

  // Attachments belong to one agent's draft; free their previews when it changes or unmounts.
  useEffect(() => {
    setImages([]);
    return () => imagesRef.current.forEach((a) => URL.revokeObjectURL(a.url));
  }, [agent.sessionId]);

  const addImages = (files: Iterable<File>) => {
    const next: Attachment[] = [];
    for (const file of files) {
      if (!IMAGE_TYPES.includes(file.type)) {
        setError(t.agents_image_type);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError(t.agents_image_size);
        continue;
      }
      next.push({ file, url: URL.createObjectURL(file) });
    }
    if (next.length) setImages((cur) => [...cur, ...next]);
  };

  // Files dropped on the window arrive as paths (Tauri's native drop). Images are attached;
  // any other file is pasted into the draft as its path.
  const [dragging, setDragging] = useState(false);
  const dropRef = useRef<(paths: string[]) => void>(() => {});
  dropRef.current = async (paths) => {
    const others: string[] = [];
    const files: File[] = [];
    for (const path of paths) {
      const type = imageTypeOf(path);
      if (!type) {
        others.push(path);
        continue;
      }
      try {
        const bytes = await readFile(path);
        files.push(new File([bytes], path.split("/").pop() ?? "image", { type }));
      } catch {
        // Not readable from here: hand the agent the path instead.
        others.push(path);
      }
    }
    if (files.length) addImages(files);
    if (others.length) setText((cur) => appendToDraft(cur, others.join(" ")));
  };
  useEffect(() => {
    if (!canSend) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (cancelled) return;
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") setDragging(true);
        else if (p.type === "leave") setDragging(false);
        else if (p.type === "drop") {
          setDragging(false);
          if (p.paths.length) void dropRef.current(p.paths);
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      setDragging(false);
      unlisten?.();
    };
  }, [canSend]);

  const removeImage = (url: string) => {
    URL.revokeObjectURL(url);
    setImages((cur) => cur.filter((a) => a.url !== url));
  };

  const shortId = agent.shortId;
  const knownModel = MODELS.includes(agent.model ?? "");

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(String(e));
    }
  };

  const send = async () => {
    const typed = text.trim();
    if ((!typed && images.length === 0) || !canSend || sending) return;
    setSending(true);
    setError(null);
    try {
      // Each image is saved on this Mac and named by its path, so the agent can open it.
      const paths = await Promise.all(images.map(async (a) => saveImage(a.file.type, await toBase64(a.file))));
      await sendMessage(agent.sessionId, [typed, ...paths].filter(Boolean).join("\n\n"));
      setText("");
      images.forEach((a) => URL.revokeObjectURL(a.url));
      setImages([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  };

  const stop = async () => {
    if (!shortId || !(await confirm({ title: t.agents_stop_confirm, confirmLabel: t.agents_stop, tone: "danger" }))) return;
    await run(() => stopAgent(shortId));
  };

  const remove = async () => {
    if (!shortId || !(await confirm({ title: t.agents_delete_confirm, confirmLabel: t.agents_delete, tone: "danger" }))) return;
    await run(async () => {
      await deleteAgent(shortId);
      onDeleted?.();
    });
  };

  const disabledReason = !background
    ? t.agents_message_disabled_interactive
    : agent.status === "waiting"
      ? t.agents_message_disabled_waiting
      : null;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className={`${PANEL_TOP_BAR} gap-2 px-5 border-[var(--color-border)]`}>
        <h2 className={`${HEADING_2} truncate`}>{agent.name}</h2>
        <Badge variant={agentGroupVariant(agent.group)} className="shrink-0 gap-1.5">
          <span className={`dot ${GROUP_STYLE[agent.group].dot}`} aria-hidden />
          {t[GROUP_LABEL_KEYS[agent.group]]}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" disabled={!shortId} onClick={() => void stop()}>
            {t.agents_stop}
          </Button>
          <Button variant="danger" disabled={!shortId} onClick={() => void remove()}>
            {t.agents_delete}
          </Button>
          {agent.group === "needs-you" && (
            <Button variant="outline" onClick={() => void run(() => dismissAgent(agent.sessionId))}>
              {t.agents_dismiss}
            </Button>
          )}
          {shortId && (
            <Button variant="outline" onClick={() => onOpenTerminal(shortId)}>
              {t.agents_open_terminal}
            </Button>
          )}
          {background && (
            <ModelMenu
              label={t.agents_model}
              value={knownModel ? (agent.model as string) : null}
              currentLabel={agent.modelLabel}
              onChange={(m) =>
                void run(async () => {
                  const next = await switchModel(agent.sessionId, m);
                  onSwitched?.(next);
                })
              }
            />
          )}
        </div>
      </div>
      <div className="px-5 pt-3 text-xs text-muted">{agentLabel(agent)}</div>

      {error && (
        <p role="alert" className="px-5 pt-3 text-sm text-[var(--color-danger-text)]">
          {error}
        </p>
      )}

      {agent.group === "needs-you" && background && shortId && (
        <div className="px-5 pt-3">
          <PromptAnswer shortId={shortId} onOpenTerminal={onOpenTerminal} />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        <Conversation sessionId={agent.sessionId} working={agent.group === "working"} />
      </div>

      <div className="max-w-3xl w-full mx-auto space-y-1.5 px-5 pb-5">
        <div
          className={`rounded-xl border bg-[var(--color-input-bg)] px-2 py-2 focus-within:border-[var(--color-accent)] ${
            dragging ? "border-[var(--color-accent)]" : "border-[var(--color-input-border)]"
          }`}
        >
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 px-2 pb-2">
              {images.map((a) => (
                <div key={a.url} className="relative group">
                  <img src={a.url} alt={a.file.name} className="size-14 rounded-lg object-cover border border-[var(--color-input-border)]" />
                  <IconButton
                    icon={ICONS.close}
                    label={t.agents_remove_image}
                    size="xs"
                    onClick={() => removeImage(a.url)}
                    className="absolute! -top-1.5 -right-1.5 rounded-full! bg-[var(--color-surface)] border border-[var(--color-input-border)]"
                  />
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-1.5">
          <IconButton
            icon={ImagePlus}
            label={t.agents_attach_image}
            disabled={!canSend}
            onClick={() => fileInput.current?.click()}
            className="shrink-0 mb-0.5"
          />
          <input
            ref={fileInput}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addImages(e.target.files);
              e.target.value = "";
            }}
          />
          <Textarea
            variant="bare"
            value={text}
            rows={1}
            maxRows={8}
            maxLength={20000}
            disabled={!canSend}
            placeholder={t.agents_message_placeholder}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
              if (files.length) {
                e.preventDefault();
                addImages(files);
              }
            }}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter adds a line (IME composition left alone).
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            fullWidth={false}
            className="flex-1 border-0! bg-transparent! disabled:cursor-not-allowed"
          />
          <Button
            className="shrink-0 justify-center"
            aria-label={t.agents_send}
            icon={ArrowUp}
            loading={sending}
            disabled={!canSend || (text.trim() === "" && images.length === 0)}
            onClick={() => void send()}
          />
          </div>
        </div>
        {disabledReason && <p className="text-xs text-muted text-center">{disabledReason}</p>}
      </div>
    </div>
  );
}
