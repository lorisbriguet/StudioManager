import type { ReactNode } from "react";
import { SearchX } from "lucide-react";
import { useT } from "../../i18n/useT";
import { Button } from "./Button";
import { Callout } from "./Feedback";
import { EmptyState, type EmptyStateSize } from "./EmptyState";

/**
 * QueryState — the one order every data surface follows.
 * See DESIGN-SYSTEM.md, "Empty, loading and error states".
 *
 *   <QueryState
 *     query={projectsQuery}
 *     skeleton={<CardGridSkeleton />}
 *     errorMessage={t.load_error_projects}
 *     empty={<EmptyState icon={FolderOpen} message={t.no_projects} action={newButton} />}
 *     noResults={filtered.length === 0 ? { onClear: clearFilters } : undefined}
 *   >
 *     {(projects) => <Grid rows={filtered} />}
 *   </QueryState>
 *
 * 1. loading (no data yet)      → `skeleton`. Never the empty text.
 * 2. failed (no data to show)   → a danger Callout, "Couldn't load …" + Retry (refetch).
 *                                  Never "No X yet" + a create button.
 * 3. empty (`isEmpty(data)`)    → `empty`. Default isEmpty: an empty array.
 * 4. no results (`noResults`)   → EmptyState "No results" + "Clear filters".
 * 5. otherwise                  → `children(data)`.
 *
 * A refetch that fails while data is cached keeps showing the data.
 */

/** The parts of a TanStack Query result QueryState reads. */
export interface QueryLike<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching?: boolean;
  refetch: () => unknown;
}

export interface NoResultsProps {
  /** Defaults to t.no_results. */
  message?: ReactNode;
  /** Resets the search and the filter conditions. */
  onClear: () => void;
  size?: EmptyStateSize;
}

interface QueryStateProps<T> {
  query: QueryLike<T>;
  skeleton: ReactNode;
  /** "Couldn't load projects" (t.load_error_*). Defaults to t.load_error_generic. */
  errorMessage?: string;
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  /** Pass when the data exists but the search / filters match nothing. */
  noResults?: NoResultsProps;
  children: (data: T) => ReactNode;
}

const defaultIsEmpty = (data: unknown) => Array.isArray(data) && data.length === 0;

export function QueryState<T>({ query, skeleton, errorMessage, empty, isEmpty = defaultIsEmpty, noResults, children }: QueryStateProps<T>) {
  const { data } = query;
  if (data === undefined) {
    if (query.isError) return <QueryError message={errorMessage} onRetry={query.refetch} retrying={query.isFetching} />;
    return <>{skeleton}</>;
  }
  if (empty !== undefined && isEmpty(data)) return <>{empty}</>;
  if (noResults) return <NoResults {...noResults} />;
  return <>{children(data)}</>;
}

/** The failed-load state on its own (a surface that doesn't use QueryState). */
export function QueryError({
  message,
  onRetry,
  retrying = false,
  className = "",
}: {
  message?: string;
  onRetry: () => unknown;
  retrying?: boolean;
  className?: string;
}) {
  const t = useT();
  return (
    <Callout
      tone="danger"
      className={className}
      action={
        <Button variant="secondary" loading={retrying} onClick={() => void onRetry()}>
          {t.retry}
        </Button>
      }
    >
      {message ?? t.load_error_generic}
    </Callout>
  );
}

/** "No results" + "Clear filters" (list pages; also inside Table.Empty). Palettes and dropdowns don't offer Clear. */
export function NoResults({ message, onClear, size = "lg" }: NoResultsProps) {
  const t = useT();
  return (
    <EmptyState
      size={size}
      icon={SearchX}
      message={message ?? t.no_results}
      action={
        <Button variant="secondary" onClick={onClear}>
          {t.clear_filters}
        </Button>
      }
    />
  );
}
