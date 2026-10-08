"""Rebuild pinned server font payloads with FontTools 4.66.1.

Usage: python generate_complete_fonts.py --font-dir /path/to/fonts \
    --font-dir /path/to/other/fonts --output ../src/font-repair-data.json
No downloads occur. Source and output SHA-256 hashes must match the registry.
"""
import argparse
import base64
import gzip
import hashlib
import json
from io import BytesIO
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

parser = argparse.ArgumentParser()
parser.add_argument('--font-dir', type=Path, action='append', required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
registry = json.loads(Path(__file__).with_name('complete-fonts.json').read_text())
payloads = {}
# Retain the independently pinned GSUB repairs when refreshing complete fonts.
output = json.loads(args.output.read_text())
for item in registry['fonts']:
    source = next((directory / item['sourceFilename'] for directory in args.font_dir
                   if (directory / item['sourceFilename']).is_file()), None)
    if source is None:
        raise SystemExit('Missing source font: ' + item['sourceFilename'])
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != item['sourceSha256']:
        raise SystemExit('Source font hash mismatch: ' + item['sourceFilename'])
    if item['weight'] is not None:
        font = TTFont(source, recalcTimestamp=False)
        instantiateVariableFont(font, {'wght': item['weight']}, inplace=True)
        font['head'].modified = item['modifiedTimestamp']
        buffer = BytesIO()
        font.save(buffer)
        data = buffer.getvalue()
    if hashlib.sha256(data).hexdigest() != item['replacementSha256']:
        raise SystemExit('Output hash mismatch; use the pinned FontTools version')
    payload = base64.b64encode(gzip.compress(data, mtime=0)).decode('ascii')
    payloads[item['replacementSha256']] = payload
output['complete'] = {item['sourceSha256']: item['replacementSha256'] for item in registry['subsets']}
output['payloads'] = payloads
args.output.write_text(json.dumps(output, indent=2) + '\n')
print('Generated', len(registry['fonts']), 'shared complete fonts')
