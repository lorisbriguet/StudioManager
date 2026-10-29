import { Toaster as SonnerToaster } from "sonner";
import { useAppStore } from "../../stores/app-store";
import { Spinner } from "./Spinner";
import { SURFACE } from "./tokens";

/**
 * The app's one toast host, mounted once in App. Toasts are shown with
 * `notify` (src/lib/notify.ts), never with sonner directly.
 *
 * A SURFACE card (surface fill, header border, rounded-xl, menu shadow),
 * 14px text, a coloured dot for the kind (spinner while loading), and the
 * action (Undo, Details) as an accent link on the right.
 */
export function Toaster() {
  const dark = useAppStore((s) => s.darkMode);
  return (
    <SonnerToaster
      position="bottom-right"
      theme={dark ? "dark" : "light"}
      gap={8}
      icons={{
        success: <span className="dot bg-success" />,
        info: <span className="dot bg-accent" />,
        warning: <span className="dot bg-warning" />,
        error: <span className="dot bg-danger" />,
        loading: <Spinner size={14} />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: `${SURFACE} shadow-menu flex items-center gap-2.5 w-[var(--width)] px-3.5 py-2.5 text-sm text-[var(--color-text)]`,
          icon: "flex items-center justify-center shrink-0 w-3.5 h-3.5",
          content: "flex-1 min-w-0",
          title: "leading-5",
          description: "text-xs text-muted leading-4 mt-0.5",
          actionButton: "shrink-0 text-sm font-medium text-accent-text hover:underline cursor-pointer",
          cancelButton: "shrink-0 text-sm text-muted hover:text-[var(--color-text)] cursor-pointer",
        },
      }}
    />
  );
}
