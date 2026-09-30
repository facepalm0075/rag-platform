import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { GuideContent } from "@/components/guide-content";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/lib/use-page-title";

export function Guide() {
  usePageTitle("Preparing your documents — RAG Studio");

  return (
    <div className="h-screen overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 pb-12 pt-14 lg:pt-12">
        <Link to="/app/new">
          <Button variant="ghost" size="sm" className="-ml-2 gap-2">
            <ArrowLeft className="h-4 w-4" /> Back to new session
          </Button>
        </Link>

        <h1 className="mt-6 text-3xl font-semibold tracking-tight">Preparing your documents</h1>

        <div className="mt-6">
          <GuideContent />
        </div>

        <div className="mt-10 flex justify-end">
          <Link to="/app/new">
            <Button>Upload a document</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
