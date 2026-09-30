import { CheckCircle2 } from "lucide-react";
import { SUPPORTED_FORMATS } from "@/lib/textExtract";
import { MIN_CHARS, MAX_CHARS } from "@/lib/chunker";

const LADDER = [
  'Three blank lines ("\\n\\n\\n") — a section break',
  'Two blank lines ("\\n\\n") — a paragraph break',
  'A single line break ("\\n")',
  'A sentence break (". ")',
  "A hard character split as the last resort",
];

/** Shared guide body — rendered both on /app/guide and inside the guide modal. */
export function GuideContent() {
  return (
    <div>
      <p className="text-muted-foreground">
        Files are parsed and chunked in your browser before they are sent. Each
        chunk is {MIN_CHARS}–{MAX_CHARS} characters and keeps a header when one
        can be detected — better structure in, better retrieval out.
      </p>

      <section className="mt-6 rounded-xl border border-border bg-muted/30 p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          How chunking works
        </h3>
        <p className="mt-3 text-sm text-muted-foreground">
          Text is split on the coarsest boundary that fits. If a piece is still
          too large, the next boundary down is tried:
        </p>
        <ol className="mt-4 space-y-2">
          {LADDER.map((step, i) => (
            <li key={step} className="flex gap-3 text-sm">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-xs">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-muted-foreground">
          The first line of a chunk becomes its header when it looks like a
          title: a Markdown heading, a numbered section, an ALL CAPS or Title
          Case line, or a short line with no ending punctuation.
        </p>
      </section>

      <div className="mt-6 space-y-4">
        {SUPPORTED_FORMATS.map((f) => (
          <section
            key={f.id}
            className="rounded-xl border border-border bg-card p-5"
          >
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="font-semibold">{f.label}</h3>
              <span className="text-xs text-muted-foreground">
                {f.extensions.join(" · ")}
              </span>
            </div>
            <ul className="mt-3 space-y-2">
              {f.guide.map((tip) => (
                <li
                  key={tip}
                  className="flex gap-2.5 text-sm text-muted-foreground"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
