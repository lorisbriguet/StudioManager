import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "react-error-boundary";
import { Toaster, toast } from "sonner";
import { ErrorFallback } from "./components/ErrorFallback";
import { MainLayout } from "./components/layout/MainLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { ClientsPage } from "./pages/ClientsPage";
import { ClientDetailPage } from "./pages/ClientDetailPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { TasksPage } from "./pages/TasksPage";
import { CalendarPage } from "./pages/CalendarPage";
import { InvoicesPage } from "./pages/InvoicesPage";
import { InvoiceFormPage } from "./pages/InvoiceFormPage";
import { QuotesPage } from "./pages/QuotesPage";
import { QuoteFormPage } from "./pages/QuoteFormPage";
import { ExpensesPage } from "./pages/ExpensesPage";
import { IncomePage } from "./pages/IncomePage";
import { FinancesPage } from "./pages/FinancesPage";
import { InvoicePreviewPage } from "./pages/InvoicePreviewPage";
import { QuotePreviewPage } from "./pages/QuotePreviewPage";
import { ResourcesPage } from "./pages/ResourcesPage";
import { WikiPage } from "./pages/WikiPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { CommandPalette } from "./components/CommandPalette";
import { QuickTimerModal } from "./components/QuickTimerModal";
import { useOverdueCheck } from "./hooks/useOverdueCheck";
import { useRecurringCheck } from "./hooks/useRecurringCheck";
import { useAutoBackup } from "./hooks/useAutoBackup";
import { useErrorNotifications } from "./hooks/useErrorNotifications";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useUndoStore } from "./stores/undo-store";
import { useAppStore } from "./stores/app-store";
import { logError } from "./lib/log";
import { requestNotificationPermission } from "./lib/nativeNotification";
import { useT } from "./i18n/useT";

import { queryClient } from "./lib/queryClient";
// Re-export so existing imports from "./App" still work
export { queryClient };

function StartupChecks() {
  useOverdueCheck();
  useRecurringCheck();
  useAutoBackup();
  useErrorNotifications();
  const t = useT();

  useEffect(() => {
    requestNotificationPermission();
  }, []);

  // Suppress native WebView context menu globally (Tauri renders its own).
  // Uses bubble phase so React onContextMenu handlers fire first (on #root),
  // then this catches any remaining right-clicks that weren't handled.
  // Allow native menu only on inputs/textareas where users need Copy/Paste.
  useEffect(() => {
    const suppress = (e: MouseEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const editable = (e.target as HTMLElement)?.isContentEditable;
      if (tag === "INPUT" || tag === "TEXTAREA" || editable) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", suppress);
    return () => document.removeEventListener("contextmenu", suppress);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "z") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const store = useUndoStore.getState();

      if (e.shiftKey) {
        // Redo: Cmd+Shift+Z
        const action = store.popRedo();
        if (action) {
          e.preventDefault();
          Promise.resolve(action.execute()).then(() => {
            // Push reverse (undo) back onto the undo stack without clearing redo
            if (action.redo) {
              store.stack.unshift({ label: action.label, execute: action.redo, redo: action.execute });
              useUndoStore.setState({ stack: store.stack.slice(0, 20) });
            }
            toast.success(`Redo: ${action.label}`);
          }).catch((err) => {
            logError("Redo failed:", err);
            toast.error(t.redo_failed);
          });
        }
      } else {
        // Undo: Cmd+Z
        const action = store.pop();
        if (action) {
          e.preventDefault();
          Promise.resolve(action.execute()).then(() => {
            if (action.redo) {
              store.pushRedo({ label: action.label, execute: action.redo, redo: action.execute });
            }
            if (action.redirectTo) {
              window.history.pushState({}, "", action.redirectTo);
              window.dispatchEvent(new PopStateEvent("popstate"));
            }
            toast.success(`Undo: ${action.label}`);
          }).catch((err) => {
            logError("Undo failed:", err);
            toast.error(t.undo_failed);
          });
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd+Shift+T — Quick Timer modal.
      // e.key is "T" (uppercase) when Shift is held, but guard both cases.
      // Must preventDefault before useTabSync's "reopen closed tab" fires.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "T" || e.key === "t")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        useAppStore.getState().toggleQuickTimer();
      }
    };
    // useCapture: true — fires before bubble-phase listeners (e.g. useTabSync)
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <StartupChecks />
      <BrowserRouter>
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <Routes>
            <Route element={<MainLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="clients" element={<ClientsPage />} />
              <Route path="clients/:id" element={<ClientDetailPage />} />
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="projects/:id" element={<ProjectDetailPage />} />
              <Route path="tasks" element={<TasksPage />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="invoices" element={<InvoicesPage />} />
              <Route path="invoices/new" element={<InvoiceFormPage />} />
              <Route path="invoices/:id/edit" element={<InvoiceFormPage />} />
              <Route path="invoices/:id/preview" element={<InvoicePreviewPage />} />
              <Route path="quotes" element={<QuotesPage />} />
              <Route path="quotes/new" element={<QuoteFormPage />} />
              <Route path="quotes/:id/edit" element={<QuoteFormPage />} />
              <Route path="quotes/:id/preview" element={<QuotePreviewPage />} />
              <Route path="expenses" element={<ExpensesPage />} />
              <Route path="income" element={<IncomePage />} />
              <Route path="finances" element={<FinancesPage />} />
              <Route path="wiki" element={<WikiPage />} />
              <Route path="resources" element={<ResourcesPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="profile" element={<ProfilePage />} />
            </Route>
          </Routes>
          <CommandPalette />
          <QuickTimerModal />
        </ErrorBoundary>
      </BrowserRouter>
      <Toaster position="bottom-right" />
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
    </QueryClientProvider>
  );
}
