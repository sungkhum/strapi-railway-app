Server-side Khmer EPUB font repairs — fonts-v3

Twenty exact decoded font subsets from the four supplied books are identified by
SHA-256. Unknown subsets, unrelated fonts and other editions pass through intact.
The original typefaces are retained; chapter text and CSS are not replaced.

Ang DaunKeo (Confessions) and Khmer Wat Phnom (Family Life) keep their original
outlines/metrics. The pinned GSUB repairs restore four and three missing pstf
vowel entries, respectively. The earlier v2 Ang repair is upgraded as well.
Generate those tables with FontTools 4.66.1:
  python generate_subset_repair.py decoded-subset.ttf output.json
Fixtures and exact substitutions are recorded in test/fixtures/README.txt.

The other damaged subsets have malformed layout tables and/or missing output
glyph variants. They use six shared complete fonts: Content Bold 6.00, Content
Enhanced 3.30, Kantumruy Pro 1.002 regular and italic, Moul 6.00, and MiSans Khmer
Normal 1.200. Source metadata, versions and SHA-256 hashes are pinned in
complete-fonts.json. Original glyph outlines/metrics in every replaced subset
were checked against the matching complete font. The complete files also retain
variants absent from the subsets. Kantumruy Pro is instantiated at weight 400:
that matches the actual outlines and OS/2 weight of these supplied subsets,
including files whose export filenames say Medium/SemiBold. MiSans, Content,
Content Enhanced and Moul are copied without modifying their complete files.

The complete fonts are gzip-compressed into src/font-repair-data.json and
bundled into dist/processor.cjs. They decode lazily once per font in the server
upload worker and are shared across exact subset hashes. Total: 1,242,200 bytes
decoded and 303,027 bytes compressed (about 296 KiB); JSON/base64 adds encoding
overhead. This is server font payload size, not an APK/IPA size measurement.
Neither these fonts nor the repair routines are bundled into the phone app.
The OPF marker plovpit:khmer-fonts=fonts-v3 records completed font preparation.
Regression fixtures are development-only files in test/fixtures/.

Reproduce the complete-font payloads (no network/runtime dependency), from this
font-repairs directory:
  python -m pip install fonttools==4.66.1
  python generate_complete_fonts.py --font-dir /path/to/original/fonts \
    --font-dir /path/to/other/fonts --output ../src/font-repair-data.json
  cd ..
  npm run build
  npm test
Source filenames/hashes must match complete-fonts.json. Fixed timestamps make
variable-font instantiation reproducible. Regeneration retains the existing
pinned GSUB repairs. The runtime is checked in: deployments need neither
FontTools nor installed system fonts.

Font sources and notices:
- Content, Content Enhanced and Moul: publisher-provided local complete fonts;
  embedded metadata credits Danh Hong and states SIL Open Font License 1.1.
- Kantumruy Pro: https://github.com/sovichet/kantumruy-pro (SIL OFL 1.1).
- MiSans Khmer: https://hyperos.mi.com/font/en/download/
  Original archive: https://hyperos.mi.com/font-download/MiSans_Khmer.zip
  Its complete font is copied unchanged. The official license PDF is retained.
Copyright/license metadata are preserved in every complete font and copied into
the registry. Content Enhanced 3.30 has mixed upstream metadata: its copyright
field states OFL, while its license field contains a FontCreator home-edition
notice. Both notices are retained in the registry for provenance review; this
patch does not remove or reinterpret them. Original license documents are in
licenses/. Do not strip notices when updating font payloads.

Audit: all 58,475 actual Khmer syllable/adjacent-pair comparisons across 21 active
font resources match the complete references. All 27 audited resources have
parseable GSUB/GPOS/GDEF tables after preparation. Six have no assigned covered
syllables in the collected runs. This validates these books/versions; it is not
an automatic repair for arbitrary future exports or proof of every possible
Khmer sequence. The Kantumruy 1.20 subset uses a 1.3000 reference because its
matching older complete release was unavailable; all 68 used cases match.
