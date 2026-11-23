# Analytics dashboard

The local `analytics-dashboard` plugin adds an **Analytics** page to the Strapi
admin navigation. Its backend route requires both an authenticated administrator
and the plugin's `dashboard.read` RBAC permission. The menu link and page use the
same permission.

## Metrics available now

### Engagement

Each published book stores four lifetime counters:

- `views`
- `audio_plays`
- `book_opens`
- `downloads`

The PlovPit website calls the same `track-*` endpoints with `?source=web`. Those events
still count in the four totals, and also in `web_views`, `web_audio_plays`,
`web_book_opens` and `web_downloads`, so a report can tell the website from the app
(the app's share is the total minus the website's). The website sends `track-book-open`
when someone downloads the PDF and `track-download` for "download all audio".

The dashboard reports their totals, their share of all recorded actions, top
books, category/author/tag rankings, engagement distribution, top-10
concentration, and action-to-view ratios. It also surfaces books with strong
visibility but comparatively light follow-through. Ratios are directional
signals rather than a strict funnel because the counters are not session-based.

### Catalog

The current content model also supports:

- published and unpublished book inventory
- category, author, and tag inventory
- comparative engagement per book for audio, eBook, and featured segments
- featured and new-arrival flags
- category and author assignment coverage
- tag coverage
- English-description coverage
- eBook attachment coverage
- chapter or YouTube audio coverage
- purchase-link coverage

## Verified first-party analytics

The Flutter client can now send a timestamped, offline-safe event batch to:

```text
POST /api/analytics/events/batch
DELETE /api/analytics/installation
```

The 30-day dashboard distinguishes these events as **verified engagement**. It
shows active anonymous installations, book detail views, valid audio starts,
listening hours, eBook opens and completions, devotional engagement, a daily
trend, and top verified books. An audio start is sent only after three seconds
of playback. Listening time is calculated from authoritative player state, not
from button taps.

The live dashboard reads the latest 100,000 events in its 30-day window. If that
cap is reached, the window badge says `Latest 100k` so partial totals are never
presented as complete. Move this aggregation to database rollups before traffic
regularly reaches that threshold.

The event collection is hidden from the Strapi content manager. It stores only
an HMAC hash of the app-generated installation identifier. Set
`ANALYTICS_HASH_SECRET` to a long, random production secret; the first
`APP_KEYS` value is used as a fallback. Changing this secret breaks continuity
between old and new anonymous installations, but does not affect content.

`ANALYTICS_RETENTION_DAYS` defaults to 90 and cannot be set below 31. A daily
cron task removes older events at 03:00 UTC.

## Insights export

The reporting dashboard (`plovpit-insights`) reads daily aggregates from:

```text
GET /api/analytics/insights?from=YYYY-MM-DD&to=YYYY-MM-DD
Authorization: Bearer <INSIGHTS_EXPORT_TOKEN>
```

It only reads, and it is closed by default:

- It answers 404 until `INSIGHTS_EXPORT_TOKEN` is set to at least 32
  characters (`openssl rand -hex 32`). Give the same value to the dashboard.
- The token is accepted only in the `Authorization` header, never in the URL,
  and is compared in constant time.
- Strapi roles and API tokens cannot open it, so a permission ticked by
  mistake in the admin does not expose it.
- Ten wrong tokens a minute per address are answered, then 429. Valid calls
  are limited to thirty a minute, one at a time.
- Each export is logged with the caller's address, and refusals are logged
  until that address reaches its limit. Attempts are counted against
  `X-Real-IP`, which the platform's proxy sets, rather than the first
  `X-Forwarded-For` entry, which the caller controls.
- To revoke access, change or remove the variable and redeploy.

The range defaults to the last 30 days and may cover at most 124, so one request can
return everything the retention window still holds.

Postgres does the counting. The export runs a fixed set of grouped queries in one read-only
transaction (UTC, 50 second statement timeout), so raw events are never read into memory and
there is no event budget: the answer grows with the number of days and distinct labels, not
with how many events the app sent. Unit tests run against a real database when
`TEST_DATABASE_URL` is set (see `test/analytics-insights-db.test.js`).

For each UTC day it returns:

- `activeInstallations`, `activeInstallations7d`, `activeInstallations28d` (distinct
  installations that day and over the 7 and 28 days ending on it) and `newInstallations`
  (installations first seen that day in the events still retained; after the retention
  window passes, an installation that returns later counts as new again).
- `events`: the count of every event name, plus `listeningSeconds`, `audioResumes` and
  `searchesWithoutResults`.
- `platforms` and `appVersions`: distinct installations.
- `surfaces`, `mediaSources`, `contentTypes`, `outcomes` and `reasons`: event counts by each
  value, as `{ value: { eventName: count } }`.
- `progress`: audio and eBook progress milestones, `{ eventName: { percent: count } }`.
- `devotionals`: views and engagement per devotional.
- `books`: every published book that had activity, with views, audio starts and completions,
  eBook opens and completions, downloads, purchase clicks, bookmarks and listening seconds.
  `topBooks` repeats the first ten in the older, shorter shape.

Top-level fields: `schemaVersion` (2), `generatedAt`, `from`, `to`, `retentionDays` and
`catalog` (published book count, the lifetime counter totals, and `books`: each published
book with any count, its title and its four lifetime counters, most viewed first; the totals and each book also carry `web`, the website's share of each counter). Installation hashes are
used to count distinct installations and are never part of the response.

Free-text fields come from a public endpoint, so they are limited before they leave: only
published book identifiers are reported, `appVersion` and `sourceSurface` must look like a
short plain label, `devotionalId` like a plain identifier, and a day reports at most 30
distinct values of a free-text field (25 devotionals). Events with other values still count
toward the day's totals.

## Privacy contract

The endpoint accepts an allowlist of event names and properties. It rejects
unknown fields, batches larger than 25, invalid content identifiers, timestamps
older than 31 days, and future timestamps. In particular, the contract does not
accept:

- search terms
- bookmark notes
- names or email addresses
- advertising identifiers
- push notification contents
- IP addresses as event data

The Flutter app asks before collection, works normally after a decline, queues
approved events locally while offline, supports disabling analytics, and exposes
a server-side deletion action in Settings.

The deletion endpoint accepts `{ "installationId": "…" }` as JSON. The raw
identifier is intentionally kept out of the URL so it does not appear in normal
proxy access logs.

The public endpoint is rate-limited per IP in each running Strapi process.
Database uniqueness on `eventId` makes retries idempotent. For a horizontally
scaled deployment, place a shared edge rate limiter in front of Strapi as an
additional abuse control.

## Interpretation

Lifetime counters remain useful for historical direction but are still
unauthenticated cumulative counters. Use the verified 30-day block for current
product decisions. Anonymous installation counts are not people counts, and
completion rates can be affected by reinstalls, deletion, offline expiry, and
consent choice.
