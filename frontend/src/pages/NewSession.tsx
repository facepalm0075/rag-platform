import { useNavigate } from "react-router";
import { useState } from "react";
import { Upload, Plus, Trash2, FileText, BookOpen, Check } from "lucide-react";
import * as api from "@/lib/api";
import { chunkText, type Chunk } from "@/lib/chunker";
import { extractText, formatFor, ACCEPT_ATTR, SUPPORTED_FORMATS } from "@/lib/textExtract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/skeleton";
import { GuideContent } from "@/components/guide-content";
import { usePageTitle } from "@/lib/use-page-title";
import { toast } from "sonner";
import { emitSessionsChanged } from "@/lib/events";
import { cleanExtractedText } from "@/lib/utils";

const STAGES = ["Uploading", "Extracting text", "Chunking", "Embedding"] as const;

export function NewSession() {
  const navigate = useNavigate();
  const refresh = emitSessionsChanged;

  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([{ header: "", content: "" }]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(-1);
  const [tab, setTab] = useState<"file" | "manual">("file");
  const [guideOpen, setGuideOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  usePageTitle("New session — RAG Studio");

  const onPickFile = (f: File | null) => {
    if (f && !formatFor(f)) {
      toast.error("Unsupported file type");
      return;
    }
    setFile(f);
    if (f && !name) setName(f.name.replace(/\.[^.]+$/, ""));
  };

  const submitFile = async () => {
    if (!name || !file) {
      toast.error("Add a name and a file");
      return;
    }
    setBusy(true);
    try {
      setStage(0);
      await new Promise((r) => setTimeout(r, 500));

      setStage(1);
      const text = await extractText(file);
      if (!text.trim()) {
        toast.error("No readable text found in this file");
        setStage(-1);
        return;
      }

      setStage(2);
      const parsed = chunkText(cleanExtractedText(text), {
        fallbackHeader: file.name.replace(/\.[^.]+$/, ""),
      });
      await new Promise((r) => setTimeout(r, 300));

      setStage(3);
      const s = await api.createSessionFromFile(name, file.name, parsed);
      toast.success(`Session created from ${parsed.length} chunks`);
      refresh();
      navigate(`/app/${s.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to process file");
    } finally {
      setStage(-1);
      setBusy(false);
    }
  };

  const submitManual = async () => {
    const clean = chunks.filter((c) => c.header.trim() && c.content.trim());
    if (!name || clean.length === 0) {
      toast.error("Add a name and at least one entry");
      return;
    }
    setBusy(true);
    try {
      const s = await api.createSessionFromManual(name, clean);
      toast.success("Session created");
      refresh();
      navigate(`/app/${s.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">New session</h1>
        <p className="mt-2 text-muted-foreground">
          Give it a name, then choose a knowledge source.
        </p>

        <div className="mt-10 space-y-2">
          <Label htmlFor="name">Session name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Product Handbook Q&A"
          />
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "file" | "manual")} className="mt-8">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="file" className="gap-2">
              <FileText className="h-4 w-4" /> Upload file
            </TabsTrigger>
            <TabsTrigger value="manual" className="gap-2">
              <Plus className="h-4 w-4" /> Manual entries
            </TabsTrigger>
          </TabsList>

          <TabsContent value="file" className="mt-6">
            <label
              htmlFor="doc"
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                setDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                onPickFile(e.dataTransfer.files?.[0] ?? null);
              }}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center transition-colors ${
                dragging
                  ? "border-primary bg-primary/5"
                  : "border-border bg-muted/30 hover:bg-muted/50"
              }`}
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">
                {dragging
                  ? "Drop the file here"
                  : file
                    ? file.name
                    : "Click to upload or drag & drop a document"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {SUPPORTED_FORMATS.map((f) => f.label).join(" · ")}
              </p>

              <input
                id="doc"
                type="file"
                accept={ACCEPT_ATTR}
                className="hidden"
                onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
              />
            </label>

            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              <BookOpen className="h-4 w-4" />
              How to structure each file format
            </button>

            {stage >= 0 && (
              <ul className="mt-6 space-y-2 rounded-xl border border-border bg-card p-4">
                {STAGES.map((s, i) => (
                  <li
                    key={s}
                    className={`flex items-center gap-2 text-sm ${
                      i <= stage ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {i < stage ? (
                      <Check className="h-4 w-4 text-primary" />
                    ) : (
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          i === stage ? "animate-pulse bg-primary" : "bg-border"
                        }`}
                      />
                    )}
                    {s}
                    {i === stage ? "…" : ""}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-6 flex justify-end">
              <Button onClick={submitFile} disabled={busy} className="gap-2">
                {busy && <Spinner />}
                {busy ? "Uploading…" : "Create session"}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="manual" className="mt-6 space-y-4">
            {chunks.map((c, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Entry {i + 1}
                  </span>
                  {chunks.length > 1 && (
                    <button
                      onClick={() => setChunks(chunks.filter((_, idx) => idx !== i))}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove entry"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  <Input
                    placeholder="Header"
                    value={c.header}
                    onChange={(e) => {
                      const next = [...chunks];
                      next[i] = { ...next[i], header: e.target.value };
                      setChunks(next);
                    }}
                  />
                  <Textarea
                    placeholder="Content"
                    rows={4}
                    value={c.content}
                    onChange={(e) => {
                      const next = [...chunks];
                      next[i] = { ...next[i], content: e.target.value };
                      setChunks(next);
                    }}
                  />
                </div>
              </div>
            ))}

            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => setChunks([...chunks, { header: "", content: "" }])}
            >
              <Plus className="h-4 w-4" /> Add another entry
            </Button>

            <div className="flex justify-end">
              <Button onClick={submitManual} disabled={busy} className="gap-2">
                {busy && <Spinner />}
                {busy ? "Creating…" : "Create session"}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Modal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Preparing your documents"
        description="How to structure each file format"
        className="max-w-3xl"
      >
        <GuideContent />
      </Modal>
    </div>
  );
}
