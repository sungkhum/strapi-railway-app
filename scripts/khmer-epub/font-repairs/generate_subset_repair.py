"""Reference generator for the pinned GSUB repair (FontTools 4.66.1).

Usage: python generate_subset_repair.py decoded-font.ttf output.json
This is a development tool; Flutter has no FontTools runtime dependency.
"""
import base64
import hashlib
import json
import sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables import otTables

source = Path(sys.argv[1])
digest = hashlib.sha256(source.read_bytes()).hexdigest()
repairs = {
    "fac48642ad42154d3dddaef51775b747ed41db24361c4bdbf56ffe0f5538351b": (
        5, [("uni17BF", "glyph00104"), ("uni17C0", "glyph00106"),
            ("uni17C4", "glyph00108"), ("uni17C5", "glyph00109")]
    ),
    "3d09a81e3b3b71525c5c32eed2a37f2826b09e05b915c2ce732bc60fd115b95e": (
        3, [("uni17C0", "glyph00183"), ("uni17C4", "glyph00188"),
            ("uni17C5", "glyph00190")]
    ),
}
if digest not in repairs:
    raise SystemExit("This generator only repairs the supplied, verified font subsets")

font = TTFont(source)
lookup, rules = repairs[digest]
subtable = font["GSUB"].table.LookupList.Lookup[lookup].SubTable[0]
for original, replacement in rules:
    rule = otTables.Ligature()
    rule.LigGlyph = replacement
    rule.CompCount = 1
    rule.Component = []
    subtable.ligatures[original] = [rule]

table = font["GSUB"].compile(font)
result = {
    "sourceSha256": digest,
    "gsub": base64.b64encode(table).decode("ascii"),
    "gsubBytes": len(table),
    "gsubSha256": hashlib.sha256(table).hexdigest(),
}
Path(sys.argv[2]).write_text(json.dumps(result, indent=2) + "\n")
print("Generated", len(table), "bytes; GSUB SHA-256", result["gsubSha256"])
