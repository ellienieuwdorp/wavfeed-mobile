# wavfeed

wavfeed ingests a Bandcamp fan's activity feed and re-presents it as a de-noised,
release-centric view you can filter. This glossary is the ubiquitous language: use
these terms in code, docs, and UI copy.

## Language

### Bandcamp-side concepts

**Fan**:
A Bandcamp account that follows pages, buys, and wishlists. Both our users and the
people they follow are Fans.
_Avoid_: user (reserved for our own accounts), buyer, collector

**Page**:
An artist or label presence on Bandcamp, the thing a Fan follows. Bandcamp's
internal name is "band" (`band_id`); we say Page because labels aren't bands.
_Avoid_: band, artist account, label account

**Release**:
An album or single track published by a Page, Bandcamp's "tralbum" (`item_type`
album/track + `item_id`). The primary unit of our feed.
_Avoid_: tralbum, item, record

**Track**:
One entry in a Release's tracklist, a row of the release page's `trackinfo[]`
(`track_id`, `track_num`). What the player actually plays; its preview streams
as a signed mp3-128 URL that lives 24 hours (ADR-0015). A Release with
`item_type` track has exactly one.
_Avoid_: song, trackinfo entry (outside parser code)

**Identity Cookie**:
The `identity` session cookie from a logged-in bandcamp.com browser session. An
unscoped bearer credential for a Fan's account; the only auth Bandcamp's
undocumented endpoints need.
_Avoid_: token, API key, credentials

### Ingestion concepts

**Fetcher**:
Anything that makes authenticated requests to Bandcamp on a user's behalf and posts
the responses to the ingest API. The Poller and the Extension are both Fetchers.
_Avoid_: scraper, crawler

**Poller**:
The v1 server-side Fetcher: a worker that polls each user's feed on a schedule
using their stored Identity Cookie.
_Avoid_: cron job, scheduler (those are mechanisms, not the component)

**Extension**:
The planned browser-extension Fetcher that runs on the user's own machine, so the
server never holds their Identity Cookie. Gates the public launch.

**Raw Document**:
A verbatim Bandcamp API response stored at ingest time (endpoint name, payload,
fetched-at). Never deleted, never mutated; the source of truth everything else is
projected from.
_Avoid_: cache entry, blob

**Projection**:
The process (and result) of parsing Raw Documents into the normalized entities the
app queries. Re-runnable from scratch at any time.
_Avoid_: ETL, sync

**Sync Run**:
The tracked record of one user's initial catch-up: the deep feed walk plus
release-date enrichment the Poller runs after signup, with live counters the app
reads for progress. One open Sync Run per user at most; `sync_runs` in the schema.
On screen it is never named: the UI says things like "gathering your history".
_Avoid_: onboarding job, backfill task, import

### Feed concepts

**Story**:
One atomic activity event from Bandcamp's feed: a Fan bought a Release, a Page
published a Release, a Fan wishlisted a Release. Has a type enum.
_Avoid_: event (overloaded), activity item, post

**Feed Item**:
The unit the UI renders: one Release with all its attached Stories aggregated
(who bought it, whether it's new, how many followed Fans engaged). Stories are
ingredients; Feed Items are the dish.
_Avoid_: card, entry, row (as names for the concept; a UI element rendering
one may of course be a row or a card)

**Burst**:
Many Stories by one Fan in a short window (a buying spree). Collapsed into a single
expandable element so it can't drown the feed.
_Avoid_: spam, flood

**Group**:
A user-curated, named set of Pages ("minimal house labels") used as a feed filter.
Manual membership in v1. (The sidebar block that named them is hidden since
2026-08-21 behind a feature switch; nothing behind it is built yet.)
_Avoid_: playlist, folder, tag (tags are Bandcamp's genre labels)

**Curated Feed**:
The server-curated view ("Feed" in the sidebar): editorial modules built from
accumulated Stories (multi-buyer Releases, fresh Page releases, review quotes).
Where a new signal gets tried out before it earns a view of its own.
_Avoid_: home, for-you, discover

**Timeline**:
The date-spine presentation of a collection: Stories grouped by calendar week
(Mon to Sun), single Stories at their action date, aggregates anchored at their
release date (ADR-0011).
_Avoid_: history, activity log

**Network Overlap**:
The count of followed Fans who engaged with the same Release in a time window.
The v2 discovery signal ("4 people you follow bought this this month"), computed
from the user's own accumulated Stories.
_Avoid_: social proof, trending

### Item state

**Seen / Unseen**:
Per-user, per-Feed-Item flag. Views show everything and mark Unseen with the
accent dot; marking Seen is the core triage gesture (proven in bcfeed). An
unseen-only filter is already wired up but unused, waiting on the filter bar.
_Avoid_: read/unread

**Starred**:
Per-user, per-Feed-Item bookmark for releases worth returning to. (Hidden in
the UI since 2026-08-21 behind a feature switch; the state and routes stay.)
_Avoid_: favorite, like, save
