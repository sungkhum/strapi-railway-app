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
