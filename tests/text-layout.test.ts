import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assemblePageText, type PdfTextItem } from "../services/embed-server/src/text-layout";

// One text run: x/y baseline origin, width and font size like pdf.js reports.
const run = (str: string, x: number, y: number, width = str.length * 5, size = 10): PdfTextItem => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width,
  height: size,
});

describe("assemblePageText", () => {
  test("starts a new line when the baseline moves (pdf.js gives no hasEOL)", () => {
    const text = assemblePageText([run("ARTICLE 1", 72, 700), run("DEFINITIONS", 72, 686), run("1.1 Affiliate means", 72, 660)]);
    assert.equal(text, "ARTICLE 1\nDEFINITIONS\n1.1 Affiliate means");
  });

  test("inserts a space between separately drawn words on one line", () => {
    // "This" ends at x=92; "Agreement" starts 3 units later.
    const text = assemblePageText([run("This", 72, 700, 20), run("Agreement", 95, 700, 45)]);
    assert.equal(text, "This Agreement");
  });

  test("does not split a word drawn in touching pieces (kerning)", () => {
    const text = assemblePageText([run("Agree", 72, 700, 25), run("ment", 97.2, 700, 20)]);
    assert.equal(text, "Agreement");
  });

  test("keeps existing spaces and does not double them", () => {
    const text = assemblePageText([run("governed by ", 72, 700, 60), run("the laws", 140, 700, 40)]);
    assert.equal(text, "governed by the laws");
  });

  test("small baseline jitter (superscripts, mixed fonts) stays on the same line", () => {
    const text = assemblePageText([run("Section", 72, 700, 35), run("2", 110, 702, 5, 7), run("applies", 120, 700, 35)]);
    assert.equal(text.includes("\n"), false);
  });

  test("a raised superscript joins its line (19th, not 19 / th)", () => {
    const text = assemblePageText([run("made this 19", 72, 700, 55), run("th", 127, 704, 6, 6.5), run(" day of March", 134, 700, 60)]);
    assert.equal(text, "made this 19th day of March");
  });

  test("a column jump back to the left on the same baseline gets a space", () => {
    const text = assemblePageText([run("left cell", 300, 500, 45), run("right", 72, 500, 25)]);
    assert.equal(text, "left cell right");
  });

  test("honours hasEOL when a newer pdf.js provides it", () => {
    const items: PdfTextItem[] = [{ str: "one", hasEOL: true }, { str: "two" }];
    assert.equal(assemblePageText(items), "one\ntwo");
  });

  test("items without positions are concatenated as before", () => {
    assert.equal(assemblePageText([{ str: "a" }, { str: "b" }]), "ab");
  });

  test("an empty page is empty", () => {
    assert.equal(assemblePageText([]), "");
  });
});
