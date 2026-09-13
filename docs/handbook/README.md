# One Concept engineering handbook

The [handbook source](ONE_CONCEPT_HANDBOOK.md) covers the mobile client, identity,
API, database, daily selection, generation, reminders, account emails, offline
state, releases and operational tradeoffs. It includes a seven-day study digest
and scenario answers. Chapters 40-47 discuss the proposed sustainable lifecycle
in issue #195, its benefits and open decisions, ending with before/after Q&A.
That design is described as future work, not an implemented feature.
The source snapshot and live-evidence limits are recorded
in chapter 39. Chapter 18 explains the current shared-count refill limitation;
it does not claim that the limitation has been fixed.

## Build the PDF

Requires Python 3, `reportlab`, and Liberation Sans/Mono TrueType fonts. From the
repository root:

```bash
python docs/handbook/build_pdf.py
```

Use `--font-dir /path/to/fonts` if fonts are not in a detected system directory.
The directory must contain `LiberationSans-Regular.ttf`,
`LiberationSans-Bold.ttf`, `LiberationSans-Italic.ttf`, and
`LiberationMono-Regular.ttf` (or `DejaVuSansMono.ttf`). The builder also recognizes
the bundled document runtime's font directory when available.

Default outputs are `output/pdf/one-concept-engineering-handbook.pdf` and
`tmp/pdfs/handbook-layout.json`. `--output` and `--qa-report` override these paths.
Generated PDF and QA files are not committed. The PDF includes selectable text,
clickable contents, bookmarks, pinned repository source links and vector diagrams.

## Update and verify

Each numbered top-level heading starts one chapter/page. The small Markdown
subset is paragraphs, numbered or hyphen list items, pipe tables, inline bold,
code and HTTPS links. `<!-- diagram: name -->` inserts a named vector diagram
from the builder. Keep the renderer's chapter/figure assertions and cover counts
aligned when changing structure. The source revision used for links is explicit
in the renderer and handbook; update it only after verifying the new source.

The builder measures text, tables and diagram labels, rejects overflow, and
records per-page font scale and remaining space. It does not replace visual QA.
Render every final page, inspect the images and verify extracted text and links:

```bash
pdftoppm -scale-to 1500 -png output/pdf/one-concept-engineering-handbook.pdf tmp/pdfs/page
git diff --check
```

Application tests are not needed for prose/layout edits. Changes to the app
itself follow the repository's normal validation and release requirements.
