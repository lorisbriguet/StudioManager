import { useQueries, useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

/** A Markdown file in a project's folder, shown read-only in the wiki. */
export interface ProjectDoc {
  /** `file:<projectId>:<path>`: how tabs and links refer to it. */
  key: string;
  projectId: number;
  projectName: string;
  folder: string;
  rel: string;
  title: string;
  modified: number;
  /** Other Markdown files of the same folder this one links to. */
  links: string[];
}

export interface DocContent {
  title: string;
  html: string;
}

export function docKey(projectId: number, rel: string): string {
  return `file:${projectId}:${rel}`;
}

/** The Markdown files of every project that has a folder. Read again when
 *  the window gets focus, so edits made in an editor show up. */
export function useProjectDocs(projects: { id: number; name: string; folder_path: string | null }[]) {
  const withFolder = projects.filter((p) => p.folder_path);
  const results = useQueries({
    queries: withFolder.map((p) => ({
      queryKey: ["project-docs", p.id, p.folder_path],
      queryFn: async (): Promise<ProjectDoc[]> => {
        const list = (await invoke<{ rel: string; title: string; modified: number; links?: string[] }[]>("list_project_docs", {
          folder: p.folder_path,
        })) ?? [];
        return list.map((d) => ({
          ...d,
          links: d.links ?? [],
          key: docKey(p.id, d.rel),
          projectId: p.id,
          projectName: p.name,
          folder: p.folder_path!,
        }));
      },
      // A missing or unreadable folder just shows no files.
      retry: false,
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    })),
  });
  return results.flatMap((r) => r.data ?? []);
}

export function useProjectDoc(doc: ProjectDoc | undefined) {
  return useQuery({
    queryKey: ["project-doc", doc?.folder, doc?.rel],
    queryFn: () =>
      invoke<DocContent>("read_project_doc", { folder: doc!.folder, rel: doc!.rel, projectId: doc!.projectId }),
    enabled: !!doc,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
