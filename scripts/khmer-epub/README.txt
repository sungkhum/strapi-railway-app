Khmer EPUB upload preprocessing

The Strapi upload extension processes new EPUB uploads and replacements before
storage. Aksara runs in one lazy worker, with up to eight queued uploads and a
120-second processing timeout. Idle workers stop after 60 seconds. Files are
queued by path so waiting uploads do not all allocate large buffers.

Khmer scope: declared km/khm metadata, or predominantly Khmer visible prose
(at least half of letters). This accommodates InDesign exports mislabeled en-US.
Only Khmer text is segmented; other EPUB languages return identical input bytes.
PDFs, images, audio and other uploads bypass processing.

The complete pinned Aksara frequency dictionary, boundary model, affix/title
rules and Intl.Segmenter support are retained. Editor text normalization is not
applied to books. Existing authored zero-width spaces and word joiners remain.
Whole words receive nowrap wrappers, except single Khmer character clusters
which cannot safely be split anyway. Original formatting ancestors are kept
whenever possible. Cross-style words are reconstructed without duplicate IDs.
Fonts and images remain byte-identical to the original upload. The Flutter
patch still handles IDPF font deobfuscation and legacy split vowel runs.

Prebuilt runtime is committed in dist/processor.cjs: no extra deployment command
or root dependency is needed. Retain THIRD_PARTY_LICENSES.txt and vendor/LICENSE.
To rebuild and test from this folder:
  npm ci --include=dev
  npm run build
  npm test

To preprocess an existing source without uploading:
  node scripts/khmer-epub/cli.mjs original.epub prepared.epub
To benchmark a folder, from this tool directory:
  node --expose-gc benchmark.mjs /path/to/originals /path/to/separate-output

An OPF version marker makes repeated processing byte-idempotent. Keep original
source EPUBs for future model upgrades; a prepared file from another version
requires the original source rather than guessing which invisible breaks were
authored. New uploads get Strapi's normal unique URL. Media replacements keep
the old URL by Strapi design, so purge any CDN cache when replacing a file.
Existing Media Library items are not rewritten automatically.

Preprocessing limits: 50 MiB compressed input, 128 MiB declared unpacked size,
32 MiB per resource and 4000 resources. Books exceeding these bounds upload
unchanged, with a log message; this preserves existing large uploads in other
languages. Such Khmer books retain their original line-breaking behavior.
The worker has a 512 MiB V8 old-generation limit. Invalid Khmer XHTML and unknown
processing versions fail the EPUB upload with a specific error. EPUB processing
runs away from Strapi's main event loop. No content-type or database migration
is required. Language data is a bundled server asset, not a SQL database and
not a phone download.

Validation includes character/author-break preservation, link and ID checks,
font/asset equality, XML parsing, OCF mimetype ordering, other-language identity,
Strapi upload/replace wiring, cleanup on errors, Flutter font/XML regressions,
cache invalidation and WebKit/Chromium reader checks. Reported 4x CPU browser
benchmarks simulate a slower device; physical phone testing is still needed
before release. The XML-only checks are not a complete EPUBCheck certification.

Search/copy: generated zero-width spaces are present in extracted text. A future
cross-word search or copy UI should ignore them while retaining CFI offsets in
the stored rendition. The current EPUB screen has neither UI. Existing saved
numeric page positions can shift with new fonts/breaks; generated CFIs resolve
against each prepared book, and the processor output remains stable by version.
