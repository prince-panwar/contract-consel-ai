import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  HeadingLevel,
  WidthType,
  AlignmentType,
  BorderStyle,
} from "docx";
import type { DataPoint } from "../rag/types";

const HEADER_BG = "08070A";
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };

function headerCell(text: string): TableCell {
  return new TableCell({
    shading: { fill: HEADER_BG },
    children: [
      new Paragraph({
        children: [
          new TextRun({ text, bold: true, color: "FFFFFF" }),
        ],
      }),
    ],
  });
}

function bodyCell(text: string, opts: { italic?: boolean; bold?: boolean } = {}): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        children: [
          new TextRun({ text, italics: opts.italic, bold: opts.bold }),
        ],
      }),
    ],
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
  });
}

export async function buildDocx(
  filename: string,
  dataPoints: DataPoint[],
): Promise<Buffer> {
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: BORDER,
      bottom: BORDER,
      left: BORDER,
      right: BORDER,
      insideHorizontal: BORDER,
      insideVertical: BORDER,
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          headerCell("Field"),
          headerCell("Value"),
          headerCell("Quote"),
          headerCell("Page"),
        ],
      }),
      ...dataPoints.map(
        (dp) =>
          new TableRow({
            children: [
              bodyCell(dp.field, { bold: true }),
              bodyCell(dp.value),
              bodyCell(dp.quote, { italic: true }),
              bodyCell(String(dp.page)),
            ],
          }),
      ),
    ],
  });

  const doc = new Document({
    creator: "ContractConsel",
    title: `Data Points — ${filename}`,
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.LEFT,
            children: [new TextRun({ text: "Contract Data Points", bold: true })],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `Source: ${filename}`, italics: true, color: "555555" }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Generated ${new Date().toLocaleString()}`,
                italics: true,
                color: "888888",
              }),
            ],
          }),
          new Paragraph({ text: "" }),
          table,
          new Paragraph({ text: "" }),
          new Paragraph({
            children: [
              new TextRun({
                text: "Document analysis, not legal advice. Consult a licensed attorney for decisions.",
                italics: true,
                color: "888888",
              }),
            ],
          }),
        ],
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  return Buffer.from(buf);
}
