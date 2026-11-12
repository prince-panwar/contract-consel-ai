#!/usr/bin/env python3
"""Build the accuracy benchmark's data file from CUAD v1.

CUAD (Contract Understanding Atticus Dataset, CC BY 4.0) is 510 public SEC
contracts in which lawyers highlighted the clauses for 41 review categories.
Download CUAD_v1.zip from https://zenodo.org/records/4595826, unzip it, then:

    python3 bin/eval-cuad-prepare.py <dir containing CUAD_v1/> > cuad-eval.json

The output has the 41 categories as target fields (name + CUAD's description)
and two fixed sets of contracts with their gold spans: "dev" for tuning and
"test" held out for the final numbers. Run with bin/eval-cuad.ts.
"""
import json
import os
import re
import subprocess
import sys

# Long contracts are where reading in parts, definitions and conflicts matter;
# a few medium and short ones keep the mix realistic. Named, so every run of
# this script yields the same sets.
DEV = [
    "GOOSEHEADINSURANCE,INC_04_02_2018-EX-10.6-Franchise Agreement",
    "Monsanto Company - SECOND A_R EXCLUSIVE AGENCY AND MARKETING AGREEMENT",
    "BERKELEYLIGHTS,INC_06_26_2020-EX-10.12-COLLABORATION AGREEMENT",
    "JOINTCORP_09_19_2014-EX-10.15-FRANCHISE AGREEMENT",
    "LOYALTYPOINTINC_11_16_2004-EX-10.2-RESELLER AGREEMENT",
    "BizzingoInc_20120322_8-K_EX-10.17_7504499_EX-10.17_Endorsement Agreement",
]
TEST = [
    "CERES,INC_01_25_2012-EX-10.20-Collaboration Agreement",
    "ZogenixInc_20190509_10-Q_EX-10.2_11663313_EX-10.2_Distributor Agreemen",
    "MANUFACTURERSSERVICESLTD_06_05_2000-EX-10.14-OUTSOURCING AGREEMENT",
    "PACIRA PHARMACEUTICALS",
    "IOVANCEBIOTHERAPEUTICS,INC_08_03_2017-EX-10.1",
    "ENERGYXXILTD_05_08_2015-EX-10.13-Transportation AGREEMENT",
    "PrecheckHealthServicesInc_20200320_8-K_EX-99.2_12070169_EX-99.2_Distributor Agreement",
    "TUNIUCORP_03_06_2014-EX-10-COOPERATION AGREEMENT",
]
QUESTION = re.compile(r'related to "(.+?)" that should be reviewed by a lawyer\. Details: (.+)$')


def page_count(pdf):
    out = subprocess.run(["pdfinfo", pdf], capture_output=True, text=True).stdout
    m = re.search(r"Pages:\s+(\d+)", out)
    return int(m.group(1)) if m else 0


def main(root):
    base = os.path.join(root, "CUAD_v1")
    data = {c["title"]: c for c in json.load(open(os.path.join(base, "CUAD_v1.json")))["data"]}
    pdfs = {}
    for d, _, files in os.walk(os.path.join(base, "full_contract_pdf")):
        for f in files:
            pdfs[os.path.splitext(f)[0].lower()] = os.path.abspath(os.path.join(d, f))

    rows = []
    for title, c in data.items():
        pdf = pdfs.get(title.lower())
        if not pdf:
            continue
        positives = sum(1 for q in c["paragraphs"][0]["qas"] if q["answers"])
        rows.append({"title": title, "pdf": pdf, "pages": page_count(pdf), "positives": positives})
    rows.sort(key=lambda r: (-r["pages"], -r["positives"], r["title"]))

    def find(prefix):
        return next(r for r in rows if r["title"].lower().startswith(prefix.lower()))

    sets = {"dev": [find(t) for t in DEV], "test": [find(t) for t in TEST]}

    fields = None
    out = {}
    for name, items in sets.items():
        out[name] = []
        for r in items:
            gold = {}
            fl = []
            for q in data[r["title"]]["paragraphs"][0]["qas"]:
                m = QUESTION.search(q["question"])
                fl.append({"name": m.group(1), "description": m.group(2).strip()})
                gold[m.group(1)] = [a["text"] for a in q["answers"]]
            fields = fields or fl
            out[name].append({"id": r["title"], "pdf": r["pdf"], "pages": r["pages"], "gold": gold})
    json.dump({"fields": fields, **out}, sys.stdout, indent=1)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
