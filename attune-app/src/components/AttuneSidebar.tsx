import { Eye, FileText, FlaskConical, Gamepad2, Home, Settings, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

const nav = [
  { href: "/parent/today", label: "Today", icon: Home },
  { href: "/parent/screening", label: "Screening", icon: Eye },
  { href: "/parent/train", label: "Train", icon: Gamepad2 },
  { href: "/parent/science", label: "Science", icon: FlaskConical },
  { href: "/parent/reports", label: "Reports", icon: FileText },
  { href: "/parent/settings", label: "Settings", icon: Settings },
  { href: "/parent/setup", label: "Setup", icon: Shield },
];

export function AttuneSidebar() {
  const navigate = useNavigate();
  const activeRoute = useLocation().pathname;
  const [version, setVersion] = useState("0.1.0");

  useEffect(() => {
    invoke<string>("get_app_version").then(setVersion).catch(() => {});
  }, []);

  return (
    <aside className="flex w-56 flex-col select-none border-r border-border pt-2">
      <div
        onClick={() => navigate("/parent/today")}
        className="flex h-16 items-center px-4 pt-8 gap-2 cursor-pointer"
      >
        <img
          src="/attune-logo.png"
          alt="Attune"
          className="size-8 rounded-lg object-cover"
        />
        <div className="flex flex-col">
          <h1 className="text-sm font-semibold text-foreground">Attune</h1>
          <span className="text-[10px] text-muted-foreground">v{version}</span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-6">
        {nav.map((item) => (
          <button
            key={item.href}
            onClick={() => navigate(item.href)}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              activeRoute.startsWith(item.href)
                ? "font-medium bg-sidebar-accent text-sidebar-accent-foreground"
                : ""
            )}
          >
            <item.icon className="size-4" />
            {item.label}
          </button>
        ))}
      </nav>

      <p className="px-4 pb-4 text-[10px] text-muted-foreground leading-relaxed">
        Video never leaves this device. COPPA-safe by design.
      </p>
    </aside>
  );
}
