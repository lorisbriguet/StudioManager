import { UpkeepWidget } from "../upkeep/UpkeepWidget";
import { WikiOverviewWidget, WikiRecentWidget } from "./WikiWidgets";
import { useT } from "../../i18n/useT";
import type { WidgetType } from "../../stores/dashboard-store";
import { KPIInvoiced, KPIBalance, KPIExpenses, KPINet, ProfitMargin, AverageInvoiceValue, QuoteConversionRate } from "./KpiWidgets";
import { ChartRevenue, RevenueByActivity, RevenueByClient, ExpenseBreakdown, MonthlyComparison } from "./FinanceChartWidgets";
import { RecentInvoices, UnpaidInvoices, UpcomingReminders, InvoiceAging } from "./InvoiceWidgets";
import { TodayTasks, OverdueTasks, StaleTasks, RecentlyCompleted, WeeklyStreak, BusiestDay } from "./TaskWidgets";
import { ProjectProgress, UpcomingDeadlines, ProjectsWithoutDeadline, StaleProjects } from "./ProjectWidgets";
import { TopClient, ClientActivity, NewClientsYear } from "./ClientWidgets";
import { ThisWeekEvents, FreeDaysWeek, QuickCreate, PinnedNotes } from "./PlanningWidgets";
import { TimeThisWeek, PlannedVsActual, TopTimeConsumers, BillableSummary, WeeklyTrendWidget, ProjectTimeDistribution } from "./TimeWidgets";

// The widgets live in one file per area (KpiWidgets, InvoiceWidgets, ...).
export { KPIWidget } from "./KpiWidgets";

// ── Widget renderer ──

function UnknownWidget() {
  const t = useT();
  return <div className="p-4 text-muted text-sm">{t.unknown_widget}</div>;
}

export function renderWidget(type: WidgetType) {
  switch (type) {
    case "kpi-invoiced": return <KPIInvoiced />;
    case "kpi-balance": return <KPIBalance />;
    case "kpi-expenses": return <KPIExpenses />;
    case "kpi-net": return <KPINet />;
    case "chart-revenue": return <ChartRevenue />;
    case "recent-invoices": return <RecentInvoices />;
    case "today-tasks": return <TodayTasks />;
    case "overdue-tasks": return <OverdueTasks />;
    case "upkeep": return <UpkeepWidget />;
    case "wiki-recent": return <WikiRecentWidget />;
    case "wiki-overview": return <WikiOverviewWidget />;
    case "project-progress": return <ProjectProgress />;
    case "upcoming-deadlines": return <UpcomingDeadlines />;
    case "revenue-by-activity": return <RevenueByActivity />;
    case "revenue-by-client": return <RevenueByClient />;
    case "this-week-events": return <ThisWeekEvents />;
    // Phase 18
    case "unpaid-invoices": return <UnpaidInvoices />;
    case "expense-breakdown": return <ExpenseBreakdown />;
    case "monthly-comparison": return <MonthlyComparison />;
    case "profit-margin": return <ProfitMargin />;
    case "top-client": return <TopClient />;
    case "average-invoice-value": return <AverageInvoiceValue />;
    case "quote-conversion-rate": return <QuoteConversionRate />;
    case "client-activity": return <ClientActivity />;
    case "new-clients-year": return <NewClientsYear />;
    case "stale-tasks": return <StaleTasks />;
    case "projects-without-deadline": return <ProjectsWithoutDeadline />;
    case "free-days-week": return <FreeDaysWeek />;
    case "upcoming-reminders": return <UpcomingReminders />;
    case "recently-completed": return <RecentlyCompleted />;
    case "stale-projects": return <StaleProjects />;
    case "weekly-streak": return <WeeklyStreak />;
    case "busiest-day": return <BusiestDay />;
    case "quick-create": return <QuickCreate />;
    case "pinned-notes": return <PinnedNotes />;
    // Phase 13 — Time tracking
    case "time-this-week": return <TimeThisWeek />;
    case "planned-vs-actual": return <PlannedVsActual />;
    case "top-time-consumers": return <TopTimeConsumers />;
    case "billable-summary": return <BillableSummary />;
    case "weekly-trend": return <WeeklyTrendWidget />;
    case "project-time-distribution": return <ProjectTimeDistribution />;
    case "invoice-aging": return <InvoiceAging />;
    default: return <UnknownWidget />;
  }
}
