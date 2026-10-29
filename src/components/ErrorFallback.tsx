import { useEffect } from "react";
import type { FallbackProps } from "react-error-boundary";
import { useT } from "../i18n/useT";
import { logError } from "../lib/log";
import { Button } from "./ui/Button";
import { ICONS } from "./ui/icons";
import { EmptyState } from "./ui/EmptyState";

/**
 * What an error boundary shows. The error goes to the log, never on screen.
 * See DESIGN-SYSTEM.md, "Empty, loading and error states".
 *
 *   <ErrorBoundary FallbackComponent={ErrorFallback} resetKeys={[pathname]}>   a page (MainLayout)
 *   <ErrorBoundary FallbackComponent={WidgetErrorFallback}>                     a dashboard widget
 */
function useLogged(error: unknown, where: string) {
  useEffect(() => {
    const e = error as Error | undefined;
    void logError(`[${where}] ${e?.message ?? String(error)}`, e?.stack ?? "");
  }, [error, where]);
}

export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const t = useT();
  useLogged(error, "page");
  return (
    <EmptyState
      tone="danger"
      icon={ICONS.warning}
      message={t.page_error_title}
      hint={t.page_error_description}
      action={<Button onClick={resetErrorBoundary}>{t.retry}</Button>}
      className="flex-1 min-h-[200px]"
    />
  );
}

export function WidgetErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const t = useT();
  useLogged(error, "widget");
  return (
    <EmptyState
      size="sm"
      tone="danger"
      icon={ICONS.warning}
      message={t.widget_error}
      action={
        <Button variant="secondary" onClick={resetErrorBoundary}>
          {t.retry}
        </Button>
      }
      className="h-full"
    />
  );
}
