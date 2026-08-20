# wavfeed

A tool that ingests a Bandcamp fan's activity feed and re-presents it as a filterable,
de-noised, release-centric discovery view. This glossary is the ubiquitous language:
use these terms in code, docs, and UI copy.

## Language

### Bandcamp-side concepts

**Fan**:
A Bandcamp account that follows pages, buys, and wishlists. Both our users and the
people they follow are Fans.
_Avoid_: user (reserved for our own accounts), buyer, collector

**Page**:
An artist or label presence on Bandcamp — what a Fan follows. Bandcamp's internal
name is "band" (`band_id`); we say Page because labels aren't bands.
_Avoid_: band, artist account, label account

**Release**:
An album or single track published by a Page — Bandcamp's "tralbum" (`item_type`
album/track + `item_id`). The primary unit of our feed.
_Avoid_: tralbum, item, record

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

### Feed concepts

**Story**:
One atomic activity event from Bandcamp's feed: a Fan bought a Release, a Page
published a Release, a Fan wishlisted a Release. Has a type enum.
_Avoid_: event (overloaded), activity item, post

**Feed Item**:
The unit the UI renders: one Release with all its attached Stories aggregated
(who bought it, whether it's new, how many followed Fans engaged). Stories are
ingredients; Feed Items are the dish.
_Avoid_: card, entry, row

**Burst**:
Many Stories by one Fan in a short window (a buying spree). Collapsed into a single
expandable element so it can't drown the feed.
_Avoid_: spam, flood

**Group**:
A user-curated, named set of Pages ("minimal house labels") used as a feed filter.
Manual membership in v1.
_Avoid_: playlist, folder, tag (tags are Bandcamp's genre labels)

**Curated Feed**:
The server-curated view ("Feed" in the sidebar): editorial modules built from
accumulated Stories (multi-buyer Releases, fresh Page releases, review quotes).
The playground where new signals are tried before they earn structure.
_Avoid_: home, for-you, discover

**Timeline**:
The date-spine presentation of a collection: Stories grouped by calendar week
(Mon–Sun), single Stories at their action date, aggregates anchored at release
date (ADR-0011).
_Avoid_: history, activity log

**Network Overlap**:
The count of followed Fans who engaged with the same Release in a time window —
the v2 discovery signal ("4 people you follow bought this this month"). Computed
from the user's own accumulated Stories.
_Avoid_: social proof, trending

### Item state

**Seen / Unseen**:
Per-user, per-Feed-Item flag; the default view shows Unseen. Marking Seen is the
core triage gesture (proven in bcfeed).
_Avoid_: read/unread

**Starred**:
Per-user, per-Feed-Item bookmark for releases worth returning to.
_Avoid_: favorite, like, save
