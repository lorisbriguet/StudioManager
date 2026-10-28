/** Each project gets one of the eight chart colours, the same one in the
 *  explorer, the side panel and the graph. Articles without a project are
 *  grey. */
export const NO_PROJECT_COLOR = "var(--color-muted)";

export function projectColors(projectIds: (number | null | undefined)[]): Map<number, string> {
  const ids = [...new Set(projectIds.filter((id): id is number => id != null))].sort((a, b) => a - b);
  return new Map(ids.map((id, i) => [id, `var(--color-chart-${(i % 8) + 1})`]));
}

export function colorFor(colors: Map<number, string>, projectId: number | null | undefined): string {
  return projectId != null ? colors.get(projectId) ?? NO_PROJECT_COLOR : NO_PROJECT_COLOR;
}
