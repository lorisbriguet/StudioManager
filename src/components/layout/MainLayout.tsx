import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";

export function MainLayout() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-y-auto flex flex-col">
        <div className="p-8 w-full flex-1 flex flex-col min-h-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
