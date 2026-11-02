# Languages

- The English text is the key: `t('Tap tempo')`. Text passed to the shared UI components (Btn, Row, Card, Chip,
  Seg, Note, TopBar, Sheet, NavRow, SectionTitle) is translated inside them, so plain labels need no `t()`.
- Values go in `{{name}}` placeholders; plurals use `count` with `_one` / `_other` entries (English ones in `en.json`).
- Core builds some text at run time (trainer questions and results): it goes through `tr()` from `@ghostgrid/core`,
  which the app connects to `t()`.
- A missing line shows in English, so a new feature never breaks a language; it only needs its lines added.

Adding a language: copy `nl.json` to `xx.json`, translate the values, add it in `index.ts` (`LANGUAGES` and
`resources`), add `../../locales/xx.json` (iOS permission prompts) and list it under `locales` in `app.json`.
Check layouts with `GG_LANG=xx node tools/screenshots.js <web build> <out>`.
Drum words: have a drummer who speaks the language check them.
