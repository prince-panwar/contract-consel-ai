import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopPosition,
  TabStopType,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import {
  CONFIDENTIAL,
  EXPORT_THEME as T,
  formatDate,
  sourceLabel,
  statusLabel,
  type ExportModel,
} from "./model";

const FONT = "Times New Roman";
const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const RULE = { style: BorderStyle.SINGLE, size: 4, color: T.rule };

function run(text: string, opts: { bold?: boolean; italics?: boolean; color?: string; size?: number; caps?: boolean } = {}) {
  return new TextRun({
    text,
    font: FONT,
    bold: opts.bold,
    italics: opts.italics,
    color: opts.color ?? T.ink,
    size: opts.size ?? 22, // half-points: 11pt
    allCaps: opts.caps,
  });
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    keepNext: true,
    spacing: { before: 360, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: T.navy, space: 4 } },
    children: [run(text, { bold: true, color: T.navy, size: 23, caps: true })],
  });
}

function cell(
  text: string,
  widthPct: number,
  opts: { bold?: boolean; color?: string; fill?: string; header?: boolean; center?: boolean } = {},
): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.TOP,
    shading: opts.fill ? { type: ShadingType.CLEAR, color: "auto", fill: opts.fill } : undefined,
    margins: { top: 70, bottom: 70, left: 100, right: 100 },
    children: [
      new Paragraph({
        alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: [
          run(text, {
            bold: opts.bold || opts.header,
            color: opts.header ? "FFFFFF" : opts.color,
            size: 19,
          }),
        ],
      }),
    ],
  });
}

export async function buildDocx(model: ExportModel): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [];

  // ---- Title block
  children.push(
    new Paragraph({ children: [run(CONFIDENTIAL, { bold: true, color: T.review, size: 18 })] }),
    new Paragraph({
      spacing: { before: 200 },
      children: [run(model.title, { bold: true, color: T.navy, size: 44 })],
    }),
    new Paragraph({
      spacing: { after: 160 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: T.navy, space: 8 } },
      children: [run(model.subtitle, { italics: true, color: T.muted, size: 25 })],
    }),
  );

  const details: Array<[string, string]> = [
    ["Document reviewed", model.filename],
    ["Pages", String(model.pageCount)],
    ["Review method", model.method],
    ["Findings", `${model.total} (${model.verified} verified, ${model.needsReview} needing review)`],
    ["Not located", model.notLocated.length ? String(model.notLocated.length) : "None"],
    ["Prepared", formatDate(model.generatedAt)],
  ];
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
      rows: details.map(
        ([k, v]) =>
          new TableRow({
            children: [cell(k, 28, { bold: true, color: T.muted }), cell(v, 72)],
          }),
      ),
    }),
  );

  // ---- 1. Summary
  children.push(sectionHeading("1. Summary of Findings"));
  if (model.groups.length === 0) {
    children.push(new Paragraph({ children: [run("No findings were recorded for this document.", { italics: true, color: T.muted })] }));
  } else {
    const widths = [26, 50, 8, 16];
    let zebra = false;
    const rows = [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: ["Term", "Finding", "Page", "Status"].map((h, i) =>
          cell(h, widths[i], { header: true, fill: T.headerFill, center: i >= 2 }),
        ),
      }),
      ...model.groups.flatMap((g) =>
        g.points.map((dp, i) => {
          zebra = !zebra;
          const fill = zebra ? undefined : T.zebra;
          return new TableRow({
            cantSplit: true,
            children: [
              cell(i === 0 ? g.field : "", widths[0], { bold: true, fill }),
              cell(dp.value, widths[1], { fill }),
              cell(String(dp.page), widths[2], { fill, center: true }),
              dp.verified
                ? cell(statusLabel(dp), widths[3], { color: T.verified, fill, center: true })
                : cell(statusLabel(dp), widths[3], { color: T.review, bold: true, fill: T.reviewFill, center: true }),
            ],
          });
        }),
      ),
    ];
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: RULE, bottom: RULE, left: NONE, right: NONE, insideHorizontal: RULE, insideVertical: NONE },
        rows,
      }),
    );
  }

  // ---- 2. Detailed findings
  children.push(sectionHeading("2. Detailed Findings and Source Citations"));
  model.groups.forEach((g, gi) => {
    children.push(
      new Paragraph({
        keepNext: true,
        spacing: { before: 240, after: g.description ? 40 : 120 },
        children: [run(`2.${gi + 1}  ${g.field}`, { bold: true, color: T.navy, size: 24 })],
      }),
    );
    if (g.description) {
      children.push(
        new Paragraph({
          keepNext: true,
          spacing: { after: 120 },
          children: [run(g.description, { italics: true, color: T.muted, size: 19 })],
        }),
      );
    }
    for (const dp of g.points) {
      children.push(
        new Paragraph({ keepNext: true, spacing: { after: 100 }, children: [run(dp.value)] }),
      );
      if (dp.quote) {
        children.push(
          new Paragraph({
            keepNext: true,
            indent: { left: 360, right: 360 },
            spacing: { after: 80 },
            shading: { type: ShadingType.CLEAR, color: "auto", fill: T.quoteFill },
            border: { left: { style: BorderStyle.SINGLE, size: 18, color: T.rule, space: 8 } },
            children: [run(`“${dp.quote}”`, { italics: true, color: T.muted, size: 19 })],
          }),
        );
      }
      children.push(
        new Paragraph({
          spacing: { after: 240 },
          children: [
            run(`Source: page ${dp.page}  ·  ${sourceLabel(dp)}  ·  `, { color: T.muted, size: 17 }),
            run(statusLabel(dp), {
              color: dp.verified ? T.verified : T.review,
              bold: !dp.verified,
              size: 17,
            }),
          ],
        }),
      );
    }
  });

  // ---- 3. Not located
  let next = 3;
  if (model.notLocated.length > 0) {
    children.push(sectionHeading(`${next++}. Items Not Located`));
    children.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [
          run(
            "No supporting passage was identified for the following requested terms. Manual review of the agreement is recommended.",
          ),
        ],
      }),
    );
    for (const f of model.notLocated) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [run(f.name, { bold: true }), ...(f.description ? [run(` — ${f.description}`)] : [])],
        }),
      );
    }
  }

  // ---- Notes
  children.push(sectionHeading(`${next}. Notes and Limitations`));
  model.notes.forEach((n, i) =>
    children.push(
      new Paragraph({
        spacing: { after: 80 },
        indent: { left: 360, hanging: 360 },
        children: [run(`${i + 1}.\t${n}`, { color: T.muted, size: 19 })],
      }),
    ),
  );

  const doc = new Document({
    creator: "ContractConsel",
    title: `${model.title} — ${model.filename}`,
    description: model.subtitle,
    styles: { default: { document: { run: { font: FONT, size: 22, color: T.ink } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [run(model.title, { italics: true, color: T.muted, size: 16 })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                border: { top: { style: BorderStyle.SINGLE, size: 4, color: T.rule, space: 6 } },
                tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
                children: [
                  run(`${CONFIDENTIAL}  ·  ${model.filename}`, { color: T.muted, size: 16 }),
                  new TextRun({
                    font: FONT,
                    size: 16,
                    color: T.muted,
                    children: ["\tPage ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES],
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
