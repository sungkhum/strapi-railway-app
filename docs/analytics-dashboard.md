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

## Important limitation

The four engagement fields are cumulative counters. They do not record when an
action happened, so date filters, daily trends, retention, unique users, sessions,
and campaign attribution cannot be calculated honestly from the existing data.

## Recommended next data layer

Add a small append-only `engagement-event` collection with:

| Field | Type | Notes |
| --- | --- | --- |
| `event_name` | enumeration | `book_viewed`, `audio_played`, `book_opened`, `ebook_downloaded` |
| `book` | relation | Related book |
| `occurred_at` | datetime | Server timestamp |
| `session_id` | hashed string | Optional, short retention, no raw user identifier |
| `source` | string | Optional app surface/referrer |
| `locale` | string | Optional app locale |

Keep the lifetime counters for fast reads, and insert a timestamped event in the
same tracking request. Once this is available, the dashboard can add honest
7/30/90-day trends, unique sessions, conversion funnels, and comparisons.

## Data-quality follow-up

The public tracking endpoints currently perform a read followed by an update.
Concurrent requests can overwrite each other's increments, and unauthenticated
traffic can inflate the totals. Before relying on the counters for high-stakes
decisions, use atomic database increments and add rate limiting or an ingestion
token appropriate for the client application.
