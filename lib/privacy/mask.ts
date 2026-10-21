// Mask personal identifiers before text is sent to an external LLM, and
// restore them in what comes back. Names of people and companies are NOT
// masked: extracting the parties is part of the job.
//
// Each distinct original string gets its own placeholder (⟦EMAIL_1⟧ …), so
// unmasking restores the exact original text. Detection favours precision:
// checksums where the format has one (card: Luhn, Aadhaar: Verhoeff), fixed
// structure (PAN, GSTIN, IFSC), and context words for formats that are just
// digits (bank accounts, passports).

export type PiiType =
  | "EMAIL"
  | "UPI"
  | "CARD"
  | "AADHAAR"
  | "GSTIN"
  | "PAN"
  | "IFSC"
  | "PHONE"
  | "ACCOUNT"
  | "PASSPORT";

interface Detector {
  type: PiiType;
  re: RegExp;
  // Which capture group holds the value (default: whole match).
  group?: number;
  valid?: (value: string) => boolean;
}

const OPEN = "⟦"; // ⟦
const CLOSE = "⟧"; // ⟧

function digits(s: string): string {
  return s.replace(/\D/g, "");
}

function luhn(num: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = num.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

// Verhoeff checksum (used by Aadhaar).
const V_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const V_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
function verhoeff(num: string): boolean {
  let c = 0;
  const rev = num.split("").reverse();
  for (let i = 0; i < rev.length; i++) c = V_D[c][V_P[i % 8][rev[i].charCodeAt(0) - 48]];
  return c === 0;
}

// Boundaries: not preceded/followed by a letter or digit, so we never mask
// part of a longer token.
const B = "(?<![\\p{L}\\p{N}])";
const E = "(?![\\p{L}\\p{N}])";

// Order matters: earlier detectors win when matches overlap. Labelled
// detectors come first: an explicit "A/c No." beats a Luhn-valid lookalike.
const DETECTORS: Detector[] = [
  {
    type: "EMAIL",
    re: new RegExp(`${B}[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}${E}`, "gu"),
  },
  {
    // UPI VPA: handle@psp (no dot in the provider part, unlike an email).
    type: "UPI",
    re: new RegExp(`${B}[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}(?![\\p{L}\\p{N}.@-])`, "gu"),
  },
  {
    // Ungrouped 12 digits only when labelled (order ids pass the checksum 1 in 10).
    type: "AADHAAR",
    re: new RegExp(`(?:aadhaar|aadhar|uid(?:ai)?)(?:\\s*(?:no|number|card))?\\.?\\s*[:#-]?\\s*([2-9]\\d{11})${E}`, "giu"),
    group: 1,
    valid: (v) => verhoeff(v),
  },
  {
    // Landline / other numbers only when labelled as a phone.
    type: "PHONE",
    re: new RegExp(
      `(?:tel(?:ephone)?|ph(?:one)?|mob(?:ile)?|fax|contact\\s+(?:no|number))\\.?\\s*(?:no\\.?|number|#)?\\s*[:\\-]?\\s*(\\(?\\d[\\d ()-]{6,16}\\d)${E}`,
      "giu",
    ),
    group: 1,
    valid: (v) => {
      const n = digits(v).length;
      return n >= 7 && n <= 15;
    },
  },
  {
    // Bank account numbers are plain digit runs; require an account label
    // shortly before so amounts and reference numbers are left alone.
    type: "ACCOUNT",
    re: new RegExp(
      `(?:a\\/?c|acct|account)(?:\\s*(?:no|number|num))?\\.?\\s*[:#.-]?\\s*(?:[\\p{L} ()]{0,25}?[:#-]\\s*)?(\\d{9,18}(?![\\d -]*\\d{2})|\\d{2,6}(?:[ -]\\d{2,6}){1,5}|\\d{9,18})${E}`,
      "giu",
    ),
    group: 1,
    // Unbroken run first (so a following number isn't swallowed), then the
    // grouped "0012 3456 7890" form, then any unbroken run.
    valid: (v) => {
      const n = digits(v).length;
      return n >= 9 && n <= 18;
    },
  },
  {
    type: "PASSPORT",
    re: new RegExp(`passport(?:\\s*(?:no|number))?\\.?\\s*[:#-]?\\s*([A-Z][0-9]{7})${E}`, "giu"),
    group: 1,
  },
  {
    type: "CARD",
    // Unbroken 13–19 digits, or the printed groupings (4-4-4-4[-3], Amex 4-6-5)
    // with one consistent separator; never digits glued from separate numbers.
    re: new RegExp(
      `${B}(?:\\d{13,19}|\\d{4}[ \\n-]\\d{4}[ \\n-]\\d{4}[ \\n-]\\d{4}(?:[ \\n-]\\d{3})?|\\d{4}[ \\n-]\\d{6}[ \\n-]\\d{5})${E}`,
      "gu",
    ),
    valid: (v) => {
      const d = digits(v);
      return d.length >= 13 && d.length <= 19 && /^[2-6]/.test(d) && luhn(d);
    },
  },
  {
    // Grouped 4-4-4 form, checksum-valid.
    type: "AADHAAR",
    re: new RegExp(`${B}[2-9]\\d{3}[ \\n-]\\d{4}[ \\n-]\\d{4}${E}`, "gu"),
    valid: (v) => verhoeff(digits(v)),
  },
  {
    type: "GSTIN",
    re: new RegExp(`${B}\\d{2}[A-Z]{5}\\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]${E}`, "gu"),
  },
  {
    // 4th character is the holder type (P person, C company, H HUF, F firm…).
    type: "PAN",
    re: new RegExp(`${B}[A-Z]{3}[ABCFGHJLPT][A-Z]\\d{4}[A-Z]${E}`, "gu"),
  },
  {
    type: "IFSC",
    re: new RegExp(`${B}[A-Z]{4}0[A-Z0-9]{6}${E}`, "gu"),
  },
  {
    // International (+CC …) or Indian mobile (optionally +91/0 prefixed).
    type: "PHONE",
    re: new RegExp(
      `${B}(?:\\+\\d{1,3}[ .\\n-]?(?:\\(\\d{1,4}\\)[ .\\n-]?)?\\d{2,5}(?:[ .\\n-]?\\d{2,5}){1,3}|(?:0)?[6-9]\\d{4}[ \\n-]?\\d{5}|[6-9]\\d{2}[ \\n-]\\d{3}[ \\n-]\\d{4})${E}`,
      "gu",
    ),
    valid: (v) => {
      const n = digits(v).length;
      return n >= 10 && n <= 15;
    },
  },
];

const anchoredCache = new WeakMap<Detector, RegExp>();
const ALNUM = /[\p{L}\p{N}]/u;

function shrinkToValid(d: Detector, text: string, start: number, end: number): number | null {
  let anchored = anchoredCache.get(d);
  if (!anchored) {
    anchored = new RegExp(`^(?:${d.re.source})$`, d.re.flags.replace("g", ""));
    anchoredCache.set(d, anchored);
  }
  for (let k = end - 1; k > start + 6; k--) {
    if (ALNUM.test(text[k] ?? "") || !ALNUM.test(text[k - 1])) continue; // must end a word
    const candidate = text.slice(start, k);
    if (anchored.test(candidate) && (!d.valid || d.valid(candidate))) return k;
  }
  return null;
}

const TYPES = "EMAIL|UPI|CARD|AADHAAR|GSTIN|PAN|IFSC|PHONE|ACCOUNT|PASSPORT";
// Bracketed (⟦EMAIL_1⟧, [EMAIL 1], ⟦ EMAIL-1 ⟧) or bare EMAIL_1 on word
// boundaries. Whitespace is only absorbed inside brackets so surrounding
// spacing is preserved.
const TOKEN_RE = new RegExp(
  `[${OPEN}\\[]\\s*(${TYPES})[ _-]?(\\d{1,4})\\s*[${CLOSE}\\]]|(?<![\\p{L}\\p{N}_])(${TYPES})_(\\d{1,4})(?![\\p{L}\\p{N}_])`,
  "gu",
);

export interface MaskResult {
  text: string;
  counts: Partial<Record<PiiType, number>>;
}

/**
 * A masking session: mask any number of texts, then unmask model output.
 * Reuse one session per LLM call (or per document) so the same value always
 * maps to the same placeholder.
 */
export class PiiMasker {
  private byValue = new Map<string, string>(); // original -> token
  private byToken = new Map<string, string>(); // "EMAIL_1" -> original
  private next = new Map<PiiType, number>();

  get size(): number {
    return this.byToken.size;
  }

  private tokenFor(type: PiiType, value: string): string {
    const existing = this.byValue.get(value);
    if (existing) return existing;
    const n = (this.next.get(type) ?? 0) + 1;
    this.next.set(type, n);
    const key = `${type}_${n}`;
    const token = `${OPEN}${key}${CLOSE}`;
    this.byValue.set(value, token);
    this.byToken.set(key, value);
    return token;
  }

  mask(text: string): MaskResult {
    const found: Array<{ start: number; end: number; type: PiiType; priority: number }> = [];
    DETECTORS.forEach((d, priority) => {
      // Collect candidates at every start position (not just non-overlapping
      // ones): a candidate that later loses an overlap, or fails validation,
      // must not hide a valid value next to it (e.g. "… 1234 2345-6789-0124").
      const re = new RegExp(d.re.source, d.re.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const value = d.group ? m[d.group] : m[0];
        const start = m.index + (d.group && value ? m[0].indexOf(value) : 0);
        if (value && (!d.valid || d.valid(value))) {
          found.push({ start, end: start + value.length, type: d.type, priority });
        } else if (value && !d.group) {
          // Greedy match ran into a neighbouring number and failed validation
          // ("+44 20 7946 0958 4111…"): retry shorter spans ending on a word
          // boundary that still match the whole pattern.
          const end = shrinkToValid(d, text, start, start + value.length);
          if (end !== null) found.push({ start, end, type: d.type, priority });
        }
        re.lastIndex = m.index + 1;
      }
    });
    // Resolve overlaps: earlier detector wins, then longer, then leftmost.
    found.sort(
      (a, b) => a.priority - b.priority || b.end - b.start - (a.end - a.start) || a.start - b.start,
    );
    // Accepted spans kept sorted by start; an overlap can only be with the
    // neighbours at the insertion point (binary search, not a full scan).
    const taken: Array<{ start: number; end: number; type: PiiType }> = [];
    for (const f of found) {
      let lo = 0;
      let hi = taken.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (taken[mid].start < f.start) lo = mid + 1;
        else hi = mid;
      }
      const prev = taken[lo - 1];
      const next = taken[lo];
      if ((prev && prev.end > f.start) || (next && next.start < f.end)) continue;
      taken.splice(lo, 0, f);
    }

    const counts: Partial<Record<PiiType, number>> = {};
    let out = "";
    let pos = 0;
    for (const t of taken) {
      out += text.slice(pos, t.start) + this.tokenFor(t.type, text.slice(t.start, t.end));
      counts[t.type] = (counts[t.type] ?? 0) + 1;
      pos = t.end;
    }
    return { text: out + text.slice(pos), counts };
  }

  /** Restore originals; tolerant of the model rewriting ⟦EMAIL_1⟧ as [EMAIL_1] etc. */
  unmask(text: string): string {
    if (this.byToken.size === 0 || typeof text !== "string") return text;
    return text.replace(TOKEN_RE, (whole, t1?: string, n1?: string, t2?: string, n2?: string) => {
      const original = this.byToken.get(`${t1 ?? t2}_${Number(n1 ?? n2)}`);
      return original ?? whole;
    });
  }

  /** Unmask every string inside a JSON-like value. */
  unmaskDeep<T>(value: T): T {
    if (typeof value === "string") return this.unmask(value) as T;
    if (Array.isArray(value)) return value.map((v) => this.unmaskDeep(v)) as T;
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, this.unmaskDeep(v)]),
      ) as T;
    }
    return value;
  }
}

/** Exposed for tests. */
export const _checksums = { luhn, verhoeff };

export const MASKING_INSTRUCTION =
  `Some personal identifiers in the text were replaced with placeholders such as ${OPEN}EMAIL_1${CLOSE} or ${OPEN}PHONE_2${CLOSE}. ` +
  `Treat each placeholder as the value it stands for and copy it exactly, including the ${OPEN} ${CLOSE} brackets, wherever that value belongs in your answer or quotes. Never invent placeholders.`;

export function maskingEnabled(): boolean {
  return (process.env.PRIVACY_MASK_PII ?? "true").toLowerCase() !== "false";
}
