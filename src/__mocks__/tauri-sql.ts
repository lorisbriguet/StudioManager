// Stub for @tauri-apps/plugin-sql
export default class Database {
  static async load(): Promise<Database> {
    return new Database();
  }
  async select(): Promise<unknown[]> {
    return [];
  }
  async execute(): Promise<void> {}
}
