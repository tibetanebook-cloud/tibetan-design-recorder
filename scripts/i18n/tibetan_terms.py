"""Tibetan terminology tools (run from the project folder).

  python scripts/i18n/tibetan_terms.py glossary <IT dictionary .docx>
      Extract English / Tibetan / Chinese entries into .cache/it_glossary.tsv
      (the dictionary itself is not copied into the project).
  python scripts/i18n/tibetan_terms.py find <word> ...
      Look terms up in the glossary.
  python scripts/i18n/tibetan_terms.py report
      Write docs/i18n/TIBETAN_TERMS.md and docs/i18n/tibetan-review.csv: every UI
      string, its Tibetan, where the Tibetan came from (D = exact dictionary
      entry, C = built from dictionary terms, N = new; please review), and any
      spelling/punctuation lint. The CSV opens in Excel (UTF-8 with BOM); a
      reviewer fills in the "reviewer_tibetan" / "reviewer_note" columns.
  python scripts/i18n/tibetan_terms.py import <reviewed .csv>
      Apply the reviewer's Tibetan to src/shared/i18n/bo.json (exactly as typed,
      no reformatting), print what changed, then run `npm test`.

Source: English-Tibetan-Chinese Information Technology Dictionary (China
Tibetology Research Center, 2007).
"""
import csv
import json
import re
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
APP = Path.cwd()
CACHE = APP / ".cache"
TSV = CACHE / "it_glossary.tsv"
EN = APP / "src/shared/i18n/en.json"
BO = APP / "src/shared/i18n/bo.json"
DOC_MD = APP / "docs/i18n/TIBETAN_TERMS.md"
DOC_CSV = APP / "docs/i18n/tibetan-review.csv"

TIB = re.compile(r"[ༀ-࿿]")
CJK = re.compile(r"[㐀-鿿]")
TIB_LETTER = r"[ཀ-ྼ]"


# ---------------------------------------------------------------- glossary

def glossary(docx_path: str) -> None:
    import docx  # python-docx

    d = docx.Document(docx_path)
    lines = [p.text for p in d.paragraphs]
    for table in d.tables:
        for row in table.rows:
            lines.append("   ".join(c.text for c in row.cells))
    try:
        start = next(i for i, l in enumerate(lines) if l.strip() == "English – Tibetan – Chinese Dictionary")
    except StopIteration:
        start = -1
    out = []
    for line in lines[start + 1:]:
        s = line.strip()
        if not s:
            continue
        # Section III starts with Tibetan headwords; stop there.
        if TIB.match(s):
            break
        parts = re.split(r"\s{2,}|\t", s)
        if len(parts) < 2:
            continue
        eng = parts[0].strip()
        tib = next((p for p in parts[1:] if TIB.search(p)), "")
        chi = next((p for p in parts[1:] if CJK.search(p) and not TIB.search(p)), "")
        if eng and tib:
            out.append(f"{eng}\t{tib.strip()}\t{chi.strip()}")
    CACHE.mkdir(exist_ok=True)
    TSV.write_text("\n".join(out) + "\n", encoding="utf-8")
    print("entries:", len(out), "->", TSV)


def rows():
    if not TSV.exists():
        sys.exit("Run `glossary <dictionary .docx>` first.")
    return [l.split("\t") for l in TSV.read_text(encoding="utf-8").splitlines() if l]


def find(words: list[str]) -> None:
    rs = rows()
    for w in words:
        wl = w.lower()
        exact = [r for r in rs if r[0].lower() == wl]
        partial = sorted((r for r in rs if wl in r[0].lower() and r not in exact), key=lambda r: len(r[0]))
        print(f"## {w}")
        for r in exact + partial[:6]:
            print("  ", " | ".join(r))


# ---------------------------------------------------------------- report

def clean(s: str) -> str:
    return re.sub(rf"(?<={TIB_LETTER}) +(?={TIB_LETTER})", "", s).strip()  # stray mid-word spaces in the .docx


def core(s: str) -> str:
    return re.sub(r"[།་…\s]+$", "", clean(s)).replace(" ", "")


def flat(d, prefix=""):
    for k, v in d.items():
        if isinstance(v, dict):
            yield from flat(v, f"{prefix}{k}.")
        else:
            yield f"{prefix}{k}", v


def lookup(tree, key):
    for part in key.split("."):
        tree = tree[part]
    return tree


def lint() -> dict:
    r = subprocess.run(["node", "--experimental-strip-types", "--no-warnings", "scripts/i18n/lint-json.ts"], capture_output=True, text=True, encoding="utf-8", cwd=APP)
    if r.returncode != 0:
        print("lint failed:", r.stderr[:400])
        return {}
    return json.loads(r.stdout or "{}")


def report() -> None:
    en = json.loads(EN.read_text(encoding="utf-8"))
    bo = json.loads(BO.read_text(encoding="utf-8"))
    pairs = []
    for e, t, *_ in rows():
        for variant in re.split(r"[།]\s*", clean(t)):
            if variant.strip():
                pairs.append((e, core(variant)))
    by_tib: dict[str, list[str]] = {}
    for e, t in pairs:
        by_tib.setdefault(t, []).append(e)
    syllables = {s for _, t in pairs for s in t.split("་") if s}
    problems = lint()

    counts = {"D": 0, "C": 0, "N": 0}
    entries = []
    for key, english in flat(en):
        tib = lookup(bo, key)
        c = core(tib)
        if c in by_tib:
            kind, note = "D", "dictionary: " + ", ".join(sorted(set(by_tib[c]))[:3])
        else:
            sylls = [s for s in re.split(r"[་།\s…]+", c) if s and not re.match(r"[A-Za-z0-9(]", s)]
            unknown = [s for s in sylls if s not in syllables]
            parts = sorted({t for t in by_tib if len(t) > 2 and t in c}, key=len, reverse=True)[:3]
            if not unknown and parts:
                kind, note = "C", "built from dictionary terms: " + "; ".join(parts)
            else:
                kind, note = "N", "not in dictionary — please review" + (f" (new syllables: {' '.join(unknown)})" if unknown else "")
        counts[kind] += 1
        entries.append({"key": key, "english": english, "tibetan": tib, "source": kind, "note": note, "lint": ", ".join(problems.get(key, []))})

    header = f"""# Tibetan UI terms

Source: *English–Tibetan–Chinese Information Technology Dictionary* (China Tibetology
Research Center, 2007).

- **D** — exact dictionary entry ({counts['D']})
- **C** — built from dictionary terms ({counts['C']})
- **N** — not in the dictionary; needs a native speaker's review ({counts['N']})

Spelling fixes applied to the dictionary's Word text layer: stray spaces inside words
removed (e.g. ཁ་འ བྱེད → ཁ་འབྱེད); སྒེའྲ་ཁུང → སྒེའུ་ཁུང (window); སྒྲབ → སྒྲུབ (custom, progress).
The app name ནང་ཆེན་བཀྲིས་གློག་ཀླད་མཐོང་རིས་འཛིན་ཆས། was chosen by the owner.

To review: open `tibetan-review.csv` (Excel or LibreOffice), fill in `reviewer_tibetan`
for any term to change, then run `python scripts/i18n/tibetan_terms.py import <file>`.
Regenerate this page with `python scripts/i18n/tibetan_terms.py report`.

| Key | English | Tibetan | Source | Note |
|---|---|---|---|---|
"""
    md = [f"| `{x['key']}` | {x['english']} | {x['tibetan']} | {x['source']} | {x['note']}{' · lint: ' + x['lint'] if x['lint'] else ''} |" for x in entries]
    DOC_MD.parent.mkdir(parents=True, exist_ok=True)
    DOC_MD.write_text(header + "\n".join(md) + "\n", encoding="utf-8")

    order = {"N": 0, "C": 1, "D": 2}
    with DOC_CSV.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["key", "english", "tibetan", "source", "note", "lint", "reviewer_tibetan", "reviewer_note"])
        for x in sorted(entries, key=lambda x: (order[x["source"]], x["key"])):
            w.writerow([x["key"], x["english"], x["tibetan"], x["source"], x["note"], x["lint"], "", ""])
    print(counts, "lint problems:", len(problems), "->", DOC_MD.name, DOC_CSV.name)


# ---------------------------------------------------------------- import

def import_review(path: str) -> None:
    bo = json.loads(BO.read_text(encoding="utf-8"))
    changed = 0
    with open(path, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            new = row.get("reviewer_tibetan") or ""
            key = row.get("key") or ""
            if not new.strip() or not key:
                continue
            node = bo
            parts = key.split(".")
            for p in parts[:-1]:
                node = node.get(p, {})
            if parts[-1] not in node:
                print("unknown key, skipped:", key)
                continue
            # Exactly as the reviewer typed it: no trimming inside, no normalisation.
            new = new.strip("\r\n")
            if node[parts[-1]] != new:
                print(f"{key}: {node[parts[-1]]} → {new}" + (f"   ({row['reviewer_note']})" if row.get("reviewer_note") else ""))
                node[parts[-1]] = new
                changed += 1
    BO.write_text(json.dumps(bo, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(changed, "term(s) changed. Now run: npm test")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "glossary" and len(sys.argv) > 2:
        glossary(sys.argv[2])
    elif cmd == "find":
        find(sys.argv[2:])
    elif cmd == "report":
        report()
    elif cmd == "import" and len(sys.argv) > 2:
        import_review(sys.argv[2])
    else:
        print(__doc__)
