# PDF fonts

Drop two TTFs in this directory to enable non-Latin glyphs (Devanagari, Tamil,
Arabic, etc.) in generated prescription and bill PDFs:

- `NotoSans-Regular.ttf`
- `NotoSans-Bold.ttf`

Recommended source: <https://fonts.google.com/noto/specimen/Noto+Sans> →
"Get font" → download the static `.ttf` files (Regular and Bold).

If a TTF is missing, `PdfService` falls back to `Helvetica` (Latin only) and
emits a one-time warning. Override the paths via `PDF_FONT_PATH` and
`PDF_FONT_BOLD_PATH` if you keep the fonts elsewhere.

These files are intentionally not committed — they're large (~400 KB each)
and the choice of font is deployment-specific.
