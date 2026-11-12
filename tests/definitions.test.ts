import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { findDefinitions } from "../lib/extract/definitions";
import { documentChars, pageWindows } from "../lib/extract/windows";

const page = (pageNumber: number, text: string) => ({ pageNumber, text });

const DEFS = [
  "ARTICLE 1",
  "DEFINITIONS",
  '1.1 "Affiliate" means any entity that controls, is controlled by or is under common control with a Party.',
  '1.2 "Effective Date" means the date on which the last Party signs this Agreement.',
  '1.3 "Products" means the products listed in Exhibit A, as amended from time to time by written agreement of the Parties.',
  '1.4 "Territory" means the United States of America, its territories and possessions.',
].join("\n");

describe("findDefinitions", () => {
  test("finds the definitions section and stops at the next article", () => {
    const pages = [
      page(1, "MASTER SUPPLY AGREEMENT\nThis Agreement is made between Acme and Beta."),
      page(2, DEFS + "\nARTICLE 2\nSUPPLY\nSupplier shall supply the Products in the Territory."),
    ];
    const d = findDefinitions(pages);
    assert.ok(d);
    assert.match(d.text, /"Effective Date" means/);
    assert.match(d.text, /"Territory" means/);
    assert.doesNotMatch(d.text, /Supplier shall supply/);
    assert.deepEqual(d.pages, [2]);
  });

  test("follows a definitions section across pages", () => {
    const pages = [page(3, DEFS), page(4, '1.5 "Term" means the period set out in Section 9.\nARTICLE 2\nPRICE')];
    const d = findDefinitions(pages);
    assert.ok(d);
    assert.match(d.text, /"Term" means/);
    assert.deepEqual(d.pages, [3, 4]);
  });

  test("skips a table-of-contents entry and finds the real section", () => {
    const pages = [
      page(1, "TABLE OF CONTENTS\n1. Definitions 2\n2. Supply 5\n3. Price 7"),
      page(2, DEFS + "\nARTICLE 2\nSUPPLY"),
    ];
    const d = findDefinitions(pages);
    assert.ok(d);
    assert.equal(d.pages[0], 2);
  });

  test("collects inline definitions when there is no section", () => {
    const pages = [
      page(
        1,
        'This Agreement is entered into by Acme Corp., a Delaware corporation ("Licensor"), and Beta LLC ("Licensee"). "Licensed Patents" means the patents in Schedule 1.',
      ),
    ];
    const d = findDefinitions(pages);
    assert.ok(d);
    assert.match(d.text, /\("Licensor"\)/);
    assert.match(d.text, /"Licensed Patents" means/);
    assert.match(d.text, /p\.1/);
  });

  test("returns null for a document without definitions", () => {
    assert.equal(findDefinitions([page(1, "Plain letter with no defined terms at all.")]), null);
  });

  test("respects the size cap", () => {
    const long = Array.from({ length: 400 }, (_, i) => `1.${i} "Term${i}" means a long definition number ${i}.`).join("\n");
    const d = findDefinitions([page(1, "DEFINITIONS\n" + long)], 2_000);
    assert.ok(d);
    assert.ok(d.text.length <= 2_100, `length ${d.text.length}`);
  });
});

describe("pageWindows", () => {
  const pages = [page(1, "a".repeat(400)), page(2, "b".repeat(400)), page(3, "c".repeat(400)), page(4, "d".repeat(400))];

  test("one window when the whole document fits", () => {
    assert.deepEqual(pageWindows(pages, 10_000), [{ pageStart: 1, pageEnd: 4 }]);
  });

  test("splits on the character budget without splitting pages", () => {
    assert.deepEqual(pageWindows(pages, 900), [
      { pageStart: 1, pageEnd: 2 },
      { pageStart: 3, pageEnd: 4 },
    ]);
  });

  test("an oversized page gets its own window", () => {
    const big = [page(1, "x".repeat(50)), page(2, "y".repeat(5_000)), page(3, "z".repeat(50))];
    assert.deepEqual(pageWindows(big, 1_000), [
      { pageStart: 1, pageEnd: 1 },
      { pageStart: 2, pageEnd: 2 },
      { pageStart: 3, pageEnd: 3 },
    ]);
  });

  test("every page is covered exactly once", () => {
    const many = Array.from({ length: 37 }, (_, i) => page(i + 1, "w".repeat(100 + ((i * 37) % 300))));
    const ws = pageWindows(many, 1_500);
    const covered = ws.flatMap((w) => Array.from({ length: w.pageEnd - w.pageStart + 1 }, (_, k) => w.pageStart + k));
    assert.deepEqual(covered, many.map((p) => p.pageNumber));
  });

  test("empty document has no windows", () => {
    assert.deepEqual(pageWindows([], 1_000), []);
    assert.equal(documentChars([]), 0);
  });
});
