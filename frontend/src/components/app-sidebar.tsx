import { Link, useLocation, useNavigate } from "react-router";
import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, LogOut, FileText, Pencil, Eye, X } from "lucide-react";
import * as api from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Skeleton, Spinner } from "@/components/ui/skeleton";
import { Modal } from "@/components/ui/modal";
import { SessionEntriesModal } from "@/components/session-entries-modal";
import { toast } from "sonner";
import { emitSessionsChanged, onSessionsChanged } from "@/lib/events";

export function AppSidebar({
  open,
  onClose,
  isMobile,
}: {
  open: boolean;
  onClose: () => void;
  isMobile: boolean;
}) {
  const [sessions, setSessions] = useState<api.Session[] | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<api.Session | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const retriedEmpty = useRef(false);
  const load = () =>
    api.listSessions().then((s) => {
      setSessions(s);
      // Register seeds example data asynchronously — retry once if it isn't
      // visible yet on the very first load.
      if (s.length === 0 && !retriedEmpty.current) {
        retriedEmpty.current = true;
        setTimeout(() => void api.listSessions().then(setSessions), 2000);
      }
    });
  useEffect(() => {
    load();
    return onSessionsChanged(load);
  }, []);

  const askDelete = (s: api.Session, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPendingDelete(s);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setDeleting(true);
    try {
      await api.deleteSession(pendingDelete);
      toast.success("Session deleted");
      load();
      if (pathname.includes(id)) navigate("/app");
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const onPreview = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPreview(id);
  };

  return (
    <>
      {isMobile && (
        <div
          onClick={onClose}
          aria-hidden
          className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${
            open ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        />
      )}
      <aside
        className={`flex h-dvh w-72 flex-col border-r border-border bg-sidebar text-sidebar-foreground ${
          isMobile
            ? `fixed inset-y-0 left-0 z-50 shadow-xl transition-transform duration-300 ease-in-out ${
                open ? "translate-x-0" : "-translate-x-full"
              }`
            : "static shadow-none"
        }`}
      >
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
          <span className="font-semibold tracking-tight">RAG Studio</span>
          {isMobile && (
            <button
              onClick={onClose}
              aria-label="Close navigation"
              className="ml-auto rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="px-3">
          <Link to="/app/new">
            <Button className="w-full justify-start gap-2" size="sm">
              <Plus className="h-4 w-4" />
              New session
            </Button>
          </Link>
        </div>

        <div className="mt-6 flex-1 overflow-y-auto px-3">
          <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Sessions
          </p>
          {sessions === null ? (
            <div className="space-y-1.5 px-2 pt-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2 py-1.5">
                  <Skeleton className="h-4 w-4 shrink-0 rounded" />
                  <Skeleton className="h-3.5 flex-1" />
                </div>
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">No sessions yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {sessions.map((s) => {
                const active = pathname === `/app/${s.id}`;
                return (
                  <li key={s.id} className="group">
                    <Link
                      to={`/app/${s.id}`}
                      className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors ${
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "hover:bg-sidebar-accent/60"
                      }`}
                    >
                      {s.sourceType === "manual" ? (
                        <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="flex-1 truncate">{s.name}</span>
                      <span className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <button
                          onClick={(e) => onPreview(s.id, e)}
                          aria-label="View entries"
                          title="View entries"
                        >
                          <Eye className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                        </button>
                        <button onClick={(e) => askDelete(s, e)} aria-label="Delete session">
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                        </button>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border p-3">
          <div className="flex items-center justify-between px-2 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user?.username}</p>
              <p className="text-xs text-muted-foreground">Signed in</p>
            </div>
            <button
              onClick={async () => {
                await signOut();
                navigate("/");
              }}
              className="rounded-md p-2 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        <SessionEntriesModal
          sessionId={preview}
          open={preview !== null}
          onClose={() => setPreview(null)}
        />

        <Modal
          open={pendingDelete !== null}
          onClose={() => !deleting && setPendingDelete(null)}
          title="Delete session?"
          description={pendingDelete?.name}
          className="max-w-md"
          footer={
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleting}
                className="gap-2"
                onClick={confirmDelete}
              >
                {deleting && <Spinner />}
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          }
        >
          <p className="text-sm text-muted-foreground">
            This permanently removes the session, its entries and its chat history. This can't be
            undone.
          </p>
        </Modal>
      </aside>
    </>
  );
}
