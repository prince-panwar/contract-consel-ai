/**
 * Rebuilds a page's reading text from pdf.js text items.
 *
 * The pdf.js bundled with pdf-parse never sets `hasEOL`, so joining `item.str`
 * glued every page into one line ("ARTICLE 1DEFINITIONS1.1 "Affiliate" means")
 * and dropped the spaces between separately drawn words. That broke heading
 * detection, keyword search and quote matching. Item positions tell us where
 * lines break and where words are apart.
 */

export interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
  /** [a, b, c, d, x, y]: x/y is the item's baseline origin in PDF units. */
  transform?: number[];
  width?: number;
  height?: number;
}

export function assemblePageText(items: PdfTextItem[]): string {
  let out = "";
  let prev: { x: number; y: number; right: number; size: number } | null = null;
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const t = item.transform;
    const x = t?.[4];
    const y = t?.[5];
    // Font size: the item's height, else the transform's vertical scale.
    const size: number = Math.abs(item.height || t?.[3] || prev?.size || 10) || 10;
    if (prev && typeof x === "number" && typeof y === "number") {
      const big = Math.max(size, prev.size);
      const dy = Math.abs(y - prev.y);
      // A smaller run slightly raised or lowered is a superscript/subscript
      // ("19th", footnote marks), not a new line.
      const script = Math.min(size, prev.size) < big * 0.85 && dy <= big * 0.75;
      const sameLine = dy <= big * 0.5 || script;
      if (!sameLine) {
        if (!out.endsWith("\n")) out += "\n";
      } else {
        const gap = x - prev.right;
        const needsSpace = gap > big * 0.12 || x < prev.x;
        if (needsSpace && out.length > 0 && !/\s$/.test(out) && !/^\s/.test(item.str)) out += " ";
      }
    }
    out += item.str;
    if (item.hasEOL && !out.endsWith("\n")) out += "\n";
    if (typeof x === "number" && typeof y === "number") {
      prev = { x, y, right: x + (item.width ?? 0), size };
    }
  }
  return out;
}
