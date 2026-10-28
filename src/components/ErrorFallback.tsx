import type { FallbackProps } from "react-error-boundary";
import { useT } from "../i18n/useT";
import { Button } from "./ui/Button";

export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center min-h-[200px] p-8 text-center">
      <h2 className="text-sm font-medium mb-2">{t.page_error_title}</h2>
      <p className="text-xs text-muted mb-4 max-w-md">
        {(error as Error)?.message || t.page_error_description}
      </p>
      <Button variant="primary" onClick={resetErrorBoundary}>
        {t.retry}
      </Button>
    </div>
  );
}
