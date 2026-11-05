# Instagram Cleanup — Design

- **Date:** 2026-11-05
- **Status:** Draft, pending approval
- **Owner:** Ignacio (@ignaguri)
- **Research:** vault note `01_Projects/Instagram-Cleanup/Research/Feasibility - Instagram web API.md` (endpoints verified live on 2026-11-05). Its key facts are restated below so this doc stands alone.

## Intent

Ignacio's main Instagram account (personal, private, ~2,200 followers / ~2,400 following) has accumulated people he doesn't know or doesn't remember. He wants to clean it up **once, maybe once a year**, by going through people one at a time, Tinder-style, and deciding for each: keep, unfollow them, remove them as a follower, or both.

The decision is his. The tool's job is to put the facts in front of him (who they are, whether the follow is mutual, how long ago it started, which people they have in common) and then carry out his decisions **slowly enough that the account never gets flagged**.

The people he most wants gone first: **people he follows who don't follow him back and he doesn't know.**

## Goals

1. Collect followers, following, and people-in-common once, slowly, into a local database. Resumable across browser restarts.
2. Swipe through local data at full speed with no Instagram calls in the hot path (except the picture refresh, below).
3. Carry out decisions via a rate-limited queue that stops hard at the first sign of a block.
4. Optionally enrich cards with follow dates from Instagram's data export.

## Non-goals

- Auto-deciding, scoring, or any rules engine. Ignacio explicitly doesn't want rules: "just leave that to me".
- Following people (except re-following as an undo), stories, likes, DMs.
- Chrome Web Store, auto-update, release pipeline. Built locally, loaded unpacked.
- Multiple accounts, cross-device sync, any server or backend.
- Long-term history across yearly runs. A new run starts fresh. *(My call.)*
- Downloading or storing profile pictures. Ignacio said no: store URLs only and refresh on failure.

## Anti-goals (failure even if it "works")

- **The account gets action-blocked or flagged.** This overrides every speed or convenience consideration. No "go faster" setting. No automatic retry on block signals. Collection and actions never run at the same time.
- Silent failure. When Instagram's internals change (they will, between yearly runs), the tool must say which endpoint failed and how, never pretend it worked.
- Mixing data from two accounts.

## Constraints

- **Chrome extension, Manifest V3.** A web app can't use the instagram.com session (httpOnly `sessionid`, SameSite, CORS). Meta's official APIs don't cover personal accounts or follower lists.
- **Undocumented web endpoints only.** Use only the calls the instagram.com web client itself makes. A direct call to an endpoint the site doesn't use (`/api/v1/users/{id}/info/`) returned 429 immediately.
- **Stack: same as immoscout-helper** (`~/Documents/Repos/reloader-immoscout`), cut down: TypeScript, Svelte 5 (runes), Vite, Tailwind v4 + bits-ui/shadcn-svelte primitives, Biome, npm. **Single package, no monorepo, no server.**
- **Lessons from immoscout-helper to avoid:** the UI grew by feel (its own `docs/ui-audit-2026-05.md` found ~56 colors, 9 font sizes). Define design tokens and a handful of primitives on day one. No premature abstraction (it built a 6-package multi-site layer before the second site existed). No DOM scraping of the host site: Instagram gives JSON.
- **Lessons to keep:** rate-limit state persisted in storage so it survives service-worker restarts. Centralized storage keys and constants. Tests on pure logic only, no UI render tests.

## Verified Instagram endpoints

All on `https://www.instagram.com`, cookies from the logged-in session. Headers: `X-IG-App-ID: 936619743392459`, `X-CSRFToken: <csrftoken cookie>`, `X-Requested-With: XMLHttpRequest`. The current user's id is the `ds_user_id` cookie.

| Purpose | Request | Notes |
|---|---|---|
| Followers | `GET /api/v1/friendships/{me}/followers/?count=12&search_surface=follow_list_page[&max_id=…]` | `users[]`, `has_more`, `next_max_id` (opaque cursor). Use count=12 like the site. |
| Following | `GET /api/v1/friendships/{me}/following/?count=12[&max_id=…]` | `next_max_id` is a numeric offset string. |
| People in common | `GET /api/v1/friendships/{them}/mutual_followers/?page_size=12` | Up to 12 users + `next_max_id` if there are more. **No total count.** Fetch the first page only. |
| Unfollow | `POST /api/v1/friendships/destroy/{them}/` | Seen in the site JS bundle, not exercised. Body includes `container_module` in the site's call. |
| Remove follower | `POST /api/v1/friendships/remove_follower/{them}/` | Seen in the site JS bundle, empty body. Not exercised. Irreversible from our side. |
| Follow (undo of unfollow) | `POST /api/v1/friendships/create/{them}/` | Seen in the site JS bundle. |

User object fields we use: `pk` (stable id), `username`, `full_name`, `profile_pic_url` (150px, signed, **expires**; the `oe` query param is a hex unix expiry), `is_private`, `is_verified`.

**Verify the write calls before relying on them.** The build plan must include a supervised first unfollow (on a throwaway target Ignacio picks) and a first remove-follower, capturing the exact request and response shapes and the error shapes.

## How it works

### The three parts

1. **Deck page:** an extension page (`deck.html`) opened in its own tab from the toolbar icon. All UI lives here. A full tab (not a popup or side panel) is also what later makes microphone access possible for voice.
2. **Pacer:** a single queue of Instagram requests, at most one in flight, with all state persisted so it survives restarts. Collection jobs, picture refreshes and actions all go through it. It has **one mode at a time**: `collecting` or `sending` (or paused).
   - **Collection timing runs in the deck tab** (`setTimeout` with the 2-4 s / 5-10 s delays). MV3 alarms can't go below 30 s, and keeping the service worker alive artificially isn't worth it. **The deck tab must stay open during collection.** Show a clear "keep this tab open" banner, and resume automatically from the persisted cursor when the tab reopens. *(My call: Ignacio leaves it running overnight anyway.)*
   - **Sending runs in the service worker** on `chrome.alarms` (30-90 s gaps fit), so the queue works with the deck tab closed.
3. **Instagram transport:** how a request actually reaches instagram.com with the session. **Spike this first:**
   - **Option 1:** `fetch` from the service worker or extension page with `host_permissions` for `instagram.com` (Chrome attaches cookies for permitted hosts). Risk: POSTs carry `Origin: chrome-extension://…`, which Instagram may reject.
   - **Option 2 (fallback):** the extension opens and manages its own pinned `instagram.com` tab, and a content script there performs the same-origin `fetch` on request.

   Choose whichever works for **both a GET and a POST**. Ignacio should never have to remember to keep a tab open.

### Account guard

On first collection, store `ds_user_id` and username with the database. On every pacer tick and on deck open, compare with the current cookie. On mismatch, stop everything and show "logged in as X, this cleanup belongs to Y". Offer "start a new cleanup for X" (wipes the DB) or nothing.

### Phase 1: Collection

Start from the deck page and leave it running. Progress view: phase, done/total, rough time left, current status, pause/resume.

1. **Lists:** page through followers and following (~400 requests total at count=12). Delay 2-4 s, randomized. *(My default.)*
2. **Relationships:** computed locally. `I follow` = in following; `follows me` = in followers. No `show_many` calls needed.
3. **People in common:** one `mutual_followers` request per person, delay 5-10 s randomized (~3,000 requests, about 4-8 h, meant to run overnight). Order: **"You follow, they don't follow back" first**, then "They follow, you don't", then mutuals. Swiping can start as soon as phase-1 lists are done. Cards whose people-in-common hasn't loaded yet say "loading later".

Store per person: id, username, full name, pic URL, private/verified, `iFollow`, `followsMe`, `mutuals` (up to 12 usernames + pic URLs + `hasMore`), export dates if loaded, decision state.

**Storage:** IndexedDB (a few thousand records plus mutuals is too big for `chrome.storage.local` without `unlimitedStorage`). Small pacer and settings state can live in `chrome.storage.local`. The builder picks the IndexedDB wrapper (e.g. `idb`).

### Phase 2: Swiping

**Layout** (validated with mockup option C): the card in the middle, a side column with the decks plus counts and the queue status (waiting, today's count against the cap, next send time, paused-and-why).

**Decks**, in this order by default, switchable from the side column:

1. **Not following you back:** you follow them, they don't follow you.
2. **Fans you don't follow back:** they follow you, you don't follow them.
3. **Mutual.**

Order within a deck is the builder's call. Oldest follow first when export dates exist is a reasonable default.

**Card:** picture (initials fallback), username, full name, private/verified badges, a relationship line ("You follow them · they don't follow you"), follow dates when available ("You followed: Mar 2019", "They followed: Jun 2021"), people in common ("Followed by anna, marc and 10 more", with "+" when `hasMore`, and "No people in common" stated explicitly), and an **Open profile** link (new tab).

**Actions:** the same keys everywhere, with unavailable ones disabled for that relationship. *(Proposed mapping, my call. Ignacio can change it.)*

| Key | Action | Available when |
|---|---|---|
| → | Keep | always |
| ← | Unfollow | I follow them |
| ↓ | Remove follower | they follow me |
| ↑ | Both | mutual |
| Z / Backspace | Undo last decision | history not empty |
| Enter | Open profile | always |

Buttons mirror the keys. A short slide animation, no drag-to-swipe. The remove-follower hint notes "can't be undone once sent". No confirmation dialogs, since they'd kill the pace.

**Input decoupling:** keyboard and buttons both dispatch one `decide(personId, decision)` function, so voice can plug in later without touching deck logic.

**Undo** (last ~20 decisions):
- Action still queued: cancel it.
- Unfollow already sent: queue a re-follow (`friendships/create`), which counts against the cap. For **private** accounts this only sends a follow request, so undo says "follow request sent, not restored", and the unfollow hint on private cards says "private: undo only sends a request". *(My call.)*
- Remove-follower already sent: can't undo. Show that.
- Keep: just revert.

**Picture refresh:** when an `<img>` fails (or `oe` is past), show initials and enqueue a high-priority, throttled refresh for that person only (visible card plus the next 2), through the pacer. Which endpoint gives a fresh URL is the builder's call, under the "only call what the site calls" rule. Re-fetching their first `mutual_followers` page doesn't help (it returns other people). If no clean option exists, initials are acceptable.

### The queue

- **Defaults (editable in Settings):** 100 actions per rolling 24 h, randomized 30-90 s apart. *(My defaults.)* "Both" counts as 2.
- **Never interleaved with collection.** Collecting and sending take turns, and Ignacio switches between them. Pausing collection lets the queue send. Resuming collection pauses the queue. People-in-common progress is resumable, and collection skips anyone whose unfollow or remove has already been sent. *(My call.)*
- **Runs** while Chrome is open, in the service worker, so it doesn't need the deck tab.
- **Hard stop** on HTTP 429, any `feedback_required` / `checkpoint_required` / `login_required` in the body, a redirect to a login or challenge page, or a non-JSON response. Pause the queue, persist the raw status and body excerpt, and show it on the deck page. No automatic resume. Only Ignacio resumes.
- **Other failures** (network error, 5xx): retry with backoff up to 3 times, then mark failed and keep going. *(My call.)* Unfollow and remove are idempotent.
- **Each action logs** status and timestamp so the deck can show "sent", "failed" or "queued".

### Export (optional)

Ignacio is requesting it now (JSON, all time, Followers and following only). A "Load export" button accepts the ZIP or loose JSON files at any time, including mid-swipe. Parse `connections/followers_and_following/followers_*.json` (may be split into `_1`, `_2`, …) and `following.json`, matching on username to set `theyFollowedAt` / `iFollowedAt` (unix seconds). **The exact JSON shape must be checked against his real export** (third-party guides disagree on folder paths and whether the username is in `string_list_data[].value` or `title`). Parse leniently and report how many entries matched. Unmatched people simply have no date.

### Failing loudly

All Instagram calls live in **one module** (`instagram.ts` or similar). Each call validates the response shape. On a mismatch it throws a typed error naming the endpoint, the status and what was missing. The deck shows these errors plainly. This is the main defence against "it broke since last year".

### Settings

A small section: daily cap, delay range, pause/resume, "Start a new cleanup" (wipe the DB, with confirmation), plus a log of the last ~50 Instagram requests (endpoint, status, time) for debugging.

## After the MVP: voice commands

After the MVP above works, add voice: say "keep", "delete"/"unfollow", "remove", "both", "undo", "back" instead of pressing keys. The likely route is the Web Speech API (`webkitSpeechRecognition`) in the deck tab, which can prompt for microphone access because it's a full tab. Prefer on-device recognition if the Chrome version supports it (otherwise Chrome sends audio to Google's servers). Mention this in the UI. The MVP's `decide()` decoupling is what makes this a contained addition. **Not part of the MVP plan.**

## Left to the builder

- Transport choice after the spike (Option 1 vs 2).
- IndexedDB wrapper, file layout, component breakdown, design tokens.
- Order within a deck.
- Picture-refresh endpoint (or initials-only).
- Exact visual design, within: one screen, calm, keyboard-first, tokens from day one.
- Tests: pure logic only (pacer and rate limit, export parsing, relationship and deck building, account guard). No UI render tests.

## Success

Ignacio loads the extension, starts collection in the evening, swipes the "not following you back" deck the next day in one or two sittings, and over the following week or two the queue works through the cuts without a single action block. A year later he wipes the DB and does it again. If Instagram changed something, the tool says exactly what.
