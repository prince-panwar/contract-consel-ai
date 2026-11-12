import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  quoteMatchesSpan,
  scoreDocument,
  scoreField,
  sumTotals,
  totals,
  type ScoredPoint,
} from "../lib/eval/score";

const point = (field: string, quote: string, extra: Partial<ScoredPoint> = {}): ScoredPoint => ({
  field,
  quote,
  value: quote,
  verified: true,
  ...extra,
});

describe("quoteMatchesSpan", () => {
  test("a fragment of a long clause matches the clause", () => {
    const clause =
      "This Agreement shall be governed by and construed in accordance with the laws of the State of Delaware, without regard to its conflict of laws principles.";
    assert.equal(quoteMatchesSpan("governed by and construed in accordance with the laws of the State of Delaware", clause), true);
  });

  test("a short gold span inside a longer quote matches", () => {
    assert.equal(quoteMatchesSpan("This Agreement is dated as of January 1, 2020 between", "January 1, 2020"), true);
  });

  test("unrelated text does not match", () => {
    assert.equal(
      quoteMatchesSpan("Either party may terminate on ninety days notice", "governed by the laws of the State of New York"),
      false,
    );
  });

  test("ignores case and punctuation", () => {
    assert.equal(quoteMatchesSpan("NEW YORK; LAW", "new york law"), true);
  });

  test("empty strings never match", () => {
    assert.equal(quoteMatchesSpan("", "x"), false);
    assert.equal(quoteMatchesSpan("x", ""), false);
  });
});

describe("scoreField", () => {
  const gold = ["the laws of the State of Delaware"];

  test("hit when a prediction cites the gold clause", () => {
    assert.equal(scoreField("Governing Law", gold, [point("Governing Law", "laws of the State of Delaware")]).outcome, "hit");
  });

  test("wrong when every prediction cites other text", () => {
    assert.equal(scoreField("Governing Law", gold, [point("Governing Law", "payment within thirty days")]).outcome, "wrong");
  });

  test("hit if any of several predictions cites the gold clause", () => {
    const preds = [point("Governing Law", "payment within thirty days"), point("Governing Law", "State of Delaware")];
    assert.equal(scoreField("Governing Law", gold, preds).outcome, "hit");
  });

  test("missed when nothing is predicted for a present field", () => {
    assert.equal(scoreField("Governing Law", gold, []).outcome, "missed");
  });

  test("false alarm when the field is absent but predicted", () => {
    assert.equal(scoreField("Non-Compete", [], [point("Non-Compete", "shall not compete")]).outcome, "false-alarm");
  });

  test("correct-absent when absent and not predicted", () => {
    assert.equal(scoreField("Non-Compete", [], []).outcome, "correct-absent");
  });

  test("a not-found row is not a prediction", () => {
    const nf = point("Non-Compete", "", { source: "not-found" });
    assert.equal(scoreField("Non-Compete", [], [nf]).outcome, "correct-absent");
    assert.equal(scoreField("Governing Law", gold, [point("Governing Law", "", { source: "not-found" })]).outcome, "missed");
  });

  test("predictions for other fields are ignored", () => {
    assert.equal(scoreField("Governing Law", gold, [point("Parties", "laws of the State of Delaware")]).outcome, "missed");
  });
});

describe("totals", () => {
  test("precision, recall and accuracy over a document", () => {
    const gold = {
      A: ["alpha clause text"],
      B: ["beta clause text"],
      C: ["gamma clause text"],
      D: [],
      E: [],
    };
    const preds = [
      point("A", "alpha clause text"), // hit
      point("B", "something unrelated entirely"), // wrong
      // C missed
      point("D", "delta"), // false alarm
      // E correct absent
    ];
    const t = totals(scoreDocument(gold, preds), preds);
    assert.deepEqual([t.hit, t.wrong, t.missed, t.falseAlarm, t.correctAbsent], [1, 1, 1, 1, 1]);
    assert.equal(t.precision, 1 / 3);
    assert.equal(t.recall, 1 / 3);
    assert.equal(t.accuracy, 2 / 5);
    assert.equal(t.predictions, 3);
  });

  test("counts unverified quotes", () => {
    const preds = [point("A", "x", { verified: false }), point("A", "y")];
    assert.equal(totals(scoreDocument({ A: ["x"] }, preds), preds).unverifiedQuotes, 1);
  });

  test("sumTotals recomputes ratios from counts, not by averaging", () => {
    const a = totals(scoreDocument({ A: ["x y z"] }, [point("A", "x y z")]), []);
    const b = totals(scoreDocument({ A: ["x y z"], B: ["p q r"], C: ["s t u"] }, []), []);
    const s = sumTotals([a, b]);
    assert.equal(s.hit, 1);
    assert.equal(s.missed, 3);
    assert.equal(s.recall, 1 / 4);
  });
});
