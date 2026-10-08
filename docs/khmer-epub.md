# Prepare Khmer EPUB fonts and word boundaries at upload

New EPUB uploads and media replacements now receive font repairs, syllable-run
repair and Aksara word segmentation before storage. Phones download the finished
EPUB and perform ordinary reader rendering; they no longer unzip/repack the book
or carry the repair-font payloads. The full pinned Aksara dictionary, boundary
model, affix/title rules and Intl.Segmenter integration remain on the server.

Scope is declared `km`/`khm` or at least half the visible letters in Khmer,
accommodating InDesign exports mislabeled `en-US`. Other-language EPUBs return
identical input bytes, including their fonts and encryption descriptors. Other
upload types bypass preprocessing. Khmer body Unicode text, authored breaks,
IDs, links and images are preserved; modified chapters are serialized as XML.

Standard IDPF embedding obfuscation is decoded using the declared unique
identifier. Only handled encryption records are removed. Resources protected by
unsupported algorithms retain their bytes; a font with additional unsupported
encryption fails rather than being rewritten. Known damaged fonts are selected
by exact decoded SHA-256: two subsets receive small GSUB repairs, while eighteen
subsets use six complete matching font editions. Unknown fonts pass through
after standard IDPF decoding. Font notices, provenance and regeneration tools are
in [font-repairs](../scripts/khmer-epub/font-repairs/README.txt), including the
preserved mixed upstream Content Enhanced license fields.

Outputs carry separate OPF markers for Aksara boundaries and `fonts-v3` repairs.
Complete outputs are byte-idempotent. The current boundary-only version can gain
fonts without rerunning segmentation or altering XHTML/CFI offsets. Other
processing versions require the original source rather than guessing which
invisible word breaks were authored.

## Runtime and rollout

The upload extension loads the committed `scripts/khmer-epub/dist/processor.cjs`.
No root dependency, database schema change or extra production build command is
needed. Language files are about 1.9 MiB raw/427 KiB gzipped. Font payloads total
303,027 bytes gzip-compressed/1,242,200 bytes decoded; the JSON/base64 runtime data
adds encoding overhead. These are bundled server assets, not SQL records or
phone app assets. Preserve third-party/font licenses with the distribution.

One lazy worker processes EPUBs serially, with at most eight queued uploads,
a 120-second processing timeout and a 60-second idle shutdown. Its 512 MiB V8
old-generation limit is not a total-process RAM cap. Inputs beyond 50 MiB
compressed, 128 MiB unpacked, 32 MiB per resource or 4,000 resources upload
unchanged with a log message. Such Khmer books receive neither font nor boundary
repairs, and the paired app has no automatic repair fallback.
Invalid Khmer XHTML, undecodable IDPF fonts and unsupported processing versions
fail with a specific upload error. Provider errors and normal service arguments
are preserved; temporary prepared files are cleaned up on success and failure.

Deploy this backend first. Reupload/replace existing original Khmer EPUBs before
releasing [Flutter PR #17](https://github.com/Vishwa-Jeet/plovpit-library/pull/17),
which removes phone-side repairs. Keep source originals for future model/font
upgrades. Existing media is not rewritten automatically. New uploads get normal
unique URLs; replacements keep their URL, so purge CDN caches and refresh offline
copies. Ordinary original local Khmer files must go through the CLI/upload hook
before opening with the updated app.

## Development and validation

```sh
npm test
cd scripts/khmer-epub
npm ci --include=dev
npm run build
npm test
```

15 root tests and 43 processor tests pass. Migrated font fixtures verify exact
source/output hashes, complete-font and table checksums, preserved outlines and
metrics, IDPF whitespace/short-font/error cases, unrelated encryption, non-Khmer
byte identity, boundary-only upgrades and the real upload worker/storage path.
The three paired app tests verify unchanged byte caching and cache invalidation.

All four original books passed complete-file integrity checks, preserving
Unicode text/authored breaks, IDs, links, images and non-markup assets. All 55
font resources are byte-identical to the previously reviewed app-prepared outputs;
the earlier 58,475-form Khmer font audit therefore still applies to these bytes.
Fresh browser checks exercise these server-only outputs. These checks do not
constitute full EPUBCheck certification; boundary quality remains reviewable.

```sh
node scripts/khmer-epub/cli.mjs original.epub prepared.epub
cd scripts/khmer-epub
node --expose-gc benchmark.mjs /path/to/originals /path/to/separate-output
node verify.mjs /path/to/originals /path/to/prepared [/path/to/reviewed-font-outputs]
```

## Measurements

The four-book run on this Mac took 8.4–24.3 seconds/book for the full pipeline.
The font stage itself took 16–47 ms/book. Observed benchmark-process RSS reached
about 336 MiB, plus Strapi's own memory in production. Prepared sizes ranged
from 691 KiB to 2.76 MiB, changing about −4% to +24% against original uploads.
Reports are `khmer-epub-preprocessing-benchmark.json` and `khmer-epub-integrity.json`.
Production hosting performance is unmeasured.

The paired reader's fresh Chromium measurements are in its
[EPUB docs](https://github.com/Vishwa-Jeet/plovpit-library/tree/codex/khmer-epub-reader/docs/epub-reader).
A 390×700 viewport and 4× desktop CPU slowdown simulate a slower device but are
not physical phone measurements. Large chapters and word-wrapper DOM size still
cost layout time; removing preparation does not remove normal font rendering.
Search/copy UIs should ignore generated zero-width spaces while retaining stored
CFI offsets. Numeric saved page positions can shift after preparation.
