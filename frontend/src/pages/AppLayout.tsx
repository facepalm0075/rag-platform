import { Outlet, useNavigate } from "react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelLeft } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { AppSidebar } from "@/components/app-sidebar";
import { useIsMobile } from "@/lib/use-is-mobile";
import { usePageTitle } from "@/lib/use-page-title";

export function AppLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const isMobile = useIsMobile();

  usePageTitle("Workspace — RAG Studio");

  useEffect(() => {
    if (!loading && !user) navigate("/auth");
  }, [loading, user, navigate]);

  const closeSidebar = useCallback(() => setMobileSidebarOpen(false), []);

  useEffect(() => {
    if (!isMobile) setMobileSidebarOpen(false);
  }, [isMobile]);

  useEffect(() => {
    document.body.style.overflow = mobileSidebarOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileSidebarOpen]);

  if (loading || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh bg-background">
      {isMobile && (
        <button
          onClick={() => setMobileSidebarOpen(true)}
          aria-label="Open navigation"
          className="fixed left-4 top-4 z-50 rounded-md border border-border bg-background p-2 text-foreground shadow-sm transition-colors hover:bg-accent"
        >
          <PanelLeft className="h-5 w-5" />
        </button>
      )}
      <AppSidebar open={mobileSidebarOpen} onClose={closeSidebar} isMobile={isMobile} />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
