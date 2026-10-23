# Tibetan localization

The interface is fully bilingual (བོད་ཡིག / English), switched from the top-right of the
window. Tibetan is the default.

## Rules the app follows

| Rule | How it is enforced |
|---|---|
| Every menu item, button, label, tooltip, placeholder, dialog and message is translated | `npm run smoke:l10n` opens 35 screens in Tibetan (every menu, every property panel, every side tab, all export dialogs, shortcuts, about, recorder) and fails if any Latin-script word is visible outside the allowed codes below. Unit tests check that both languages have the same keys and that every key used in the code exists. |
| Tibetan uses Noto Serif Tibetan with a line height of at least 1.8 | `:lang(bo)` CSS; the same smoke run checks the computed font and line height of every piece of Tibetan text on every screen. |
| Tall stacks are never clipped | One-line labels that cut off overflow (property names, lane and clip names, library tiles, menu items) get a 2.3–2.6 line box, because Noto Serif Tibetan stacks reach about 2.25 em. The smoke run measures every element for clipping. |
| Tsheg and shad are kept exactly; text is never reformatted | User text (titles, callouts, captions, quiz text, lane names) is stored exactly as typed. Line breaking happens only after a tsheg, shad or space and never inside a syllable or stack; a line never starts with a shad or tsheg. The typewriter animation reveals whole syllables. SRT/VTT import/export keeps text byte-for-byte (unit tests). |
| Spelling and punctuation | `src/shared/i18n/lint.ts` (unit-tested): ང་། before shad, no shad after final ག/ཀ, no space after a tsheg, a space after a mid-text shad, no doubled tsheg/shad/vowel signs, no Latin ? ! , ; : beside Tibetan. All 522 strings pass. |
| One English term, one Tibetan term | A unit test fails when the same short English term gets different Tibetan in different places, except the deliberate cases listed in `tests/unit/tibetanLint.test.ts` (e.g. "left" = time left vs the left side). |
| Terms come from the IT dictionary | *English–Tibetan–Chinese Information Technology Dictionary* (2007). `docs/i18n/TIBETAN_TERMS.md` shows the source of every string: **D** exact entry, **C** built from dictionary terms, **N** new (needs review). |

## What stays in Latin script

Codes and units that Tibetan software normally leaves as they are: file formats (MP4, WebM,
GIF, MP3, WAV, M4A, SRT, VTT), codecs (H264, HEVC, AV1, VP9, AAC), units (fps, kbps, Mbps,
MB, dB, LUFS, Hz, px), GPU/API, key names in shortcuts (Ctrl, Shift…), the word "English"
on the language switch, and names that come from the operating system (window titles,
screen names) or from your own projects. Numbers use Western digits (as in times like
00:01:23); Tibetan digits ༠–༩ can be added as an option later if wanted.

Technical details of recording problems (from the operating system) are shown in small
English text after a translated explanation, so they can be sent to support.

Native file dialogs (Open, Save, Import, Choose folder) get translated titles and file-type
names; the buttons inside them (Open/Cancel) come from Windows/macOS in the system language.

## Reviewing the Tibetan

1. Open `docs/i18n/tibetan-review.csv` in Excel or LibreOffice (UTF-8). Terms that most need
   a native speaker (source **N**) are first.
2. Type corrections in the `reviewer_tibetan` column (and a reason in `reviewer_note` if useful).
3. Apply them: `python scripts/i18n/tibetan_terms.py import <your file>.csv`, then `npm test`.
4. Regenerate the report: `npm run i18n:report` (needs the glossary once:
   `python scripts/i18n/tibetan_terms.py glossary "<path to the dictionary .docx>"`; the extracted
   glossary stays in the ignored `.cache/` folder; the dictionary is not copied into the project).
5. Run `npm run smoke:l10n` to check every screen again.

Extensions can give their items Tibetan names: `"names": { "bo": "…" }` next to `"name"` in
`extension.json`.
