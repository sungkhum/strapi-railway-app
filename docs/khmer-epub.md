# Prepare Khmer EPUB word boundaries at upload

New EPUB uploads and media replacements pass through a pinned Aksara Khmer
segmentation engine before storage, including its frequency dictionary, trained
boundary model, affix/title rules and Intl.Segmenter support. Expensive linguistic
work happens once on the server rather than on every phone.

The processor handles EPUBs declared `km`/`khm` or with at least half their visible
letters in Khmer, accommodating InDesign books mislabeled `en-US`. It edits only
Khmer prose. Other-language EPUBs return identical input bytes; other upload types
bypass preprocessing. Font/image bytes, IDs, links, authored word joiners and
zero-width spaces are retained. Chapters are serialized as XML and processed
books have an OPF version marker for byte-idempotence.

The existing upload service methods, arguments/options and provider errors are
preserved. Temporary prepared files are cleaned up after successful uploads or
failures. Invalid known Khmer XHTML and unsupported processing versions fail the
EPUB upload with a specific error rather than being saved as an unreadable book.

## Runtime and deployment

The upload extension loads the committed `scripts/khmer-epub/dist/processor.cjs`.
No root dependency, database schema change or extra production build command is
needed. Language assets are server files (about 1.9 MiB raw/427 KiB gzipped),
not SQL records or phone downloads. Preserve bundled third-party licenses.

One lazy worker processes EPUBs serially, with at most eight queued uploads,
a 120-second processing timeout and a 60-second idle shutdown. Its 512 MiB V8
old-generation limit is not a total-process RAM cap. Inputs beyond 50 MiB
compressed, 128 MiB unpacked, 32 MiB per resource or 4,000 resources upload
unchanged with a log message. Such Khmer books keep their original line breaking.

Deploy the paired Flutter reader PR for IDPF font decoding, known font repairs
and split-syllable shaping. Existing media items are not rewritten automatically:
reupload originals or replace them through the new hook, retaining sources for
future model upgrades. New uploads receive normal Strapi unique URLs. Replacement
URLs remain the same by Strapi design; purge any CDN cache when replacing a file.

## Development and validation

```sh
npm test
cd scripts/khmer-epub
npm ci --include=dev
npm run build
npm test
```

15 root tests (including existing tests) and 12 processor tests passed. Validation
covers foreign-language byte identity, valid XHTML, text/authored-break and
ID/link preservation, font/asset identity, OCF mimetype ordering, idempotence,
upload/replace wiring and cleanup/error behavior. The four complete supplied
books passed integrity checks and rendered in the paired browser reader tests.
XML-only validation is not full EPUBCheck certification; linguistic boundary
quality remains reviewable.

Reprocess an existing source manually:

```sh
node scripts/khmer-epub/cli.mjs original.epub prepared.epub
```

See [processor development notes](../scripts/khmer-epub/README.txt) for regeneration
and benchmarking commands and the pinned upstream revision/license.

## Measurements

The four complete books took about 8–22 seconds each on this Mac; an actual
worker upload path processed Confessions in about 27 seconds. Benchmark process
RSS peaked around 376 MiB; Strapi contributes additional memory. Original
server-prepared EPUB sizes changed by about −6% to +17%, roughly −188 KiB to
+95 KiB. Recorded reports are in `khmer-epub-preprocessing-benchmark.json` and
`khmer-epub-integrity.json`. Production hosting performance has not been measured.

The paired app reader, with its final font fixes, opened prepared books in
4.5–13.1 seconds at 390×700 and 4× desktop CPU slowdown. Large single-chapter
books and word-wrapper DOM size remain a rendering bottleneck. These are browser
proxy results; physical Android/iOS tests remain release checks. A future search
or copy UI must ignore generated zero-width spaces while retaining CFI offsets
against the stored rendition. Numeric saved page positions can shift.
