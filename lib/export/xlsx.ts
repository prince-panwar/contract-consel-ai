import ExcelJS from "exceljs";
import {
  CONFIDENTIAL,
  EXPORT_THEME as T,
  formatDate,
  sourceLabel,
  statusLabel,
  type ExportModel,
} from "./model";

const FONT = "Calibri";
const argb = (hex: string) => `FF${hex}`;
const thin = { style: "thin" as const, color: { argb: argb(T.rule) } };

export async function buildXlsx(model: ExportModel): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ContractConsel";
  wb.created = model.generatedAt;
  wb.title = `${model.title} — ${model.filename}`;

  // ---- Findings sheet: one row per finding, filterable.
  const ws = wb.addWorksheet("Findings", {
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
      printTitlesRow: "5:5",
    },
    headerFooter: {
      oddFooter: `&L&8${CONFIDENTIAL} · ${model.filename.replace(/&/g, "&&")}&R&8Page &P of &N`,
    },
  });
  ws.columns = [
    { key: "ref", width: 7 },
    { key: "term", width: 28 },
    { key: "finding", width: 50 },
    { key: "quote", width: 70 },
    { key: "page", width: 7 },
    { key: "status", width: 15 },
    { key: "source", width: 15 },
  ];

  ws.mergeCells("A1:G1");
  ws.getCell("A1").value = model.title;
  ws.getCell("A1").font = { name: FONT, size: 16, bold: true, color: { argb: argb(T.navy) } };
  ws.mergeCells("A2:G2");
  ws.getCell("A2").value = `${model.filename}  ·  ${model.pageCount} pages  ·  ${model.method}`;
  ws.getCell("A2").font = { name: FONT, size: 10, italic: true, color: { argb: argb(T.muted) } };
  ws.mergeCells("A3:G3");
  ws.getCell("A3").value = `${CONFIDENTIAL}  ·  Prepared ${formatDate(model.generatedAt)}  ·  ${model.total} findings (${model.verified} verified, ${model.needsReview} needing review)`;
  ws.getCell("A3").font = { name: FONT, size: 9, color: { argb: argb(T.muted) } };

  const headerRow = ws.getRow(5);
  headerRow.values = ["Ref.", "Term", "Finding", "Source quotation", "Page", "Status", "Source"];
  headerRow.height = 20;
  headerRow.eachCell((c) => {
    c.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(T.headerFill) } };
    c.alignment = { vertical: "middle", horizontal: "left" };
  });

  let rowNum = 6;
  model.groups.forEach((g, gi) => {
    g.points.forEach((dp, pi) => {
      const row = ws.getRow(rowNum++);
      row.values = [
        `${gi + 1}.${pi + 1}`,
        g.field,
        dp.value,
        dp.quote,
        dp.page,
        statusLabel(dp),
        sourceLabel(dp),
      ];
      row.eachCell((c) => {
        c.font = { name: FONT, size: 10, color: { argb: argb(T.ink) } };
        c.alignment = { vertical: "top", wrapText: true };
        c.border = { bottom: thin };
        if (rowNum % 2 === 0) {
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(T.zebra) } };
        }
      });
      row.getCell("term").font = { name: FONT, size: 10, bold: true, color: { argb: argb(T.ink) } };
      row.getCell("quote").font = { name: FONT, size: 10, italic: true, color: { argb: argb(T.muted) } };
      row.getCell("page").alignment = { vertical: "top", horizontal: "center" };
      const status = row.getCell("status");
      if (dp.verified) {
        status.font = { name: FONT, size: 10, color: { argb: argb(T.verified) } };
      } else {
        status.font = { name: FONT, size: 10, bold: true, color: { argb: argb(T.review) } };
        status.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(T.reviewFill) } };
      }
    });
  });
  for (const f of model.notLocated) {
    const row = ws.getRow(rowNum++);
    row.values = ["—", f.name, "Not located", "", "", "Not located", ""];
    row.eachCell((c) => {
      c.font = { name: FONT, size: 10, italic: true, color: { argb: argb(T.muted) } };
      c.alignment = { vertical: "top", wrapText: true };
      c.border = { bottom: thin };
    });
  }
  ws.views = [{ state: "frozen", ySplit: 5 }];
  if (rowNum > 6) ws.autoFilter = { from: "A5", to: `G${rowNum - 1}` };

  // ---- Notes sheet
  const notes = wb.addWorksheet("Notes");
  notes.getColumn(1).width = 110;
  notes.getCell("A1").value = "Notes and Limitations";
  notes.getCell("A1").font = { name: FONT, size: 14, bold: true, color: { argb: argb(T.navy) } };
  model.notes.forEach((n, i) => {
    const c = notes.getCell(`A${i + 3}`);
    c.value = `${i + 1}. ${n}`;
    c.font = { name: FONT, size: 10, color: { argb: argb(T.muted) } };
    c.alignment = { wrapText: true, vertical: "top" };
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
