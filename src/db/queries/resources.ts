import { getDb, validateFields } from "../index";
import type { Resource, ResourceTag } from "../../types/resource";

export async function getResources(): Promise<Resource[]> {
  const db = await getDb();
  return db.select<Resource[]>("SELECT * FROM resources ORDER BY name ASC");
}

export async function getResourceById(id: number): Promise<Resource | null> {
  const db = await getDb();
  const rows = await db.select<Resource[]>("SELECT * FROM resources WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function getResourceTags(resourceId: number): Promise<ResourceTag[]> {
  const db = await getDb();
  return db.select<ResourceTag[]>(
    "SELECT * FROM resource_tags WHERE resource_id = $1",
    [resourceId]
  );
}

export async function getAllTags(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ tag: string }[]>(
    "SELECT DISTINCT tag FROM resource_tags ORDER BY tag ASC"
  );
  return rows.map((r) => r.tag);
}

export async function getResourcesByProject(projectId: number): Promise<Resource[]> {
  const db = await getDb();
  return db.select<Resource[]>(
    `SELECT r.* FROM resources r
     JOIN resource_projects rp ON r.id = rp.resource_id
     WHERE rp.project_id = $1
     ORDER BY r.name ASC`,
    [projectId]
  );
}

export async function createResource(
  data: { name: string; url: string; price: string; tags: string[] }
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    "INSERT INTO resources (name, url, price) VALUES ($1, $2, $3)",
    [data.name, data.url, data.price]
  );
  const id = result.lastInsertId ?? 0;
  for (const tag of data.tags) {
    await db.execute(
      "INSERT INTO resource_tags (resource_id, tag) VALUES ($1, $2)",
      [id, tag.trim()]
    );
  }
  return id;
}

export async function updateResource(
  id: number,
  data: Partial<{ name: string; url: string; price: string }>
): Promise<void> {
  const db = await getDb();
  const fields = Object.keys(data).filter(
    (k) => data[k as keyof typeof data] !== undefined
  );
  if (fields.length === 0) return;
  validateFields(fields);
  const sets = fields.map((f, i) => `${f} = $${i + 1}`);
  sets.push(`updated_at = datetime('now')`);
  const values = fields.map((f) => data[f as keyof typeof data]);
  await db.execute(
    `UPDATE resources SET ${sets.join(", ")} WHERE id = $${fields.length + 1}`,
    [...values, id]
  );
}

export async function setResourceTags(resourceId: number, tags: string[]): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM resource_tags WHERE resource_id = $1", [resourceId]);
  for (const tag of tags) {
    if (tag.trim()) {
      await db.execute(
        "INSERT INTO resource_tags (resource_id, tag) VALUES ($1, $2)",
        [resourceId, tag.trim()]
      );
    }
  }
}

export async function deleteResource(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM resources WHERE id = $1", [id]);
}

export async function linkResourceToProject(resourceId: number, projectId: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR IGNORE INTO resource_projects (resource_id, project_id) VALUES ($1, $2)",
    [resourceId, projectId]
  );
}

export async function unlinkResourceFromProject(resourceId: number, projectId: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM resource_projects WHERE resource_id = $1 AND project_id = $2",
    [resourceId, projectId]
  );
}
