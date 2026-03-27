export interface WikiFolder {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface WikiArticle {
  id: number;
  folder_id: number | null;
  project_id: number | null;
  title: string;
  content: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface WikiArticleWithTags extends WikiArticle {
  tags: string[];
  project_name?: string;
}
