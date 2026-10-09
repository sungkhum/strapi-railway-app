Verified InDesign subset regression fixtures (tests only; not runtime assets).
Original font metadata, copyright notices, outlines and metrics are retained.

ang-daun-keo-indesign-subset.ttf
Source: Confessions Khmer InDesign 4.7.epub
SHA-256: fac48642ad42154d3dddaef51775b747ed41db24361c4bdbf56ffe0f5538351b
Restore these one-component ligature entries in GSUB lookup 5 (pstf):
  0x17bf: uni17BF -> glyph00104
  0x17c0: uni17C0 -> glyph00106
  0x17c4: uni17C4 -> glyph00108
  0x17c5: uni17C5 -> glyph00109
Compiled GSUB SHA-256: 10f00b09409f3c807daf91f42d5151e57e7602f66b48944418a9d7994359bb05

khmer-wat-phnom-indesign-subset.ttf
Source: Family Life of Christian Leader -Khmer 4.2.epub
SHA-256: 3d09a81e3b3b71525c5c32eed2a37f2826b09e05b915c2ce732bc60fd115b95e
Restore these one-component ligature entries in GSUB lookup 3 (pstf):
  0x17c0: uni17C0 -> glyph00183
  0x17c4: uni17C4 -> glyph00188
  0x17c5: uni17C5 -> glyph00190
Compiled GSUB SHA-256: fd663976cfc07b24a18f3a990caded04a7c4ab99ea490921e6e69058620c9378

ang-daun-keo-v2-gsub.bin is the earlier two-rule repair table. It verifies
upgrading books already prepared by v2; it contains no glyph outlines.

font-layout-subsets.zip contains the other original decoded InDesign font subsets
used in regression tests. font-layout-manifest.json identifies every source by
book, resource and SHA-256 and pins the exact verified complete-font output.
These fixtures are not bundled into the processor runtime. The complete-font payloads and
license/provenance records are described in font-repairs/README.txt.
