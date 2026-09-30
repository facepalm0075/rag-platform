import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/lib/use-page-title";
import {
  Database,
  Scissors,
  Search,
  Layers,
  Workflow,
  Zap,
  Gauge,
  Eye,
  ArrowRight,
} from "lucide-react";

const skills = [
  { icon: Layers, title: "Embeddings", desc: "Dense vector representations across text and code." },
  {
    icon: Scissors,
    title: "Chunking",
    desc: "Semantic, recursive & structural chunking strategies.",
  },
  {
    icon: Database,
    title: "Vector Search",
    desc: "pgvector, Qdrant, Pinecone — HNSW & IVF tuning.",
  },
  { icon: Search, title: "Retrieval", desc: "Hybrid BM25 + dense with cross-encoder re-ranking." },
  {
    icon: Workflow,
    title: "LLM Orchestration",
    desc: "Prompt pipelines, tool use, and function calling.",
  },
  { icon: Zap, title: "Streaming", desc: "Token-level SSE streaming for responsive UX." },
  { icon: Gauge, title: "Evals", desc: "RAGAS, faithfulness & context-precision testing." },
  { icon: Eye, title: "Observability", desc: "Traces, latency and cost per query." },
];

export function Landing() {
  usePageTitle("RAG Studio — A portfolio of retrieval-augmented AI");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
            RAG Studio
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/auth">
              <Button variant="ghost" size="sm">
                Sign in
              </Button>
            </Link>
            <Link to="/auth">
              <Button size="sm">Get started</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        <section className="py-24 md:py-32">
          <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            RAG engineering portfolio
          </p>
          <h1 className="max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
            A retrieval-augmented assistant, built end-to-end.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            Upload a document or paste your own knowledge. I'll chunk it, embed it, and answer
            questions from it — the same stack I ship in production.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link to="/auth">
              <Button size="lg" className="gap-2">
                Try the demo <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <a href="#skills">
              <Button size="lg" variant="outline">
                See the stack
              </Button>
            </a>
          </div>
        </section>

        <section id="skills" className="border-t border-border/60 py-20">
          <div className="mb-12 flex items-end justify-between">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">The RAG stack</h2>
              <p className="mt-2 text-muted-foreground">
                Every layer of retrieval-augmented generation, hand-wired.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {skills.map((s) => (
              <div key={s.title} className="bg-background p-6 transition-colors hover:bg-muted/30">
                <s.icon className="h-5 w-5 text-primary" />
                <h3 className="mt-4 font-medium">{s.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-border/60 py-20">
          <div className="rounded-2xl border border-border bg-muted/30 p-10 md:p-14">
            <h2 className="max-w-xl text-3xl font-semibold tracking-tight">
              Bring a PDF. Get answers grounded in it.
            </h2>
            <p className="mt-3 max-w-xl text-muted-foreground">
              Or type your own knowledge base by hand. Either way, you'll be chatting in under a
              minute.
            </p>
            <div className="mt-8">
              <Link to="/auth">
                <Button size="lg" className="gap-2">
                  Start a session <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60 py-10">
        <div className="mx-auto max-w-6xl px-6 text-sm text-muted-foreground">
          © {new Date().getFullYear()} RAG Studio — a CV project.
        </div>
      </footer>
    </div>
  );
}
