export interface Resource {
  id: number;
  name: string;
  url: string;
  price: string; // "free" | "paid" | ""
  created_at: string;
  updated_at: string;
}

export interface ResourceTag {
  id: number;
  resource_id: number;
  tag: string;
}

export interface ResourceProject {
  resource_id: number;
  project_id: number;
}
