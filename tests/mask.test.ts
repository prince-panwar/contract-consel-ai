import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { _checksums, PiiMasker } from "../lib/privacy/mask";

// ---------- helpers ----------

function withCheckDigit(base: string, check: (s: string) => boolean): string {
  for (let d = 0; d <= 9; d++) if (check(base + d)) return base + d;
  throw new Error("no check digit");
}
const AADHAAR_RAW = withCheckDigit("23456789012", _checksums.verhoeff); // 12 digits
const AADHAAR_SPACED = AADHAAR_RAW.replace(/(\d{4})(\d{4})(\d{4})/, "$1 $2 $3");
const AADHAAR_DASHED = AADHAAR_RAW.replace(/(\d{4})(\d{4})(\d{4})/, "$1-$2-$3");
const AADHAAR_BAD = AADHAAR_SPACED.slice(0, -1) + ((Number(AADHAAR_SPACED.slice(-1)) + 1) % 10);

const POSITIVES: Array<[string, string]> = [
  ["EMAIL", "john.doe+legal@firm.co.in"],
  ["EMAIL", "Priya_Sharma@Example.COM"],
  ["UPI", "rahul.k@okaxis"],
  ["UPI", "payee99@ybl"],
  ["CARD", "4111 1111 1111 1111"],
  ["CARD", "5500-0000-0000-0004"],
  ["CARD", "4012888888881881"],
  ["AADHAAR", AADHAAR_SPACED],
  ["AADHAAR", AADHAAR_DASHED],
  ["GSTIN", "27ABCPE1234F1Z5"],
  ["PAN", "ABCPE1234F"],
  ["PAN", "AAACR5055K"],
  ["IFSC", "SBIN0001234"],
  ["IFSC", "HDFC0ABCDEF"],
  ["PHONE", "+91 98765 43210"],
  ["PHONE", "+91-9876543210"],
  ["PHONE", "09876543210"],
  ["PHONE", "9876543210"],
  ["PHONE", "987-654-3210"],
  ["PHONE", "+1 (415) 555-2671"],
  ["PHONE", "+44 20 7946 0958"],
];

// Labelled values: the label stays, only the value is masked.
const LABELLED: Array<[string, string, string]> = [
  ["PHONE", "Tel: ", "011-2345 6789"],
  ["PHONE", "Fax No. ", "(022) 2659 1234"],
  ["PHONE", "Mobile: ", "98200 12345"],
  ["ACCOUNT", "A/c No. ", "123456789012"],
  ["ACCOUNT", "Account Number: ", "0012 3456 7890"],
  ["ACCOUNT", "account no: ", "50100123456789"],
  ["ACCOUNT", "Bank Account (Savings) - ", "123456789"],
  ["AADHAAR", "Aadhaar No: ", AADHAAR_RAW],
  ["PASSPORT", "Passport No. ", "K1234567"],
];

// Must never be masked: amounts, dates, clause numbers, references, ids that
// aren't personal, and lookalikes that fail checksums/structure.
const NEGATIVES = [
  "₹ 5,00,000",
  "INR 1,25,00,000",
  "Rs. 10,000/-",
  "USD 1,000,000.00",
  "21/10/2026",
  "2026-10-21",
  "21.10.2026",
  "10:30 hrs",
  "Clause 12.3.4",
  "Section 2026",
  "FY 2025-26",
  "INV-2026-000123",
  "PO No. 4500012345",
  "1234567890",
  "18% GST",
  "0.95% protocol fee",
  "5,476 MON",
  "Agreement No. ABC/2026/001",
  "CIN U74999DL2016PLC123456",
  "4111 1111 1111 1112", // Luhn-invalid
  AADHAAR_BAD, // Verhoeff-invalid
  "ABCDE1234F", // PAN with invalid holder type
  "Order ID 234567890123", // unlabelled 12 digits
  "SECTION 14 TERMINATION",
  "page 12 of 24",
  "30 (thirty) days",
  "support@", // incomplete email
];

// ---------- unit tests ----------

describe("detection", () => {
  for (const [type, value] of POSITIVES) {
    test(`masks ${type}: ${value}`, () => {
      const m = new PiiMasker();
      const text = `Contact ${value} for notices.`;
      const { text: masked, counts } = m.mask(text);
      assert.equal(counts[type as keyof typeof counts], 1, `expected 1 ${type} in: ${masked}`);
      assert.ok(!masked.includes(value), `value leaked: ${masked}`);
      assert.match(masked, new RegExp(`⟦${type}_1⟧`));
      assert.equal(m.unmask(masked), text);
    });
  }

  for (const [type, label, value] of LABELLED) {
    test(`masks labelled ${type}: ${label}${value}`, () => {
      const m = new PiiMasker();
      const text = `${label}${value}`;
      const { text: masked, counts } = m.mask(text);
      assert.equal(counts[type as keyof typeof counts], 1, `got ${JSON.stringify(counts)}: ${masked}`);
      assert.ok(masked.startsWith(label), `label altered: ${masked}`);
      assert.ok(!masked.includes(value), `value leaked: ${masked}`);
      assert.equal(m.unmask(masked), text);
    });
  }

  for (const value of NEGATIVES) {
    test(`leaves alone: ${value}`, () => {
      const m = new PiiMasker();
      const text = `The amount is ${value} as agreed.`;
      assert.equal(m.mask(text).text, text);
    });
  }

  test("does not mask inside longer tokens", () => {
    const m = new PiiMasker();
    for (const t of ["X9876543210Y", "ABCPE1234FG", "SBIN00012345", "ref:9876543210123456"]) {
      assert.equal(m.mask(t).text, t, t);
    }
  });

  test("GSTIN wins over the PAN embedded in it", () => {
    const { text, counts } = new PiiMasker().mask("GSTIN 27ABCPE1234F1Z5");
    assert.deepEqual(counts, { GSTIN: 1 });
    assert.equal(text, "GSTIN ⟦GSTIN_1⟧");
  });

  test("email is not also counted as UPI", () => {
    const { counts } = new PiiMasker().mask("write to a.b@corp.example.com");
    assert.deepEqual(counts, { EMAIL: 1 });
  });
});

describe("placeholders", () => {
  test("same value → same token; different values → different tokens", () => {
    const m = new PiiMasker();
    const { text } = m.mask("a@x.com, b@x.com, a@x.com, 9876543210, 9876543210");
    assert.equal(text, "⟦EMAIL_1⟧, ⟦EMAIL_2⟧, ⟦EMAIL_1⟧, ⟦PHONE_1⟧, ⟦PHONE_1⟧");
  });

  test("tokens are stable across multiple mask() calls on one session", () => {
    const m = new PiiMasker();
    assert.equal(m.mask("x a@x.com").text, "x ⟦EMAIL_1⟧");
    assert.equal(m.mask("y a@x.com b@x.com").text, "y ⟦EMAIL_1⟧ ⟦EMAIL_2⟧");
  });

  test("different spellings of the same number keep their own exact originals", () => {
    const m = new PiiMasker();
    const text = "Call +91 98765 43210 or +91-9876543210.";
    const { text: masked } = m.mask(text);
    assert.equal(masked, "Call ⟦PHONE_1⟧ or ⟦PHONE_2⟧.");
    assert.equal(m.unmask(masked), text);
  });

  test("masking already-masked text is a no-op", () => {
    const m = new PiiMasker();
    const once = m.mask("a@x.com 9876543210").text;
    assert.equal(m.mask(once).text, once);
  });

  test("sessions are isolated", () => {
    const a = new PiiMasker();
    const b = new PiiMasker();
    a.mask("secret@a.com");
    assert.equal(b.unmask("⟦EMAIL_1⟧"), "⟦EMAIL_1⟧");
  });
});

describe("unmasking model output", () => {
  const m = new PiiMasker();
  const source = "Notices: legal@acme.in, +91 98765 43210, PAN ABCPE1234F, A/c No. 123456789012.";
  m.mask(source);

  const variants: Array<[string, string]> = [
    ["⟦EMAIL_1⟧", "legal@acme.in"],
    ["[EMAIL_1]", "legal@acme.in"],
    ["⟦ EMAIL_1 ⟧", "legal@acme.in"],
    ["EMAIL_1", "legal@acme.in"],
    ["⟦EMAIL 1⟧", "legal@acme.in"],
    ["⟦EMAIL-1⟧", "legal@acme.in"],
    ["⟦EMAIL_01⟧", "legal@acme.in"],
    ["⟦PHONE_1⟧", "+91 98765 43210"],
    ["⟦PAN_1⟧", "ABCPE1234F"],
    ["⟦ACCOUNT_1⟧", "123456789012"],
  ];
  for (const [shape, original] of variants) {
    test(`restores ${shape}`, () => {
      assert.equal(m.unmask(`value: ${shape}.`), `value: ${original}.`);
    });
  }

  test("unknown or invented tokens are left as-is", () => {
    assert.equal(m.unmask("⟦EMAIL_9⟧ and ⟦CARD_1⟧"), "⟦EMAIL_9⟧ and ⟦CARD_1⟧");
  });

  test("ordinary text containing similar words is untouched", () => {
    const t = "The EMAIL clause and PHONE support; see PAN-India coverage.";
    assert.equal(m.unmask(t), t);
  });

  test("deep unmask of parsed JSON (arrays, nesting, non-strings)", () => {
    const out = m.unmaskDeep({
      dataPoints: [
        { field: "Notice Email", value: "⟦EMAIL_1⟧", quote: "Notices: ⟦EMAIL_1⟧, ⟦PHONE_1⟧", page: 3 },
        { field: "PAN", value: "[PAN_1]", quote: null, page: 1, verified: true },
      ],
    });
    assert.deepEqual(out, {
      dataPoints: [
        { field: "Notice Email", value: "legal@acme.in", quote: "Notices: legal@acme.in, +91 98765 43210", page: 3 },
        { field: "PAN", value: "ABCPE1234F", quote: null, page: 1, verified: true },
      ],
    });
  });
});

describe("round trip (randomised)", () => {
  const filler = [
    "The Service Provider shall", "pay ₹ 5,00,000", "within 30 days", "of invoice INV-2026-000123.",
    "Clause 12.3.4 applies.", "\n", "\n\n", "  ", "Governed by the laws of India.", "dated 21/10/2026",
    "\"quoted\"", "(a)", "18% GST", "page 4 of 24", "Section 2026", "—", "₹", "e.g.", "Rs. 10,000/-",
  ];
  const pii = [
    ...POSITIVES.map(([, v]) => v),
    ...LABELLED.map(([, l, v]) => `${l}${v}`),
  ];
  let seed = 42;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };

  test("mask → unmask returns the exact original, and no PII survives masking (2,000 docs)", () => {
    for (let i = 0; i < 2000; i++) {
      const parts: string[] = [];
      const used: string[] = [];
      const len = 5 + rand(25);
      for (let j = 0; j < len; j++) {
        if (rand(3) === 0) {
          const p = pii[rand(pii.length)];
          parts.push(p);
          used.push(p);
        } else {
          parts.push(filler[rand(filler.length)]);
        }
      }
      const doc = parts.join([" ", ", ", "; ", "\n"][rand(4)]);
      const m = new PiiMasker();
      const masked = m.mask(doc).text;
      assert.equal(m.unmask(masked), doc, `round trip failed for:\n${doc}`);
      for (const [, value] of POSITIVES) {
        if (used.includes(value)) assert.ok(!masked.includes(value), `leak of ${value} in:\n${masked}`);
      }
      for (const [, , value] of LABELLED) {
        if (used.some((u) => u.endsWith(value))) assert.ok(!masked.includes(value), `leak of ${value} in:\n${masked}\nfrom:\n${doc}`);
      }
      for (const safe of ["₹ 5,00,000", "INV-2026-000123", "21/10/2026", "Clause 12.3.4"]) {
        if (doc.includes(safe)) assert.ok(masked.includes(safe), `over-masked ${safe} in:\n${masked}\nfrom:\n${doc}`);
      }
    }
  });
});

// ---------- end to end through the real LLM client, with a fake provider ----------

describe("end to end: nothing leaves the box, results come back restored", () => {
  const requests: string[] = [];
  let server: http.Server;

  before(async () => {
    // Fake OpenAI-compatible endpoint: records what would have been sent out,
    // and answers like a model would, echoing placeholders in varied shapes.
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        requests.push(body);
        const user = JSON.parse(body).messages.find((m: { role: string }) => m.role === "user").content as string;
        const email = user.match(/⟦EMAIL_\d+⟧/)?.[0] ?? "none";
        const phone = (user.match(/⟦PHONE_\d+⟧/)?.[0] ?? "none").replace("⟦", "[").replace("⟧", "]");
        const pan = user.match(/⟦PAN_\d+⟧/)?.[0] ?? "none";
        const quoteLine = user.split("\n").find((l) => l.includes("Notices")) ?? "";
        const content = JSON.stringify({
          dataPoints: [
            { field: "Notice Email", value: email, quote: quoteLine.trim(), page: 1 },
            { field: "Notice Phone", value: phone, quote: quoteLine.trim(), page: 1 },
            { field: "Vendor PAN", value: ` ${pan.replace("_", " ")} `.trim(), quote: `PAN ${pan}`, page: 1 },
          ],
        });
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            id: "x", object: "chat.completion", created: 0, model: "fake",
            choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_API_KEY = "test";
    process.env.LLM_MODEL = "fake";
    process.env.LLM_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    process.env.PRIVACY_MASK_PII = "true";
  });
  after(() => server.close());

  const page = [
    "MASTER SERVICES AGREEMENT between Acme Legal LLP and Priya Sharma.",
    "Notices: legal@acme.in, +91 98765 43210, Aadhaar " + AADHAAR_SPACED + ".",
    "PAN ABCPE1234F; GSTIN 27ABCPE1234F1Z5; IFSC SBIN0001234; A/c No. 123456789012.",
    "Fees: ₹ 5,00,000 payable within 30 days of invoice INV-2026-000123.",
  ].join("\n");
  const secrets = ["legal@acme.in", "+91 98765 43210", AADHAAR_SPACED, "ABCPE1234F", "27ABCPE1234F1Z5", "SBIN0001234", "123456789012"];

  test("extraction pipeline", async () => {
    const { extractPass } = await import("../lib/extract/extractor");
    const points = await extractPass(
      [{ pageNumber: 1, text: page }],
      1,
      [{ name: "Notice Email" }, { name: "Notice Phone" }, { name: "Vendor PAN" }],
      [],
    );

    // 1) Nothing personal went over the wire; business content did.
    assert.equal(requests.length, 1);
    for (const s of secrets) assert.ok(!requests[0].includes(s), `LEAKED to provider: ${s}`);
    for (const s of ["Priya Sharma", "Acme Legal LLP", "₹ 5,00,000", "INV-2026-000123"]) {
      assert.ok(JSON.parse(requests[0]).messages.some((m: { content: string }) => m.content.includes(s)), `${s} should be sent`);
    }
    assert.ok(requests[0].includes("placeholders"), "masking instruction missing from system prompt");

    // 2) Results are restored to the real values, quotes verify against the page.
    const by = Object.fromEntries(points.map((p) => [p.field, p]));
    assert.equal(by["Notice Email"].value, "legal@acme.in");
    assert.equal(by["Notice Phone"].value, "+91 98765 43210");
    assert.equal(by["Vendor PAN"].value, "ABCPE1234F");
    assert.ok(by["Notice Email"].quote.includes("legal@acme.in") && by["Notice Email"].quote.includes(AADHAAR_SPACED));
    assert.ok(points.every((p) => p.verified), "restored quotes must verify against the original page");
    for (const p of points) assert.ok(!/⟦|⟧|EMAIL_|PHONE_|PAN_/.test(p.value + p.quote), `placeholder left in ${p.field}`);
  });

  test("masking can be switched off", async () => {
    process.env.PRIVACY_MASK_PII = "false";
    requests.length = 0;
    const { generateJson } = await import("../lib/llm/client");
    await generateJson({ system: "s", userMessage: page, schema: {}, maxTokens: 10, effort: "low" });
    assert.ok(requests[0].includes("legal@acme.in"));
    process.env.PRIVACY_MASK_PII = "true";
  });
});

describe("hard cases", () => {
  const cases: Array<[string, string[]]> = [
    // [text, secrets that must not survive]
    ["(legal@acme.in)", ["legal@acme.in"]],
    ["<9876543210>", ["9876543210"]],
    ["email:legal@acme.in;", ["legal@acme.in"]],
    ["\"ABCPE1234F\"", ["ABCPE1234F"]],
    ["ईमेल: legal@acme.in, फ़ोन: +91 98765 43210", ["legal@acme.in", "+91 98765 43210"]],
    ["Call +91 98765\n43210 today", ["98765\n43210"]],
    ["Card 4111 1111\n1111 1111 on file", ["4111 1111\n1111 1111"]],
    [`Aadhaar ${AADHAAR_SPACED.replace(" ", "\n")}`, [AADHAAR_SPACED.replace(" ", "\n")]],
    ["A/c No.\n123456789012", ["123456789012"]],
    ["legal@acme.in", ["legal@acme.in"]],
    ["9876543210", ["9876543210"]],
    ["IFSC:SBIN0001234/Branch", ["SBIN0001234"]],
    ["PAN-ABCPE1234F.", ["ABCPE1234F"]],
  ];
  for (const [text, secrets] of cases) {
    test(`no leak + exact round trip: ${JSON.stringify(text)}`, () => {
      const m = new PiiMasker();
      const masked = m.mask(text).text;
      for (const s of secrets) assert.ok(!masked.includes(s), `leaked ${JSON.stringify(s)} in ${JSON.stringify(masked)}`);
      assert.equal(m.unmask(masked), text);
    });
  }

  test("400-page contract masks quickly", () => {
    const page = "The Service Provider shall pay ₹ 5,00,000 within 30 days of invoice INV-2026-000123 dated 21/10/2026 under Clause 12.3.4. Contact legal@acme.in or +91 98765 43210. A/c No. 123456789012, IFSC SBIN0001234. ".repeat(16);
    const doc = Array.from({ length: 400 }, (_, i) => `<<<PAGE ${i + 1}>>>\n${page}`).join("\n");
    const m = new PiiMasker();
    const t = Date.now();
    const masked = m.mask(doc).text;
    const ms = Date.now() - t;
    assert.ok(ms < 3000, `took ${ms}ms for ${(doc.length / 1e6).toFixed(1)} MB`);
    assert.equal(m.unmask(masked), doc);
    console.log(`    ${(doc.length / 1e6).toFixed(1)} MB masked in ${ms} ms`);
  });
});
