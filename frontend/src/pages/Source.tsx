import { Link, useParams } from "react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, FileText, Pencil } from "lucide-react";
import * as api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton, ChunkSkeletonList } from "@/components/ui/skeleton";
import { usePageTitle } from "@/lib/use-page-title";

export function Source() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<api.Session | null>(null);
  const [chunks, setChunks] = useState<api.Chunk[]>([]);
  const [loading, setLoading] = useState(true);

  usePageTitle(session ? `${session.name} — source` : "Source — RAG Studio");

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setLoading(true);
    api.getSession(sessionId).then((s) => {
      if (cancelled) return;
      setSession(s);
      if (!s) {
        setLoading(false);
        return;
      }
      return api.listChunks(s).then((c) => {
        if (cancelled) return;
        setChunks(c);
        setLoading(false);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <div className="h-screen overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 pb-12 pt-14 lg:pt-12">
        <Link to={`/app/${sessionId}`}>
          <Button variant="ghost" size="sm" className="gap-2 -ml-2">
            <ArrowLeft className="h-4 w-4" /> Back to chat
          </Button>
        </Link>

        <div className="mt-6 flex items-start gap-3">
          {session?.sourceType === "manual" ? (
            <Pencil className="mt-1.5 h-5 w-5 text-muted-foreground" />
          ) : (
            <FileText className="mt-1.5 h-5 w-5 text-muted-foreground" />
          )}
          <div className="flex-1">
            {session ? (
              <>
                <h1 className="text-2xl font-semibold tracking-tight">{session.name}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {session.sourceMeta} · {chunks.length} chunk
                  {chunks.length === 1 ? "" : "s"} in ingest order
                </p>
              </>
            ) : (
              <div className="space-y-2">
                <Skeleton className="h-7 w-64" />
                <Skeleton className="h-3.5 w-48" />
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="mt-10">
            <ChunkSkeletonList count={4} />
          </div>
        ) : chunks.length === 0 ? (
          <p className="mt-10 text-sm text-muted-foreground">No chunks stored for this session.</p>
        ) : (
          <ol className="mt-10 space-y-4">
            {chunks.map((c, i) => (
              <li key={i} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="text-sm font-semibold">{c.header}</h2>
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
      </div>
    </div>
  );
}
