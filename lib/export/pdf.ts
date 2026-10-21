import fs from "node:fs";
import PDFDocument from "pdfkit";
import {
  CONFIDENTIAL,
  EXPORT_THEME as T,
  formatDate,
  sourceLabel,
  statusLabel,
  type ExportModel,
} from "./model";

// Serif body (Times-compatible) with a broad-coverage fallback for glyphs the
// primary font lacks (e.g. ₹, non-Latin scripts). Installed in the Docker
// image (fonts-liberation2, fonts-dejavu-core); host paths kept for dev.
const FONT_DIRS = [
  "/usr/share/fonts/truetype/liberation2",
  "/usr/share/fonts/truetype/liberation",
];
const FALLBACK_DIR = "/usr/share/fonts/truetype/dejavu";

type Face = "regular" | "bold" | "italic" | "boldItalic";
const PRIMARY_FILES: Record<Face, string> = {
  regular: "LiberationSerif-Regular.ttf",
  bold: "LiberationSerif-Bold.ttf",
  italic: "LiberationSerif-Italic.ttf",
  boldItalic: "LiberationSerif-BoldItalic.ttf",
};
const FALLBACK_FILES: Record<Face, string> = {
  regular: "DejaVuSerif.ttf",
  bold: "DejaVuSerif-Bold.ttf",
  italic: "DejaVuSerif-Italic.ttf",
  boldItalic: "DejaVuSerif-BoldItalic.ttf",
};
const BUILTIN: Record<Face, string> = {
  regular: "Times-Roman",
  bold: "Times-Bold",
  italic: "Times-Italic",
  boldItalic: "Times-BoldItalic",
};

function findFile(dirs: string[], file: string): string | null {
  for (const d of dirs) {
    const p = `${d}/${file}`;
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// A4, 2.5 cm margins; extra bottom room for the footer.
const PAGE = { margin: 72, bottom: 86 };
const COLOR = (hex: string) => `#${hex}`;

type Doc = InstanceType<typeof PDFDocument>;

interface FontKit {
  hasGlyphForCodePoint(cp: number): boolean;
}

class Writer {
  private hasPrimary: boolean;
  private hasFallback: boolean;
  private primaryGlyphs: FontKit | null = null;

  constructor(private doc: Doc) {
    this.hasPrimary = false;
    this.hasFallback = false;
    for (const face of Object.keys(PRIMARY_FILES) as Face[]) {
      const p = findFile(FONT_DIRS, PRIMARY_FILES[face]);
      const f = findFile([FALLBACK_DIR], FALLBACK_FILES[face]);
      if (p) {
        doc.registerFont(`p-${face}`, p);
        this.hasPrimary = true;
      }
      if (f) {
        doc.registerFont(`f-${face}`, f);
        this.hasFallback = true;
      }
    }
    if (this.hasPrimary) {
      doc.font("p-regular");
      this.primaryGlyphs = (doc as unknown as { _font: { font: FontKit } })._font.font;
    }
  }

  get width(): number {
    return this.doc.page.width - PAGE.margin * 2;
  }

  font(face: Face): string {
    return this.hasPrimary ? `p-${face}` : BUILTIN[face];
  }

  /** Split text into runs the primary font can draw and runs it can't. */
  private segments(text: string): Array<{ text: string; fallback: boolean }> {
    if (!this.primaryGlyphs || !this.hasFallback) return [{ text, fallback: false }];
    const out: Array<{ text: string; fallback: boolean }> = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 32;
      const fallback = cp > 0x7e && !this.primaryGlyphs.hasGlyphForCodePoint(cp);
      const last = out[out.length - 1];
      if (last && last.fallback === fallback) last.text += ch;
      else out.push({ text: ch, fallback });
    }
    return out;
  }

  /** Draw text with glyph fallback; options as pdfkit text(). */
  text(
    text: string,
    face: Face,
    size: number,
    color: string,
    opts: PDFKit.Mixins.TextOptions & { x?: number; y?: number } = {},
  ): void {
    const { x, y, ...rest } = opts;
    const segs = this.segments(text || " ");
    this.doc.fontSize(size).fillColor(COLOR(color));
    segs.forEach((s, i) => {
      this.doc.font(s.fallback ? `f-${face}` : this.font(face));
      const continued = i < segs.length - 1;
      if (i === 0 && x !== undefined && y !== undefined) {
        this.doc.text(s.text, x, y, { ...rest, continued });
      } else {
        this.doc.text(s.text, { ...rest, continued });
      }
    });
  }

  height(text: string, face: Face, size: number, width: number): number {
    this.doc.font(this.font(face)).fontSize(size);
    return this.doc.heightOfString(text || " ", { width });
  }

  ensureSpace(h: number): void {
    if (this.doc.y + h > this.doc.page.height - PAGE.bottom) this.doc.addPage();
  }

  rule(color: string = T.rule, weight = 0.75): void {
    const y = this.doc.y;
    this.doc
      .moveTo(PAGE.margin, y)
      .lineTo(PAGE.margin + this.width, y)
      .lineWidth(weight)
      .strokeColor(COLOR(color))
      .stroke();
  }

  heading(text: string): void {
    this.ensureSpace(60);
    this.doc.moveDown(1.2);
    this.text(text.toUpperCase(), "bold", 11.5, T.navy, { characterSpacing: 0.6 });
    this.doc.moveDown(0.25);
    this.rule(T.navy, 1);
    this.doc.moveDown(0.6);
  }

  /** Table with wrapped cells, zebra rows, and a header repeated per page. */
  table(
    columns: Array<{ header: string; width: number; align?: "left" | "center" | "right" }>,
    rows: Array<Array<{ text: string; face?: Face; color?: string; fill?: string }>>,
    size = 9.5,
  ): void {
    const pad = 5;
    const total = columns.reduce((n, c) => n + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * this.width);
    const xs = widths.map((_, i) => PAGE.margin + widths.slice(0, i).reduce((a, b) => a + b, 0));

    const drawHeader = () => {
      const h = Math.max(...columns.map((c, i) => this.height(c.header, "bold", size, widths[i] - pad * 2))) + pad * 2;
      const y = this.doc.y;
      this.doc.rect(PAGE.margin, y, this.width, h).fill(COLOR(T.headerFill));
      columns.forEach((c, i) =>
        this.text(c.header, "bold", size, "FFFFFF", {
          x: xs[i] + pad,
          y: y + pad,
          width: widths[i] - pad * 2,
          align: c.align ?? "left",
        }),
      );
      this.doc.y = y + h;
    };

    this.ensureSpace(60);
    drawHeader();
    rows.forEach((row, r) => {
      const h =
        Math.max(
          ...row.map((cell, i) => this.height(cell.text, cell.face ?? "regular", size, widths[i] - pad * 2)),
        ) +
        pad * 2;
      if (this.doc.y + h > this.doc.page.height - PAGE.bottom) {
        this.doc.addPage();
        drawHeader();
      }
      const y = this.doc.y;
      if (r % 2 === 1) this.doc.rect(PAGE.margin, y, this.width, h).fill(COLOR(T.zebra));
      row.forEach((cell, i) => {
        if (cell.fill) this.doc.rect(xs[i], y, widths[i], h).fill(COLOR(cell.fill));
        this.text(cell.text, cell.face ?? "regular", size, cell.color ?? T.ink, {
          x: xs[i] + pad,
          y: y + pad,
          width: widths[i] - pad * 2,
          align: columns[i].align ?? "left",
        });
      });
      this.doc
        .moveTo(PAGE.margin, y + h)
        .lineTo(PAGE.margin + this.width, y + h)
        .lineWidth(0.5)
        .strokeColor(COLOR(T.rule))
        .stroke();
      this.doc.y = y + h;
    });
    this.doc.x = PAGE.margin;
  }
}

export async function buildPdf(model: ExportModel): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: PAGE.margin, bottom: PAGE.bottom, left: PAGE.margin, right: PAGE.margin },
    bufferPages: true,
    info: {
      Title: `${model.title} — ${model.filename}`,
      Author: "ContractConsel",
      Subject: model.subtitle,
      Creator: "ContractConsel",
    },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const w = new Writer(doc);

  // ---- Title block
  w.text(CONFIDENTIAL, "bold", 9, T.review, { characterSpacing: 1.5 });
  doc.moveDown(0.8);
  w.text(model.title, "bold", 22, T.navy);
  doc.moveDown(0.15);
  w.text(model.subtitle, "italic", 12.5, T.muted);
  doc.moveDown(0.7);
  w.rule(T.navy, 1.5);
  doc.moveDown(0.9);

  const details: Array<[string, string]> = [
    ["Document reviewed", model.filename],
    ["Pages", String(model.pageCount)],
    ["Findings", `${model.total} (${model.verified} verified, ${model.needsReview} needing review)`],
    ["Prepared", formatDate(model.generatedAt)],
  ];
  const labelW = 130;
  for (const [k, v] of details) {
    const y = doc.y;
    const h = Math.max(w.height(v, "regular", 10.5, w.width - labelW), 14);
    w.text(k, "bold", 10.5, T.muted, { x: PAGE.margin, y, width: labelW - 10 });
    w.text(v, "regular", 10.5, T.ink, { x: PAGE.margin + labelW, y, width: w.width - labelW });
    doc.y = y + h + 4;
  }
  doc.x = PAGE.margin;

  // ---- 1. Summary
  w.heading("1. Summary of Findings");
  if (model.groups.length === 0) {
    w.text("No findings were recorded for this document.", "italic", 10.5, T.muted);
  } else {
    w.table(
      [
        { header: "Term", width: 26 },
        { header: "Finding", width: 50 },
        { header: "Page", width: 8, align: "center" },
        { header: "Status", width: 16, align: "center" },
      ],
      model.groups.flatMap((g) =>
        g.points.map((dp, i) => [
          { text: i === 0 ? g.field : "", face: "bold" as Face },
          { text: dp.value },
          { text: String(dp.page) },
          dp.verified
            ? { text: statusLabel(dp), color: T.verified }
            : { text: statusLabel(dp), color: T.review, face: "bold" as Face, fill: T.reviewFill },
        ]),
      ),
    );
  }

  // ---- 2. Detailed findings
  w.heading("2. Detailed Findings and Source Citations");
  model.groups.forEach((g, gi) => {
    // Keep the heading with its first finding and quote (no orphaned titles).
    const first = g.points[0];
    const firstH =
      w.height(first.value, "regular", 10.5, w.width) +
      (first.quote ? Math.min(w.height(`\u201c${first.quote}\u201d`, "italic", 9.5, w.width - 34), 200) + 14 : 0) +
      (g.description ? w.height(g.description, "italic", 9.5, w.width) : 0);
    w.ensureSpace(firstH + 60);
    w.text(`2.${gi + 1}  ${g.field}`, "bold", 12, T.navy);
    if (g.description) {
      doc.moveDown(0.1);
      w.text(g.description, "italic", 9.5, T.muted);
    }
    doc.moveDown(0.45);
    g.points.forEach((dp) => {
      const quoteH = w.height(`“${dp.quote}”`, "italic", 9.5, w.width - 34);
      w.ensureSpace(Math.min(quoteH, 200) + 60);
      w.text(dp.value, "regular", 10.5, T.ink, { width: w.width, lineGap: 1.5 });
      doc.moveDown(0.35);
      if (dp.quote) {
        const y = doc.y;
        w.text(`“${dp.quote}”`, "italic", 9.5, T.muted, {
          x: PAGE.margin + 16,
          y: y + 4,
          width: w.width - 34,
          lineGap: 1,
        });
        const bottom = doc.y + 4;
        doc.rect(PAGE.margin + 4, y, 2.5, bottom - y).fill(COLOR(T.rule));
        doc.y = bottom;
        doc.x = PAGE.margin;
      }
      doc.moveDown(0.3);
      w.text(
        `Source: page ${dp.page}  ·  ${sourceLabel(dp)}  ·  ${statusLabel(dp)}`,
        "regular",
        8.5,
        dp.verified ? T.muted : T.review,
      );
      doc.moveDown(0.8);
    });
  });

  // ---- Notes
  w.heading("3. Notes and Limitations");
  model.notes
    .filter((n) => !n.includes("Not located"))
    .forEach((n, i) => {
      w.text(`${i + 1}.  ${n}`, "regular", 9.5, T.muted, { width: w.width, lineGap: 1 });
      doc.moveDown(0.3);
    });

  // ---- Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Footer sits inside the bottom margin; lift it so pdfkit doesn't
    // treat the footer text as overflow and start a new page.
    doc.page.margins.bottom = 0;
    const y = doc.page.height - PAGE.bottom + 26;
    doc
      .moveTo(PAGE.margin, y - 8)
      .lineTo(doc.page.width - PAGE.margin, y - 8)
      .lineWidth(0.5)
      .strokeColor(COLOR(T.rule))
      .stroke();
    const footer = `${CONFIDENTIAL}  ·  ${model.filename}`;
    w.text(footer, "regular", 8, T.muted, {
      x: PAGE.margin,
      y,
      width: w.width - 90,
      lineBreak: false,
      ellipsis: true,
      height: 10,
    });
    w.text(`Page ${i + 1} of ${range.count}`, "regular", 8, T.muted, {
      x: doc.page.width - PAGE.margin - 90,
      y,
      width: 90,
      align: "right",
      lineBreak: false,
    });
  }

  doc.end();
  return done;
}
