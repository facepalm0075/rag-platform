// ============================================================================
// CLIENT-SIDE TEXT EXTRACTION
// Everything runs in the browser. Heavy parsers (PDF, DOCX) are loaded lazily
// so they never inflate the initial bundle.
// ============================================================================

export type SupportedFormat = {
  id: string;
  label: string;
  extensions: string[];
  mime: string[];
  /** How to structure the file so the chunker finds clean headers. */
  guide: string[];
};

export const SUPPORTED_FORMATS: SupportedFormat[] = [
  {
    id: "pdf",
    label: "PDF",
    extensions: [".pdf"],
    mime: ["application/pdf"],
    guide: [
      "Text-based PDFs only — scanned images have no text layer and cannot be read in the browser.",
      "Put each section title on its own line, with a blank line before and after it.",
      "Avoid multi-column layouts; text is read in reading order and columns can interleave.",
      "Leave two blank lines between major sections so the chunker splits there first.",
    ],
  },
  {
    id: "docx",
    label: "Word (.docx)",
    extensions: [".docx"],
    mime: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    guide: [
      "Use real Heading 1/2/3 styles — they are converted to Markdown headings and become chunk headers.",
      "One idea per paragraph; the chunker prefers paragraph breaks when splitting.",
      "Avoid text boxes and tables for core content — they flatten poorly.",
    ],
  },
  {
    id: "markdown",
    label: "Markdown",
    extensions: [".md", ".markdown"],
    mime: ["text/markdown"],
    guide: [
      "Best format overall. Every `#`/`##` line is detected as a chunk header.",
      "Keep each section between roughly 800 and 1500 characters so it maps to one chunk.",
      "Separate major sections with a blank line before the next heading.",
    ],
  },
  {
    id: "text",
    label: "Plain text",
    extensions: [".txt", ".log"],
    mime: ["text/plain"],
    guide: [
      "Write the section title on its own short line with no trailing period.",
      "ALL CAPS or Title Case title lines are recognised as headers.",
      "Use two blank lines between sections, one blank line between paragraphs.",
    ],
  },
  {
    id: "html",
    label: "HTML",
    extensions: [".html", ".htm"],
    mime: ["text/html"],
    guide: [
      "Semantic `<h1>`–`<h3>` tags become header lines; `<script>`/`<style>` are dropped.",
      "Wrap body copy in `<p>` tags so paragraph breaks survive.",
      "Strip navigation and footers first — they add noise to retrieval.",
    ],
  },
  {
    id: "csv",
    label: "CSV / TSV",
    extensions: [".csv", ".tsv"],
    mime: ["text/csv", "text/tab-separated-values"],
    guide: [
      "Row 1 must be the header row; each row is rendered as `column: value` lines.",
      "Keep one entity per row and give it a short identifying first column.",
      "Wide tables (30+ columns) chunk poorly — split them into several files.",
    ],
  },
  {
    id: "json",
    label: "JSON",
    extensions: [".json"],
    mime: ["application/json"],
    guide: [
      "An array of objects works best — each object becomes its own section.",
      "Include a `title`, `name`, or `heading` key; it is used as the chunk header.",
      "Flat objects beat deeply nested ones; nesting is indented, not summarised.",
    ],
  },
];

export const ACCEPT_ATTR = SUPPORTED_FORMATS.flatMap((f) => [
  ...f.extensions,
  ...f.mime,
]).join(",");

const extOf = (name: string) => {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
};

export function formatFor(file: File): SupportedFormat | null {
  const ext = extOf(file.name);
  return (
    SUPPORTED_FORMATS.find((f) => f.extensions.includes(ext)) ??
    SUPPORTED_FORMATS.find((f) => f.mime.includes(file.type)) ??
    null
  );
}

// ---------- per-format extractors ----------

async function fromPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let text = "";
    let lastY: number | null = null;
    for (const item of content.items as Array<Record<string, unknown>>) {
      const str = typeof item.str === "string" ? item.str : "";
      const transform = item.transform as number[] | undefined;
      const y = transform ? transform[5] : null;
      const height = typeof item.height === "number" ? item.height : 10;
      if (lastY !== null && y !== null) {
        const gap = Math.abs(lastY - y);
        if (gap > height * 1.6) text += "\n\n";
        else if (gap > 2) text += "\n";
      }
      text += str;
      if (y !== null) lastY = y;
    }
    pages.push(text.trim());
  }
  return pages.join("\n\n\n");
}

async function fromDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth/mammoth.browser.js");
  const converter = (mammoth as unknown as { convertToMarkdown: (o: object) => Promise<{ value: string }> })
    .convertToMarkdown;
  const result = await converter({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

function fromHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,noscript,svg").forEach((n) => n.remove());
  const out: string[] = [];
  doc.body.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,pre,blockquote").forEach((el) => {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text) return;
    if (/^h[1-6]$/i.test(el.tagName)) out.push(`\n\n${text}`);
    else if (el.tagName === "LI") out.push(`- ${text}`);
    else out.push(text);
  });
  const joined = out.join("\n\n").trim();
  return joined || (doc.body.textContent ?? "").trim();
}

function splitDelimited(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function fromCsv(raw: string, delimiter: string): string {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim());
  if (lines.length === 0) return "";
  const headers = splitDelimited(lines[0], delimiter);
  return lines
    .slice(1)
    .map((line, idx) => {
      const cells = splitDelimited(line, delimiter);
      const title = cells[0] || `Row ${idx + 1}`;
      const body = headers
        .map((h, i) => (cells[i] ? `${h}: ${cells[i]}` : null))
        .filter(Boolean)
        .join("\n");
      return `${title}\n${body}`;
    })
    .join("\n\n\n");
}

function renderJsonValue(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined) return `${pad}—`;
  if (Array.isArray(value))
    return value.map((v) => renderJsonValue(v, indent)).join("\n");
  if (typeof value === "object")
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) =>
        typeof v === "object" && v !== null
          ? `${pad}${k}:\n${renderJsonValue(v, indent + 1)}`
          : `${pad}${k}: ${String(v)}`,
      )
      .join("\n");
  return `${pad}${String(value)}`;
}

function fromJson(raw: string): string {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return raw;
  }
  const items = Array.isArray(data) ? data : [data];
  return items
    .map((item, idx) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const rec = item as Record<string, unknown>;
        const titleKey = ["title", "name", "heading", "header", "id"].find(
          (k) => typeof rec[k] === "string",
        );
        const title = titleKey ? String(rec[titleKey]) : `Item ${idx + 1}`;
        const rest = { ...rec };
        if (titleKey) delete rest[titleKey];
        return `${title}\n${renderJsonValue(rest)}`;
      }
      return `Item ${idx + 1}\n${renderJsonValue(item)}`;
    })
    .join("\n\n\n");
}

/** Extract plain text from a supported file, entirely client-side. */
export async function extractText(file: File): Promise<string> {
  const format = formatFor(file);
  if (!format) throw new Error(`Unsupported file type: ${file.name}`);

  switch (format.id) {
    case "pdf":
      return fromPdf(file);
    case "docx":
      return fromDocx(file);
    case "html":
      return fromHtml(await file.text());
    case "csv":
      return fromCsv(await file.text(), file.name.toLowerCase().endsWith(".tsv") ? "\t" : ",");
    case "json":
      return fromJson(await file.text());
    default:
      return file.text();
  }
}
