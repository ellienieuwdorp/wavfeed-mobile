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
Anything that makes authenticated requests to Bandcamp on a user's behalf and lands
the responses as Raw Documents. The Poller and the Extension are Fetchers that post
them to the ingest API; the phone app is a Fetcher that keeps them in its own
store and posts nothing (ADR-0020).
_Avoid_: scraper, crawler

**Poller**:
The v1 server-side Fetcher: a worker that polls each user's feed on a schedule
using their stored Identity Cookie. It stopped at the switch (ADR-0022).
_Avoid_: cron job, scheduler (those are mechanisms, not the component)

**Extension**:
The browser-extension Fetcher (ADR-0018) that runs on the user's own machine and
fetches with the browser's own session, so the server never sees that user's
Identity Cookie. Built for Chrome and Firefox. Its only destination, `/ingest`,
went at the switch (ADR-0022), and its store listings wait on `docs/V2-PLAN.md`
section 8 open decision 3.

**Sweep**:
The band details sweep: reads each followed Page's whole discography from a
public endpoint, keyed on band (ADR-0017). It runs on each device for the Pages
its Fan follows (ADR-0020); the v1 box runs one shared queue for everyone until
the switch (ADR-0022). It owns catalog truth in `releases` where the feed owns
social truth in `stories`, which is how wavfeed knows about a release nobody has
bought yet. Not a Fetcher: it carries no Identity Cookie and makes no
authenticated request.
_Avoid_: crawler, scraper, spider

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
On the phone it is the first walk, a chain of gathers, with no `sync_runs` table.
On screen it is never named: the UI says things like "gathering your history".
_Avoid_: onboarding job, backfill task, import

**gather**:
One turn of the phone's fetching, whatever started it (open, refresh, timer).
The first walk is a chain of gathers that ends the Sync Run.
_Avoid_: sync, poll, fetch run

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

**Upcoming**:
A Release wavfeed holds whose release date is still ahead: announced, usually
pre-orderable, not out. Found by the band details sweep (catalog truth,
ADR-0017), through a pre-order purchase in the feed, or through a pre-order's
`new_release` entry once its release page dates it (task 0041); being Upcoming
needs no Story and has no actor. On screen it is the Upcoming shelf on the phone
(task 0037) and the Upcoming band at the top of New releases on the paused web
app, and a Release stops being Upcoming the day its release date arrives, and not before:
Tracks that play earlier are Drops, and the Release stays on the shelf.
That day is a GMT day, because Bandcamp writes every release date at midnight
GMT and that is when the record becomes buyable (ADR-0017, amended 2026-08-29);
it is the day the row and its week header name too.
_Avoid_: pre-release, coming soon, future release, announcement, preorder as a
synonym (`is_preorder` is Bandcamp's buyable state, which an Upcoming Release
usually but not always has)

**Drop**:
Tracks of an Upcoming Release becoming playable before its release day, often
one at a time as a label lets them out. A catalog fact the Projection derives
from Raw Documents, one per Release per GMT day, holding how many Tracks play
and how many there are (ADR-0017, amended 2026-09-29). Not a Story: it has no
actor, and Bandcamp's feed rewrites its `new_release` entry in place and never
says one happened. On the phone it is a row in the released weeks of New
releases on its day (task 0041).
_Avoid_: pre-release, single, teaser, early access, leak

**Group**:
A user-curated, named set of Pages ("minimal house labels") used as a feed filter.
Manual membership in v1. (The sidebar block that named them is hidden since
2026-08-21 behind a feature switch; nothing behind it is built yet.)
_Avoid_: playlist, folder, tag (tags are Bandcamp's genre labels)

**Curated Feed**:
The curated view ("Feed", the phone's first tab and the web sidebar's):
editorial modules built from accumulated Stories (multi-buyer Releases, fresh
Page releases, review quotes).
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
A v1 per-user, per-Feed-Item flag, gone in v2 (`docs/V2-PLAN.md` section 8);
the phone never had it. The web app's views show everything and mark Unseen
with the accent dot; marking Seen is the core triage gesture (proven in bcfeed). An
unseen-only filter is already wired up but unused, waiting on the filter bar.
(Paused on screen since 2026-08-21 behind a feature switch, DESIGN-UI
section 12; the state and routes stay.)
_Avoid_: read/unread

**Starred**:
A v1 per-user, per-Feed-Item bookmark for releases worth returning to, gone in
v2 (`docs/V2-PLAN.md` section 8); the phone never had it. (Hidden in the web
UI since 2026-08-21 behind a feature switch; the state and routes stay.)
Local to wavfeed; never leaves our database.
_Avoid_: favorite, like, save, wishlist

**Wishlist**:
Bandcamp's own save-for-later list on a Fan's account. The one thing wavfeed
writes to Bandcamp (ADR-0016): a press on the heart adds a Release or a Track
to the signed-in Fan's own wishlist, or removes it, through a **Wishlist
Action**. "Wishlisted" is the state Bandcamp confirmed, never a guess.
_Avoid_: starred, favorite, like, save, collect (Bandcamp's wire verb)

**Wishlist Action**:
One press of the heart on its way to Bandcamp (ADR-0016). The phone carries it
out itself: it writes to Bandcamp through the session and, on success, writes
the item into or out of `wishlist_items` (task 0036). On the v1 box it is a row
in `wishlist_actions` the API queues and the worker carries out, holding the
outcome it came back with. It is the press, not the item.
_Avoid_: job, task, queue entry, mutation

### Usage concepts

**Tally**:
One coded note that something happened in the app, with only closed codes and
bucketed counts as properties, sent to wavfeed's own backend only after the Fan
says yes (ADR-0021).
_Avoid_: event, record, signal, hit, ping, metric, telemetry

**Error Report**:
A scrubbed note of a thrown error: its name, a message with URLs, quoted strings
and long digit runs removed, minified frames, the screen code and a fingerprint.
Native crashes are not Error Reports; the stores hold those.
_Avoid_: crash report, exception, log

**Demo**:
The feed a phone with no Fan yet opens from the first screen's "Look around
first": real Releases read once from public label pages, bought and wishlisted
by made-up Fans, held in the store under its own Fan id until a sign-in
replaces it (task 0043). Nothing is asked, queued or sent while it is held
(task 0044). In the UI it is "a sample".
_Avoid_: demo account (the v1 box's, which went with the API at the switch,
ADR-0022), sample (the simulator rig's made-up data in `src/dev/sample.ts`),
guest mode

**Install**:
One copy of the app on one phone, known by a random id minted when sharing is
turned on and dropped when it is turned off or the store is removed. Shown to
the Fan as a six-character code.
_Avoid_: user, visitor, client, device id

**Install label**:
The author's own name for one Install on the Tally board, 1 to 32 characters
that never read as a sharing code, with a flag marking her own Installs as
mine (task 0050). The board shows it beside the sharing code and filters by
it; the daily digest names Installs by it and never by code (ADR-0024). It is
erased with its Install.
_Avoid_: name, tag ("label" alone stays a record label)

**Resolution**:
The author's "seen, done" on a check or an Error Report group the board says
needs a look, written for one environment or for all of them (task 0050).
From then on the item's rules count only what happened after it, so the item
stays hidden until it happens again and then reads as reopened; an undo takes
it back at once.
_Avoid_: dismissal, acknowledgement, snooze, closed
