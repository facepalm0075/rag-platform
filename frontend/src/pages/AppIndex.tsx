import { Link } from "react-router";
import { Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/lib/use-page-title";

export function AppIndex() {
  usePageTitle("Workspace — RAG Studio");

  return (
    <div className="flex h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted/40">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Start your first RAG session</h1>
        <p className="mt-2 text-muted-foreground">
          Upload a PDF or paste your own knowledge base. Then chat with it.
        </p>
        <div className="mt-8">
          <Link to="/app/new">
            <Button size="lg" className="gap-2">
              New session <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
