import { useEffect, useState } from "react";
import * as api from "@/lib/api";
import { Modal } from "@/components/ui/modal";
import { ChunkSkeletonList, Skeleton } from "@/components/ui/skeleton";

/**
 * Popup that shows the ordered entries (chunks) ingested for a session.
 * Session meta and chunks are fetched separately, each with its own skeleton.
 */
export function SessionEntriesModal({
  sessionId,
  open,
  onClose,
}: {
  sessionId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [session, setSession] = useState<api.Session | null>(null);
  const [chunks, setChunks] = useState<api.Chunk[] | null>(null);

  useEffect(() => {
    if (!open || !sessionId) return;
    let cancelled = false;
    setSession(null);
    setChunks(null);
    api.getSession(sessionId).then((s) => {
      if (cancelled) return;
      setSession(s);
      if (!s) return;
      return api.listChunks(s).then((c) => !cancelled && setChunks(c));
    });
    return () => {
      cancelled = true;
    };
  }, [open, sessionId]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={session ? session.name : <Skeleton className="h-4 w-48" />}
      description={
        session ? (
          `${session.sourceMeta} · ${session.chunkCount} chunk${session.chunkCount === 1 ? "" : "s"} in ingest order`
        ) : (
          <Skeleton className="mt-1 h-3 w-64" />
        )
      }
      className="max-w-3xl"
    >
      {chunks === null ? (
        <ChunkSkeletonList count={3} />
      ) : chunks.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No entries stored for this session.
        </p>
      ) : (
        <ol className="space-y-4">
          {chunks.map((c, i) => (
            <li key={i} className="rounded-xl border border-border bg-muted/20 p-5">
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="text-sm font-semibold">{c.header}</h3>
                <span className="shrink-0 text-xs text-muted-foreground">
                  #{i + 1} · {c.content.length} chars
                </span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {c.content}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
