import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
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
import { FinancesPage } from "./pages/FinancesPage";
import { InvoicePreviewPage } from "./pages/InvoicePreviewPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { CommandPalette } from "./components/CommandPalette";
import { useOverdueCheck } from "./hooks/useOverdueCheck";
import { useAutoBackup } from "./hooks/useAutoBackup";
import { useErrorNotifications } from "./hooks/useErrorNotifications";
import { useUndoStore } from "./stores/undo-store";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

function StartupChecks() {
  useOverdueCheck();
  useAutoBackup();
  useErrorNotifications();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        // Don't intercept if user is typing in an input
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

        const action = useUndoStore.getState().pop();
        if (action) {
          e.preventDefault();
          Promise.resolve(action.execute()).then(() => {
            toast.success(`Undo: ${action.label}`);
          }).catch((e) => {
            console.error("Undo failed:", e);
            toast.error("Undo failed");
          });
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <StartupChecks />
      <BrowserRouter>
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
            <Route path="expenses" element={<ExpensesPage />} />
            <Route path="finances" element={<FinancesPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="profile" element={<ProfilePage />} />
          </Route>
        </Routes>
        <CommandPalette />
      </BrowserRouter>
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  );
}
