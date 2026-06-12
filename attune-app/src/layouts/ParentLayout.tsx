import { Outlet, Navigate } from "react-router-dom";
import { AttuneSidebar } from "@/components/AttuneSidebar";
import { useAttune } from "@/contexts/attune.context";

export function ParentLayout() {
  const { isUnlocked } = useAttune();

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-background">
      <div
        className="absolute left-0 right-0 top-0 z-50 h-10 select-none"
        data-tauri-drag-region={true}
      />
      {isUnlocked && <AttuneSidebar />}
      <main className="flex flex-1 flex-col overflow-y-auto px-8 py-6">
        <Outlet />
      </main>
    </div>
  );
}

export function RequireUnlock({ children }: { children: React.ReactNode }) {
  const { isUnlocked } = useAttune();
  if (!isUnlocked) return <Navigate to="/parent" replace />;
  return <>{children}</>;
}
