# Instagram Cleanup MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Manifest V3 Chrome extension that collects Ignacio's Instagram followers/following (plus people in common) into IndexedDB, lets him swipe through them in an extension tab with the keyboard, and sends unfollow/remove actions through a capped, block-aware queue.

**Architecture:** Three runtime contexts. The **deck tab** (`deck.html`, Svelte 5) holds all UI and runs collection with `setTimeout` pacing. The **service worker** sends queued actions on `chrome.alarms`. A single **Instagram module** (`src/instagram/`) builds requests, sends them through a transport chosen by a spike in Task 2, and validates every response. State lives in IndexedDB (via `idb`), shared by the deck tab and the service worker. Pure logic (deck building, decisions/undo, pacing, export parsing, account guard, response parsing) lives in `src/core/` and `src/instagram/parse.ts` and is unit-tested.

**Tech Stack:** TypeScript 5, Svelte 5 (runes), Vite 6, Tailwind v4 + bits-ui, `idb` 8, `jszip` 3, Vitest 4, Biome 2, npm.

**Spec:** `docs/superpowers/specs/2026-11-05-ig-cleanup-design.md`. Read it before starting. This plan implements everything in it except "After the MVP: voice commands".

**Stop-and-ask protocol:** If at any step you encounter state that contradicts the plan — file missing, function signature differs, test passes when expected to fail, unfamiliar code in target lines, dependency version unavailable, or any expectation in this plan does not match reality — STOP. Do not improvise, do not work around it, do not pick the closest interpretation. Report the discrepancy and wait for guidance.

**Pace:** After each task, run `npm run check && npm test && npm run build`, report the output, and **wait for Ignacio's explicit "go"** before starting the next task. Do not chain tasks.

## Global Constraints

- Only call the Instagram endpoints listed in the spec's "Verified Instagram endpoints" table. Never call `/api/v1/users/{id}/info/` or any other endpoint.
- Headers on every Instagram request: `X-IG-App-ID: 936619743392459`, `X-CSRFToken: <csrftoken cookie>`, `X-Requested-With: XMLHttpRequest`.
- Page sizes: lists `count=12`; mutuals `page_size=12`, first page only.
- Collection delays: lists 2000-4000 ms; mutuals 5000-10000 ms; uniformly random.
- Queue defaults: 100 actions per rolling 24 h; 30-90 s between sends, uniformly random; "both" counts as 2.
- Block signals (stop the queue/collection, never auto-retry, never auto-resume): HTTP 429; body contains `feedback_required`, `checkpoint_required` or `login_required`; final response URL path starts with `/accounts/login` or `/challenge`; response body is not JSON.
- Retryable failures (network error, HTTP 5xx): up to 3 attempts total, then mark the action `failed`.
- Collecting and sending never run at the same time.
- No UI render tests. Tests cover pure logic only.
- No Claude attribution in commits (no `Co-Authored-By` trailer).
- Code style: braces on every `if`/`else` body; descriptive names; `clsx` for conditional classNames; short comments that explain why only.

## Review Focus

1. **Session expires mid-collection** (Instagram redirects to the login page): collection must stop with a visible "logged out" error, not loop or record empty pages as "done". Test: `detectBlock` on a final URL of `/accounts/login/` returns `login_redirect` (Task 4).
2. **Following list shifts during paging** (offset cursor, people follow/unfollow meanwhile): duplicates must not create duplicate cards. Test: `mergeListPage` upserts by `pk` (Task 6).
3. **Deck tab closed mid-people-in-common and reopened next day:** resumes at the next person without re-fetching finished ones. Test: `nextMutualsTarget` skips people with `mutualsFetchedAt` set (Task 9).
4. **Undo pressed while that action is being sent:** must not claim "cancelled". Test: `planUndo` for status `sending` returns the same as `sent` (Task 6).
5. **Export usernames that no longer match** (renamed accounts, deleted accounts): parsed without crashing, counted as unmatched. Test: `applyExportDates` reports `unmatched` count (Task 8).

## Open Questions Resolved

- **Question:** Which dependency versions?
  **Decision:** The majors from immoscout-helper, which are known to work together: `svelte@^5`, `vite@^6`, `@sveltejs/vite-plugin-svelte@^5`, `tailwindcss@^4.2`, `@tailwindcss/vite@^4.2`, `bits-ui@^2.18`, `vitest@^4.1`, `@biomejs/biome@^2.4`, `typescript@^5.7`, `svelte-check@^4`, `@tsconfig/svelte@^5`, `@types/chrome@^0.0.300`, plus `idb@^8`, `jszip@^3.10`, `clsx@^2`, `tailwind-merge@^3`.
  **Why:** Newer majors exist (vite 8, plugin-svelte 7, vitest 5), but mixing them is untested here, and the plugin-svelte 5 peer range is `vite ^6`.
  **If wrong:** STOP and ask. Do not continue with a different choice.

- **Question:** Single package or monorepo?
  **Decision:** Single package at the repo root, `src/` layout.
  **Why:** Spec: "Single package, no monorepo, no server."
  **If wrong:** STOP and ask.

- **Question:** How does a request reach Instagram?
  **Decision:** Decided by the Task 2 spike. Option 1 is direct `fetch` from extension contexts with `host_permissions` + `credentials: 'include'`. Option 2 is relaying through a content script in an extension-managed pinned instagram.com tab. Both sit behind `igFetch(req: IgRequest): Promise<IgRawResponse>` in `src/instagram/transport.ts`, and the spike outcome is recorded in `docs/transport-decision.md`.
  **Why:** The spec leaves this to the spike.
  **If wrong:** If neither option passes both a GET and a POST, STOP and ask.

- **Question:** What POST does the spike use, without doing anything destructive?
  **Decision:** `POST /api/v1/friendships/show_many/` with `user_ids=<own ds_user_id>`. It's read-only and the web client calls it.
  **Why:** We need a POST that changes nothing.
  **If wrong:** If `show_many` fails only because of missing `fb_dtsg`/`jazoest`, STOP and ask. Do not try to scrape those tokens.

- **Question:** Exact body for unfollow / remove / follow?
  **Decision:** Captured from the real web client in Task 3 ([HUMAN]), saved as fixtures in `src/instagram/__fixtures__/writes.json`, and replicated exactly in `src/instagram/endpoints.ts`.
  **Why:** The spec only has the paths (from the JS bundle). The site's unfollow body includes `container_module`.
  **If wrong:** If the captured bodies need `fb_dtsg`/`jazoest`, STOP and ask.

- **Question:** How do we read the session (user id, CSRF token)?
  **Decision:** `chrome.cookies.get({ url: 'https://www.instagram.com', name })` for `ds_user_id` and `csrftoken`. This needs the `cookies` permission.
  **Why:** It works from both the service worker and the deck tab, regardless of transport.
  **If wrong:** STOP and ask.

- **Question:** Storage layout?
  **Decision:** IndexedDB database `ig-cleanup`, version 1, via `idb`. Stores: `people` (keyPath `pk`), `actions` (keyPath `id`, autoIncrement, index `status`), `requestLog` (keyPath `id`, autoIncrement), `meta` (keyPath `key`). No `chrome.storage` usage.
  **Why:** One store shared by the deck tab and the service worker. The spec allows `chrome.storage.local` for small state, but one storage mechanism is simpler.
  **If wrong:** STOP and ask.

- **Question:** How to keep two deck tabs from running collection twice?
  **Decision:** On deck load, `chrome.tabs.query({ url: chrome.runtime.getURL('deck.html') })`. If another deck tab exists, focus it and close the current tab.
  **Why:** The simplest single-runner guarantee.
  **If wrong:** STOP and ask.

- **Question:** Mode model?
  **Decision:** `meta.mode: 'collecting' | 'sending' | 'paused'`, plus `meta.block: BlockInfo | null`. A non-null `block` stops everything until Ignacio clicks Resume (which clears it). Collection finishing switches the mode to `sending`.
  **Why:** The spec says "one mode at a time", collecting and sending take turns, and a block waits for him.
  **If wrong:** STOP and ask.

- **Question:** How does the rolling 24 h cap count?
  **Decision:** Count `actions` with `status === 'sent'` and `sentAt > now - 24h`. A "both" decision creates two actions, so it naturally counts as 2.
  **Why:** Matches the spec without extra bookkeeping.
  **If wrong:** STOP and ask.

- **Question:** Retry backoff?
  **Decision:** On a retryable failure the action stays `queued` and `attempts` increments. The next try happens on a later tick, delayed `attempts × normal tick delay`. After `attempts === 3` it becomes `failed`.
  **Why:** The spec says "retry with backoff up to 3 times" without the shape.
  **If wrong:** STOP and ask.

- **Question:** Picture refresh endpoint?
  **Decision:** No per-person refresh. The card shows initials when the `<img>` errors. Settings has a **Refresh pictures** button that re-pages both lists (the same endpoints as collection, same delays, `collecting` mode) and only updates `picUrl`.
  **Why:** No verified per-user endpoint exists, the list endpoints are ones the site calls, and the spec accepts initials.
  **If wrong:** STOP and ask.

- **Question:** Order within a deck?
  **Decision:** If both cards have the relevant date (`iFollowedAt` for deck 1 and mutual, `theyFollowedAt` for deck 2), oldest first. Otherwise Instagram list order (`listIndex`, the position at collection time), with dated cards first.
  **Why:** The spec's suggested default.
  **If wrong:** STOP and ask.

- **Question:** Undo history size and scope?
  **Decision:** The last 20 decisions, kept in memory in the deck tab (lost on reload). An undo reverts the person's `decision` to `undecided` and applies `planUndo` to each of their actions.
  **Why:** The spec says "~20". Persisting history adds state for little value.
  **If wrong:** STOP and ask.

- **Question:** Request log size?
  **Decision:** Keep the newest 50 rows, trimming on insert.
  **Why:** The spec says "~50".
  **If wrong:** STOP and ask.

- **Question:** Export ZIP handling?
  **Decision:** `jszip` reads a `.zip`. Loose `.json` files are also accepted. Files are matched by basename: `followers_<n>.json` and `following.json`, anywhere in the tree.
  **Why:** The spec says guides disagree on folder paths.
  **If wrong:** STOP and ask.

- **Question:** Export entry shape?
  **Decision:** Username = `string_list_data[0].value`, else `title`, else the last path segment of `string_list_data[0].href`. Timestamp = `string_list_data[0].timestamp` (unix seconds). Followers files are a top-level array; following is `{ relationships_following: [...] }`. Both are tolerated either way.
  **Why:** Lenient parsing, as the spec requires. Verified against the real export in Task 15.
  **If wrong:** STOP and ask.

- **Question:** UI primitives?
  **Decision:** Tailwind v4 with CSS-variable tokens in `src/deck/app.css` (colors, radii, spacing, font sizes defined once). Use bits-ui only where an accessible primitive is needed (Dialog for "Start a new cleanup" confirmation). No shadcn-svelte CLI.
  **Why:** The spec says "tokens from day one", and the immoscout lesson is to avoid UI that grows by feel.
  **If wrong:** STOP and ask.

- **Question:** Logging?
  **Decision:** `console.info/warn/error` with a `[igc]` prefix, through `src/shared/log.ts`. Instagram requests are also written to the `requestLog` store.
  **Why:** Matches immoscout's prefix convention.
  **If wrong:** STOP and ask.

- **Question:** Small UI details the spec doesn't pin?
  **Decision:** Dates formatted `Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' })`. Card slide-out 150 ms, off under `prefers-reduced-motion`. Sidebar and queue status refresh from the DB every 5 s and after each decide/undo. Settings validation: `1 ≤ dailyCap ≤ 500`, `10 s ≤ minDelay ≤ maxDelay`. Times are shown in the browser's local time zone.
  **Why:** Needed to build. None of them changes behaviour that matters.
  **If wrong:** STOP and ask.

- **Question:** Error-to-block mapping for shape errors?
  **Decision:** An `IgShapeError` in the collector or sender is stored as a block with reason `non_json` and the error message as `excerpt`, so it stops everything and shows on the BlockBanner.
  **Why:** The spec says "fail loudly". A changed response shape must stop work, not be skipped.
  **If wrong:** STOP and ask.

## Out of Scope

- Voice commands (post-MVP spec section). Only keep `decide()` as the single dispatch point.
- Auto-deciding, scoring, rules, filters beyond the three decks.
- Following anyone except as an undo of an unfollow.
- Stories, likes, DMs, `show_many` (except the Task 2 spike), the GraphQL API, "least interacted with" groups.
- Downloading or storing pictures.
- Web Store packaging, release workflow, auto-update, CI.
- Multiple accounts, sync, servers.
- Drag-to-swipe gestures.
- Remembering kept people across yearly runs.
- Do not add features not listed in this plan, even if related code is nearby.

## Conventions

- Follow `biome.json` (Task 1): 2 spaces, single quotes, semicolons, line width 120.
- Errors: Instagram failures throw typed errors from `src/instagram/errors.ts` (`IgBlockedError`, `IgShapeError`, `IgRetryableError`). Callers catch them at the runner level (collector, sender) and persist them. Nothing swallows errors silently.
- Imports: relative within `src/`, and `$deck/*` alias for `src/deck/*` inside Svelte code.
- Naming: camelCase functions, PascalCase types and components, SCREAMING_SNAKE constants in `src/shared/constants.ts`. No string literals for store names or meta keys outside `constants.ts`.
- Time: all timestamps are unix **milliseconds** internally, except export timestamps, which are converted from seconds at parse time.
- Tests: Vitest, colocated `*.test.ts`, `environment: 'node'`, pure functions only.

---

## File Structure

```
package.json, tsconfig.json, vite.config.ts, svelte.config.js, biome.json, vitest.config.ts, .gitignore, CLAUDE.md
deck.html                         Vite entry for the deck tab
static/manifest.json              MV3 manifest (copied to dist/)
static/icons/icon{16,48,128}.png  placeholder icons
docs/transport-decision.md        Task 2 outcome
src/shared/constants.ts           store names, meta keys, defaults, IG constants
src/shared/types.ts               Person, Decision, QueuedAction, BlockInfo, Mode, etc.
src/shared/log.ts                 [igc] logger
src/instagram/errors.ts           typed errors
src/instagram/endpoints.ts        pure request builders
src/instagram/parse.ts            pure response validators + detectBlock
src/instagram/transport.ts        igFetch + readSession (spike-decided)
src/instagram/client.ts           endpoints + transport + parse + request log
src/instagram/__fixtures__/       captured JSON responses / write bodies
src/content/index.ts              only if Option 2 wins: same-origin fetch relay
src/db/db.ts                      idb schema + typed accessors
src/core/people.ts                mergeListPage, relationship, deckOf, buildDeck
src/core/decisions.ts             availableDecisions, actionsFor, planUndo
src/core/pacing.ts                randomDelay, sentInLast24h, canSendNow
src/core/account-guard.ts         checkAccount
src/core/export.ts                readExportFiles, parseExport, applyExportDates
src/core/collection.ts            nextListStep, nextMutualsTarget, collectionProgress
src/collector/collector.ts        deck-tab runner (uses setTimeout)
src/background/index.ts           service worker: alarms, messages, sender
src/background/sender.ts          one send tick
src/deck/main.ts, App.svelte, app.css
src/deck/lib/decide.ts            decide(), undo history
src/deck/lib/keyboard.ts          key → decision mapping
src/deck/components/Card.svelte, DeckSidebar.svelte, QueueStatus.svelte,
  CollectionView.svelte, SettingsView.svelte, BlockBanner.svelte,
  AccountMismatch.svelte, ErrorBanner.svelte
```

---

### Task 1: Scaffold the extension

**Files:**
- Create: everything in the first two lines of File Structure, plus `src/deck/main.ts`, `src/deck/App.svelte` (renders "Instagram Cleanup"), `src/deck/app.css` (Tailwind import + tokens), `src/background/index.ts` (toolbar click opens `deck.html` in a new tab), `src/shared/log.ts`.

**Interfaces:**
- Produces: `npm run build` → `dist/` with `deck.html`, `deck.js`, `background.js`, `manifest.json`, icons. Scripts: `dev`, `build`, `check` (svelte-check), `test` (vitest run), `lint` (biome check .).
- Produces: `log.info/warn/error(...args)` in `src/shared/log.ts`, prefixing `[igc]`.

- [ ] **Step 1:** `npm init -y`, set `"type": "module"`, `"private": true`, then install the exact ranges from Open Questions Resolved (Versions).
- [ ] **Step 2:** Write `vite.config.ts`, modelled on `~/Documents/Repos/reloader-immoscout/apps/extension-is24/vite.config.ts`: main build input `deck.html`, a `closeBundle` plugin that copies `static/` and builds `src/background/index.ts` as IIFE `background.js` (and `src/content/index.ts` as IIFE `content.js` only if that file exists). Alias `$deck` → `src/deck`.
- [ ] **Step 3:** Write `static/manifest.json`: MV3, name "Instagram Cleanup", `permissions: ["storage", "alarms", "cookies", "tabs"]`, `host_permissions: ["https://www.instagram.com/*"]`, `background.service_worker: "background.js"`, `action` with icons, no `default_popup`. Add `"scripting"` only if Task 2 picks Option 2.
- [ ] **Step 4:** Copy `biome.json` from immoscout, changing `files.includes` to `["src/**", "!src/**/*.css"]`. Write `tsconfig.json` (same compiler options as immoscout's extension, `types: ["chrome"]`, `paths: { "$deck/*": ["src/deck/*"] }`). Write `vitest.config.ts` with `environment: 'node'` and `include: ['src/**/*.test.ts']`.
- [ ] **Step 5:** In `app.css`, define tokens: `--color-bg`, `--color-surface`, `--color-text`, `--color-muted`, `--color-keep`, `--color-cut`, `--color-warn`, `--radius-card`, `--space-1..6` (4 px base), `--text-sm/base/lg/xl`. Map them in a Tailwind v4 `@theme` block. No other colors anywhere in the codebase.
- [ ] **Step 6:** `.gitignore`: `node_modules/`, `dist/`, `.superpowers/`. `CLAUDE.md`: one paragraph pointing to the spec and plan, plus the scripts.
- [ ] **Step 7:** Run `npm run check && npm run lint && npm run build`. Expected: all succeed, and `dist/` contains the files listed above. `npm test` with no tests: Vitest exits 0 (add `passWithNoTests: true` to the config).
- [ ] **Step 8: [HUMAN]** Load `dist/` unpacked in Chrome, click the toolbar icon. Expected: a tab opens showing "Instagram Cleanup".
- [ ] **Step 9:** Commit: `git add -A && git commit -m "chore: scaffold MV3 extension"`.

### Task 2: Transport spike

**Files:**
- Create: `src/instagram/transport.ts`, `src/instagram/errors.ts`, `docs/transport-decision.md`
- Create (Option 2 only): `src/content/index.ts`
- Modify: `src/deck/App.svelte` (temporary "Spike" panel, removed in Task 11)

**Interfaces:**
- Produces: `type IgRequest = { method: 'GET' | 'POST'; path: string; query?: Record<string, string>; form?: Record<string, string> }`
- Produces: `type IgRawResponse = { status: number; url: string; text: string }`
- Produces: `igFetch(req: IgRequest): Promise<IgRawResponse>`. Throws `IgRetryableError` on network failure.
- Produces: `readSession(): Promise<{ userId: string; csrfToken: string } | null>` (null if the cookies are missing).
- Produces in `errors.ts`: `class IgBlockedError extends Error { info: BlockInfo }`, `class IgShapeError extends Error { endpoint: string; detail: string }`, `class IgRetryableError extends Error { status: number | null }`. Define `BlockInfo` here for now (`{ reason: 'http_429' | 'feedback_required' | 'checkpoint_required' | 'login_required' | 'login_redirect' | 'challenge_redirect' | 'non_json'; status: number; endpoint: string; excerpt: string; at: number }`) and move it to `types.ts` in Task 3.

- [ ] **Step 1:** Implement Option 1: `fetch('https://www.instagram.com' + path + query, { method, credentials: 'include', headers: {X-IG-App-ID, X-CSRFToken, X-Requested-With, Content-Type for POST: application/x-www-form-urlencoded}, body: URLSearchParams(form) })`.
- [ ] **Step 2:** Add a temporary Spike panel with two buttons: **GET** (`/api/v1/friendships/{userId}/followers/` with `count=12, search_surface=follow_list_page`) and **POST** (`/api/v1/friendships/show_many/` with `user_ids=<userId>`). Each shows status, final URL and the first 300 characters of the body.
- [ ] **Step 3: [HUMAN]** Ignacio logs into instagram.com in this Chrome profile, reloads the extension, and clicks both buttons. Pass = both return 200 with JSON containing `"status":"ok"`.
- [ ] **Step 4:** If either fails, implement Option 2. The background ensures a pinned tab on `https://www.instagram.com/` exists (create it with `pinned: true, active: false` if it doesn't). `igFetch` sends `{ type: 'igc:fetch', req }` with `chrome.tabs.sendMessage`. `src/content/index.ts` performs the same `fetch` same-origin and returns `IgRawResponse`. Add the content script to the manifest (matches `https://www.instagram.com/*`) and the `scripting` permission. Repeat Step 3.
- [ ] **Step 5:** If neither option passes both, STOP and ask.
- [ ] **Step 6:** Write `docs/transport-decision.md`: which option won, the raw results of both buttons for each option tried, the date.
- [ ] **Step 7:** `npm run check && npm run build`, then commit: `git commit -m "feat: instagram transport (spike outcome)"`.

### Task 3: [HUMAN] Capture the real write requests + shared types

**Files:**
- Create: `src/instagram/__fixtures__/writes.json`, `src/instagram/__fixtures__/followers-page.json`, `following-page.json`, `mutuals-page.json`
- Create: `src/shared/types.ts`, `src/shared/constants.ts`
- Modify: `src/instagram/errors.ts` (import `BlockInfo` from types)

**Interfaces:**
- Produces in `types.ts`:
  - `type Decision = 'undecided' | 'keep' | 'unfollow' | 'remove' | 'both'`
  - `type DeckId = 'notFollowingBack' | 'fansNotFollowed' | 'mutual'`
  - `type MutualPreview = { usernames: string[]; picUrls: string[]; hasMore: boolean }`
  - `type Person = { pk: string; username: string; fullName: string; picUrl: string; isPrivate: boolean; isVerified: boolean; iFollow: boolean; followsMe: boolean; listIndex: number; mutuals: MutualPreview | null; mutualsFetchedAt: number | null; iFollowedAt: number | null; theyFollowedAt: number | null; decision: Decision; decidedAt: number | null }`
  - `type ActionType = 'unfollow' | 'remove' | 'follow'`
  - `type ActionStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled'`
  - `type QueuedAction = { id?: number; personPk: string; type: ActionType; status: ActionStatus; attempts: number; createdAt: number; notBefore: number; sentAt: number | null; error: string | null }`
  - `type Mode = 'collecting' | 'sending' | 'paused'`
  - `BlockInfo` (moved from errors.ts)
  - `type ListCursor = { done: boolean; nextMaxId: string | null; seen: number }`
  - `type CollectionState = { followers: ListCursor; following: ListCursor; listsCompletedAt: number | null; mutualsCompletedAt: number | null; refreshingPictures: boolean; modeBeforeRefresh: Mode | null }`
  - `type Settings = { dailyCap: number; minDelayMs: number; maxDelayMs: number }`
  - `type AccountMeta = { userId: string; username: string | null }`
- Produces in `constants.ts`: `DB_NAME = 'ig-cleanup'`, `DB_VERSION = 1`, `STORE_PEOPLE/ACTIONS/REQUEST_LOG/META`, `META_ACCOUNT/MODE/BLOCK/COLLECTION/SETTINGS/LAST_SENT_AT`, `IG_ORIGIN = 'https://www.instagram.com'`, `IG_APP_ID = '936619743392459'`, `LIST_PAGE_SIZE = 12`, `LIST_DELAY_MS = [2000, 4000]`, `MUTUALS_DELAY_MS = [5000, 10000]`, `DEFAULT_SETTINGS: Settings = { dailyCap: 100, minDelayMs: 30000, maxDelayMs: 90000 }`, `MAX_ATTEMPTS = 3`, `UNDO_HISTORY_SIZE = 20`, `REQUEST_LOG_SIZE = 50`, `SEND_ALARM = 'igc-send'`.

- [ ] **Step 1: [HUMAN]** In instagram.com with DevTools → Network open, Ignacio **unfollows** one account he picks from a profile page, **follows it back**, and **removes** one follower he picks. For each, copy the request (URL, method, form body, response JSON) into `writes.json` as `{ unfollow: {...}, follow: {...}, remove: {...} }`. Strip cookies and tokens.
- [ ] **Step 2: [HUMAN]** From the same session, save one real response each for followers, following and mutual_followers as fixtures. Replace usernames, names and pic URLs with fakes, keeping the shape and value types exactly.
- [ ] **Step 3:** If any write body contains `fb_dtsg` or `jazoest`, STOP and ask.
- [ ] **Step 4:** Write `types.ts` and `constants.ts` exactly as in Interfaces. Run `npm run check`. Expected: pass.
- [ ] **Step 5:** Commit: `git commit -m "feat: shared types, constants and captured fixtures"`.

### Task 4: Request builders and response parsing

**Files:**
- Create: `src/instagram/endpoints.ts`, `src/instagram/parse.ts`, `src/instagram/parse.test.ts`, `src/instagram/endpoints.test.ts`

**Interfaces:**
- Consumes: `IgRequest`, `IgRawResponse`, errors, types, constants, fixtures.
- Produces (`endpoints.ts`): `followersRequest(userId: string, maxId: string | null): IgRequest`, `followingRequest(userId, maxId)`, `mutualsRequest(targetPk: string): IgRequest`, `unfollowRequest(targetPk)`, `followRequest(targetPk)`, `removeFollowerRequest(targetPk)`. Write bodies replicate `writes.json` exactly.
- Produces (`parse.ts`):
  - `type IgUser = { pk: string; username: string; fullName: string; picUrl: string; isPrivate: boolean; isVerified: boolean }`
  - `detectBlock(res: IgRawResponse, endpoint: string, now: number): BlockInfo | null`
  - `parseUserPage(res: IgRawResponse, endpoint: string): { users: IgUser[]; nextMaxId: string | null }`. Calls `detectBlock` first and throws `IgBlockedError`. A 5xx throws `IgRetryableError`. A missing `users` array or user fields throws `IgShapeError`. `pk` is normalized to a string (mutuals return a number). `nextMaxId` is null when `has_more === false` or absent, and also null when `next_max_id` is absent.
  - `parseMutualsPage(res, endpoint): MutualPreview` (first 12 usernames/picUrls, `hasMore = next_max_id != null`)
  - `parseWriteResult(res, endpoint): void`. Requires `status === 'ok'` after block checks.

- [ ] **Step 1: Write failing tests** in `parse.test.ts`:
  - `parseUserPage(followers fixture)` → 12 users, `nextMaxId` equal to the fixture's cursor; `pk` typed string.
  - The following fixture with `next_max_id: "12"` → `nextMaxId === '12'`.
  - Mutuals fixture with numeric `pk` → users parsed. `parseMutualsPage` → `hasMore === true` when `next_max_id` is present.
  - `detectBlock({status: 429, ...})?.reason === 'http_429'`.
  - Body `{"message":"feedback_required"}` → `'feedback_required'` (same for `checkpoint_required`, `login_required`).
  - `url: 'https://www.instagram.com/accounts/login/?next=…'` with status 200 → `'login_redirect'` **(Review Focus 1)**.
  - `url: …/challenge/…` → `'challenge_redirect'`.
  - `text: '<!DOCTYPE html>'` → `'non_json'`.
  - `{status: 200, text: '{"status":"ok"}'}` (no `users`) → `parseUserPage` throws `IgShapeError` whose `endpoint` matches.
  - Status 502 → throws `IgRetryableError`.
  - `parseWriteResult` with `writes.json` responses → no throw. With `{"status":"fail"}` → throws `IgShapeError`.
- [ ] **Step 2:** In `endpoints.test.ts`: `followersRequest('1', null)` → `{ method: 'GET', path: '/api/v1/friendships/1/followers/', query: { count: '12', search_surface: 'follow_list_page' } }`. With `maxId: 'abc'` → `query.max_id === 'abc'`. `followingRequest` has no `search_surface`. Each write request matches the method, path and form captured in `writes.json`.
- [ ] **Step 3:** `npm test`. Expected: FAIL (module not found).
- [ ] **Step 4:** Implement both files to the signatures above.
- [ ] **Step 5:** `npm test`. Expected: PASS.
- [ ] **Step 6:** Commit: `git commit -m "feat: instagram request builders and response parsing"`.

### Task 5: Database and Instagram client

TDD exemption: `db.ts` and `client.ts` are thin I/O glue (IndexedDB, transport) with no branching logic beyond what Tasks 4, 6 and 7 test. They are verified by `npm run check` and the Task 14 end-to-end run.

**Files:**
- Create: `src/db/db.ts`, `src/instagram/client.ts`

**Interfaces:**
- Consumes: `igFetch`, `readSession`, `endpoints.ts`, `parse.ts`, types, constants.
- Produces (`db.ts`), all async:
  - `openDb()`
  - People: `getPerson(pk)`, `putPeople(people: Person[])`, `allPeople(): Promise<Person[]>`
  - Actions: `addActions(a: QueuedAction[]): Promise<number[]>`, `updateAction(a: QueuedAction)`, `actionsByStatus(s: ActionStatus): Promise<QueuedAction[]>`, `actionsForPerson(pk): Promise<QueuedAction[]>`
  - Request log: `logRequest(row: { endpoint: string; status: number | null; at: number; outcome: string })` (trims to `REQUEST_LOG_SIZE`), `recentRequests(): Promise<...[]>`
  - Meta: `getMeta<T>(key): Promise<T | undefined>`, `setMeta<T>(key, value)`
  - `wipeAll()` (clears all four stores)
- Produces (`client.ts`), each awaiting `readSession()` (throws `IgBlockedError` with reason `login_required` if null), calling `igFetch`, logging via `logRequest`, then parsing:
  - `fetchFollowersPage(maxId: string | null): Promise<{ users: IgUser[]; nextMaxId: string | null }>`
  - `fetchFollowingPage(maxId)`
  - `fetchMutuals(pk): Promise<MutualPreview>`
  - `unfollow(pk): Promise<void>`, `follow(pk)`, `removeFollower(pk)`

- [ ] **Step 1:** Implement `db.ts` with `idb`'s `openDB(DB_NAME, DB_VERSION, { upgrade })`, creating the stores and the `status` index exactly as in Open Questions Resolved.
- [ ] **Step 2:** Implement `client.ts` per the signatures.
- [ ] **Step 3:** `npm run check && npm run build`. Expected: pass.
- [ ] **Step 4:** Commit: `git commit -m "feat: indexeddb store and instagram client"`.

### Task 6: People, decks, decisions and undo (pure)

**Files:**
- Create: `src/core/people.ts`, `src/core/people.test.ts`, `src/core/decisions.ts`, `src/core/decisions.test.ts`

**Interfaces:**
- Produces (`people.ts`):
  - `mergeListPage(existing: Map<string, Person>, users: IgUser[], list: 'followers' | 'following', startIndex: number): Person[]`. Upserts by `pk`, sets `followsMe` / `iFollow` to true for that list, refreshes `username/fullName/picUrl/isPrivate/isVerified`, sets `listIndex` only for new people, and keeps every other field.
  - `deckOf(p: Person): DeckId | null` (`iFollow && !followsMe` → `notFollowingBack`; `!iFollow && followsMe` → `fansNotFollowed`; both → `mutual`; neither → null)
  - `buildDeck(people: Person[], deck: DeckId): Person[]` (only `decision === 'undecided'`, ordered per Open Questions Resolved)
  - `deckCounts(people): Record<DeckId, { remaining: number; total: number }>`
- Produces (`decisions.ts`):
  - `availableDecisions(p: Person): Decision[]` (`keep` always; `unfollow` if `iFollow`; `remove` if `followsMe`; `both` if both)
  - `actionsFor(p: Person, d: Decision, now: number): QueuedAction[]` (keep → []; unfollow → [unfollow]; remove → [remove]; both → [unfollow, remove]; all `queued`, `attempts: 0`, `notBefore: now`)
  - `type UndoStep = { kind: 'cancel'; actionId: number } | { kind: 'refollow'; privateAccount: boolean } | { kind: 'irreversible' } | { kind: 'none' }`
  - `planUndo(p: Person, action: QueuedAction): UndoStep` (`queued` → cancel; `sending` or `sent` + unfollow → refollow; `sending` or `sent` + remove → irreversible; `failed`/`cancelled` → none)

- [ ] **Step 1: Write failing tests:**
  - `mergeListPage` with the same `pk` twice (two pages) → one person, `listIndex` from the first time **(Review Focus 2)**. A followers page then a following page with the same `pk` → `iFollow && followsMe`. An existing person with `decision: 'keep'` keeps it after a merge.
  - `deckOf` for all four combinations.
  - `buildDeck`: excludes decided people. Dated before undated. Among dated, oldest `iFollowedAt` first for `notFollowingBack`, and `theyFollowedAt` for `fansNotFollowed`. Undated by `listIndex`.
  - `availableDecisions` for a non-mutual you follow → `['keep', 'unfollow']`; for a mutual → `['keep', 'unfollow', 'remove', 'both']`.
  - `actionsFor(mutual, 'both', 1000)` → two actions, types `unfollow` then `remove`, `notBefore: 1000`.
  - `planUndo` with status `sending` + `unfollow` deep-equals its result with status `sent` **(Review Focus 4)**. A private person → `privateAccount: true`. `remove` + `sent` → `irreversible`. `queued` → `cancel` with that id.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: people merging, decks, decisions and undo planning"`.

### Task 7: Pacing, sending plan and account guard (pure)

**Files:**
- Create: `src/core/pacing.ts`, `src/core/pacing.test.ts`, `src/core/account-guard.ts`, `src/core/account-guard.test.ts`

**Interfaces:**
- Produces (`pacing.ts`):
  - `randomDelay(range: readonly [number, number], rand: () => number): number` (`min + floor(rand() * (max - min + 1))`)
  - `sentInLast24h(actions: QueuedAction[], now: number): number`
  - `type SendPlan = { kind: 'send'; action: QueuedAction } | { kind: 'wait'; until: number; reason: 'cap' | 'delay' | 'backoff' } | { kind: 'idle'; reason: 'not_sending' | 'blocked' | 'empty' }`
  - `planSend(input: { mode: Mode; block: BlockInfo | null; queued: QueuedAction[]; sent: QueuedAction[]; lastSentAt: number | null; settings: Settings; now: number; rand: () => number }): SendPlan`. Order: block → idle/blocked; mode ≠ sending → idle/not_sending; no queued → idle/empty; cap reached → wait until the oldest counted `sentAt + 24h`; earliest `notBefore` in the future → wait/backoff; less than `randomDelay([minDelayMs, maxDelayMs])` since `lastSentAt` → wait/delay; otherwise send the queued action with the lowest `id`.
- Produces (`account-guard.ts`): `checkAccount(stored: AccountMeta | undefined, currentUserId: string | null): 'unset' | 'ok' | 'mismatch' | 'logged_out'`

- [ ] **Step 1: Write failing tests:**
  - `randomDelay([30000, 90000], () => 0) === 30000` and `() => 0.999999` → `90000`.
  - `sentInLast24h` counts only `sent` with `sentAt > now - 86400000`.
  - `planSend` with a block → `idle/blocked`. Mode `collecting` → `idle/not_sending`. 100 sent in the window with cap 100 → `wait/cap` until the oldest `sentAt + 86400000`. A queued action with `notBefore` in the future → `wait/backoff`. Last sent 10 s ago with rand 0 → `wait/delay` until `lastSentAt + 30000`. Otherwise `send` with the lowest-id action.
  - `checkAccount(undefined, '1') === 'unset'`; `({userId:'1'}, '1') === 'ok'`; `({userId:'1'}, '2') === 'mismatch'`; `(any, null) === 'logged_out'`.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: send pacing plan and account guard"`.

### Task 8: Export parsing (pure + zip reading)

**Files:**
- Create: `src/core/export.ts`, `src/core/export.test.ts`

**Interfaces:**
- Produces:
  - `type ExportFile = { name: string; text: string }`
  - `readExportFiles(files: File[]): Promise<ExportFile[]>` (expands `.zip` with jszip; keeps entries whose basename matches `/^followers_\d+\.json$/` or `following.json`; I/O, untested)
  - `type ExportDates = { followers: Map<string, number>; following: Map<string, number> }` (username lowercased → unix **ms**)
  - `parseExport(files: ExportFile[]): ExportDates`
  - `applyExportDates(people: Person[], dates: ExportDates): { updated: Person[]; matched: number; unmatched: number }` (sets `theyFollowedAt` from followers and `iFollowedAt` from following, matching on lowercased username; `unmatched` = export entries with no person)

- [ ] **Step 1: Write failing tests** with inline JSON:
  - A followers file as a top-level array with `string_list_data[0].value: 'Anna'`, `timestamp: 1600000000` → `followers.get('anna') === 1600000000000`.
  - `following.json` as `{ relationships_following: [{ title: 'marc', string_list_data: [{ href: 'https://www.instagram.com/marc', timestamp: 1500000000 }] }] }` (no `value`) → `following.get('marc') === 1500000000000`.
  - An entry with only `href` ending `/_u/lucia` → username `lucia`.
  - Two followers files (`followers_1.json`, `followers_2.json`) → merged.
  - A malformed entry (no `string_list_data`) is skipped without throwing.
  - `applyExportDates` with one known and one unknown username → `matched: 1, unmatched: 1` **(Review Focus 5)**.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: data export parsing"`.

### Task 9: Collection runner

**Files:**
- Create: `src/core/collection.ts`, `src/core/collection.test.ts`, `src/collector/collector.ts`

**Interfaces:**
- Consumes: client fetchers, `mergeListPage`, db accessors, `randomDelay`, constants.
- Produces (`collection.ts`, pure):
  - `INITIAL_COLLECTION: CollectionState` (both cursors `{ done: false, nextMaxId: null, seen: 0 }`, all completion fields null, `refreshingPictures: false`, `modeBeforeRefresh: null`)
  - `nextListStep(s: CollectionState): 'followers' | 'following' | null` (followers until done, then following, then null)
  - `nextMutualsTarget(people: Person[], sentPks: Set<string>): Person | null`. Skips people with `mutualsFetchedAt !== null`, people in `sentPks`, and people with `deckOf === null`. Order: `notFollowingBack`, then `fansNotFollowed`, then `mutual`; within a deck, `listIndex` ascending.
  - `collectionProgress(s: CollectionState, people: Person[]): { phase: 'lists' | 'mutuals' | 'done'; listsSeen: number; mutualsDone: number; mutualsTotal: number }`
- Produces (`collector.ts`): `startCollector(onUpdate: () => void): { stop(): void }`. A loop that runs while `meta.mode === 'collecting'` and `meta.block === null`. Each iteration does exactly one request:
  - **Lists phase:** fetch the next page, `mergeListPage`, `putPeople`, update the cursor (`done` when `nextMaxId === null`), persist `META_COLLECTION`.
  - **Mutuals phase:** fetch `nextMutualsTarget`, store `mutuals` + `mutualsFetchedAt`.
  - **Done:** set `mutualsCompletedAt` and mode `sending`.
  - Sleeps `randomDelay(LIST_DELAY_MS | MUTUALS_DELAY_MS)` between iterations.
  - On `IgBlockedError`, sets `META_BLOCK` and stops. On `IgShapeError`, sets `META_BLOCK` with reason `non_json` and the error message as `excerpt`, then stops. On `IgRetryableError`, waits 3× the delay and retries the same step, up to `MAX_ATTEMPTS`, then sets a block and stops.
  - On the first run, before anything else, stores `META_ACCOUNT` from `readSession()`.
  - When `refreshingPictures` is true, runs only the lists phase (cursors reset), updates only `picUrl`, then clears the flag and sets the mode back to `modeBeforeRefresh`.

- [ ] **Step 1: Write failing tests** for `collection.ts`:
  - `nextListStep(INITIAL_COLLECTION) === 'followers'`; with followers done → `'following'`; with both done → null.
  - `nextMutualsTarget` skips people with `mutualsFetchedAt` set **(Review Focus 3)**, skips sent pks, and returns a `notFollowingBack` person before a `mutual` person even when the mutual has the lower `listIndex`.
  - `collectionProgress` returns `phase: 'mutuals'` once both lists are done, with correct counts.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `collection.ts`. Run `npm test`. Expected: PASS.
- [ ] **Step 4:** Implement `collector.ts`. Run `npm run check`. Expected: pass.
- [ ] **Step 5:** Commit: `git commit -m "feat: resumable collection runner"`.

### Task 10: Service-worker sender

TDD exemption: all branching lives in `planSend` (Task 7, tested). This task is Chrome/IndexedDB glue, verified by `npm run check` and Task 14.

**Files:**
- Create: `src/background/sender.ts`
- Modify: `src/background/index.ts`

**Interfaces:**
- Consumes: `planSend`, db accessors, client write calls, constants.
- Produces: `runSendTick(now: number): Promise<SendPlan>`. Loads state and calls `planSend`. On `send`: mark the action `sending` → call the client (`unfollow`/`remove`/`follow`) → `sent` with `sentAt`. On `IgRetryableError`: `attempts + 1`, `notBefore = now + attempts × maxDelayMs`, back to `queued`, or `failed` at `MAX_ATTEMPTS`. On `IgBlockedError`/`IgShapeError`: set `META_BLOCK`, return the action to `queued`. Persist `lastSentAt` in `META_LAST_SENT_AT`.
- Produces (`index.ts`): toolbar click opens or focuses `deck.html`. `chrome.alarms.onAlarm(SEND_ALARM)` → `runSendTick`, then reschedules: `send` → `when: now + randomDelay(settings range)`; `wait` → `when: until` (at least now + 30 s); `idle` → no alarm. A message `{ type: 'igc:kick' }` from the deck (sent on mode change, new actions, resume) clears and schedules the alarm at now + 1 s.

- [ ] **Step 1:** Implement both.
- [ ] **Step 2:** `npm run check && npm test && npm run build`. Expected: pass.
- [ ] **Step 3:** Commit: `git commit -m "feat: alarm-driven action sender"`.

### Task 11: Deck UI: card, decks, keyboard, undo

**Files:**
- Create: `src/deck/lib/decide.ts`, `src/deck/lib/keyboard.ts`, `src/deck/lib/keyboard.test.ts`, `src/deck/components/Card.svelte`, `DeckSidebar.svelte`, `QueueStatus.svelte`
- Modify: `src/deck/App.svelte` (remove the Spike panel, add the layout: card centre, sidebar right)

**Interfaces:**
- Consumes: `buildDeck`, `deckCounts`, `availableDecisions`, `actionsFor`, `planUndo`, db accessors.
- Produces (`keyboard.ts`, pure): `keyToCommand(key: string): Decision | 'undo' | 'open' | null` (`ArrowRight` keep, `ArrowLeft` unfollow, `ArrowDown` remove, `ArrowUp` both, `z`/`Z`/`Backspace` undo, `Enter` open, anything else null)
- Produces (`decide.ts`):
  - `decide(personPk: string, decision: Decision): Promise<void>`. Ignored if not in `availableDecisions`. Otherwise sets the person's `decision/decidedAt`, `addActions(actionsFor(...))`, pushes to the undo history (max `UNDO_HISTORY_SIZE`), and sends `igc:kick`. **The only entry point for decisions.**
  - `undoLast(): Promise<UndoStep[]>`. Pops history, resets the person to `undecided`, and per action applies `planUndo`: cancel → `cancelled`; refollow → `addActions([follow])`; irreversible/none → nothing. Returns the steps so the UI can show "follow request sent, not restored" (private) or "removal already sent, can't undo".

- [ ] **Step 1: Write failing tests** for `keyToCommand` covering every mapped key and an unmapped one (`'a'` → null).
- [ ] **Step 2:** `npm test`. Expected: FAIL. Implement `keyboard.ts`. Run `npm test`. Expected: PASS.
- [ ] **Step 3:** Implement `decide.ts`.
- [ ] **Step 4:** Implement `Card.svelte` per the spec's card list:
  - initials fallback on `<img>` `error`
  - relationship line: "You follow them · they don't follow you" / "They follow you · you don't follow them" / "You follow each other"
  - dates: "You followed: Mar 2019" / "They followed: Jun 2021", only when present, formatted `MMM yyyy` via `Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' })`
  - people in common: "Followed by a, b and N more" / "+" when `hasMore` / "No people in common" / "People in common: loading later" when `mutuals === null`
  - "Open profile" link `https://www.instagram.com/<username>/` with `target="_blank"`
  - one button per `availableDecisions` showing its key hint; the remove hint adds "can't be undone once sent"; private cards' unfollow hint adds "private: undo only sends a request"
  - a 150 ms slide-out on decide, disabled under `prefers-reduced-motion`
- [ ] **Step 5:** Implement `DeckSidebar.svelte` (three decks with remaining/total, the selected one highlighted, `notFollowingBack` by default) and `QueueStatus.svelte` (queued count, sent today against the cap, next send time, mode). Refresh from the DB every 5 s and after every decide/undo.
- [ ] **Step 6:** In `App.svelte`, a window `keydown` listener routes `keyToCommand` to `decide`/`undoLast`/open profile (ignored while focus is in an input).
- [ ] **Step 7:** `npm run check && npm test && npm run build`. Expected: pass.
- [ ] **Step 8:** Commit: `git commit -m "feat: swipe deck with keyboard and undo"`.

### Task 12: Collection view, settings, guards and export import

TDD exemption: UI and wiring only (no UI render tests, per Global Constraints). The logic it calls is tested in Tasks 6-9.

**Files:**
- Create: `src/deck/components/CollectionView.svelte`, `SettingsView.svelte`, `BlockBanner.svelte`, `AccountMismatch.svelte`, `ErrorBanner.svelte`
- Modify: `src/deck/App.svelte`, `src/deck/main.ts`

**Interfaces:**
- Consumes: `startCollector`, `collectionProgress`, `checkAccount`, `readSession`, `readExportFiles`, `parseExport`, `applyExportDates`, db accessors.

- [ ] **Step 1:** In `main.ts`, the single-tab guard: if another `deck.html` tab exists, focus it and `window.close()`.
- [ ] **Step 2:** On load, `checkAccount(getMeta(META_ACCOUNT), (await readSession())?.userId ?? null)`:
  - `logged_out` → full-screen "Log in to instagram.com in this Chrome profile, then reload".
  - `mismatch` → `AccountMismatch` ("Logged in as X, this cleanup belongs to Y", plus a "Start a new cleanup for X" button that confirms in a bits-ui Dialog, then `wipeAll()` and reloads). Nothing else renders.
- [ ] **Step 3:** `CollectionView` shows phase, progress (`collectionProgress`), and time left as `remaining × average delay`. It has **Start/Resume collection** (mode → `collecting`, `startCollector`) and **Pause collection, start sending** (mode → `sending`, kick). It also shows a banner: "Keep this tab open while collecting". If mode is `collecting` on load, `startCollector` resumes automatically.
- [ ] **Step 4:** `BlockBanner`, shown whenever `META_BLOCK` is set: reason, endpoint, status, excerpt, time (local time). A **Resume** button clears the block and kicks the alarm; nothing resumes automatically.
- [ ] **Step 5:** `SettingsView`:
  - daily cap and min/max delay inputs, stored in `META_SETTINGS`, with validation `1 ≤ cap ≤ 500` and `10 s ≤ min ≤ max`
  - Pause/Resume sending
  - **Load export** (file input, `multiple`, accepts `.zip,.json`). Shows "Matched N, unmatched M"
  - **Refresh pictures** (sets `refreshingPictures` and mode `collecting`)
  - **Start a new cleanup** (Dialog confirm → `wipeAll`)
  - the last 50 requests from `recentRequests()` (endpoint, status, outcome, local time)
- [ ] **Step 6:** `ErrorBanner` for unexpected errors caught in `App.svelte` (`window.onunhandledrejection` → banner with the message). No silent catches.
- [ ] **Step 7:** `npm run check && npm test && npm run lint && npm run build`. Expected: pass.
- [ ] **Step 8:** Commit: `git commit -m "feat: collection view, settings, guards and export import"`.

### Task 13: [HUMAN] Collection run

**Pre-check:** Tasks 1-12 are committed, and `docs/transport-decision.md` exists. If not, STOP.

- [ ] **Step 1: [HUMAN]** In Settings, set the daily cap to **1**. Confirm mode isn't `sending`.
- [ ] **Step 2: [HUMAN]** Start collection. Watch the lists phase reach about 2,200 + 2,400 seen (~20 min). Confirm the deck counts look plausible.
- [ ] **Step 3: [HUMAN]** Let people-in-common run (overnight is fine). Close and reopen the tab once midway, and confirm it resumes without re-fetching (the request log shows new pks only).
- [ ] **Step 4: [HUMAN]** With mode `paused`, swipe about 5 cards using every key plus one undo. Check the card content and the queue counts, then undo them all so nothing is left queued.
- [ ] **Step 5:** Report any block, shape error or UI problem verbatim. Do not change code during this task.

### Task 14: [HUMAN] Supervised first unfollow and first remove

**Pre-check:** The lists phase finished in Task 13. The daily cap is 1. If not, STOP.

- [ ] **Step 1: [HUMAN]** Ignacio picks a throwaway target he follows and presses ← on its card. Switch mode to sending (Pause collection, start sending). After the tick, confirm on instagram.com that the unfollow happened, and that the request log shows a 200.
- [ ] **Step 2: [HUMAN]** Press Z to undo. Confirm a `follow` action is queued, and after the next tick (the cap must be raised to 2 for this, then set back) that the follow happened (or "requested" for a private target).
- [ ] **Step 3: [HUMAN]** Pick a throwaway follower, press ↓, and confirm the removal on instagram.com.
- [ ] **Step 4:** If any write fails or its response differs from `writes.json`, STOP and ask.
- [ ] **Step 5: [HUMAN]** Set the cap back to 100.

### Task 15: [HUMAN] Real export check

**Pre-check:** Ignacio has the export ZIP. If not, skip this task and report it as pending.

- [ ] **Step 1: [HUMAN]** Load the ZIP from Settings. Expected: "Matched N, unmatched M" with N in the thousands.
- [ ] **Step 2:** If N is near 0, inspect the real file shapes (paste a redacted sample entry), add a failing test reproducing that shape to `src/core/export.test.ts`, fix `parseExport`, and get the test passing. If the shape needs a new rule beyond Open Questions Resolved (Export entry shape), STOP and ask first.
- [ ] **Step 3:** Commit any fix: `git commit -m "fix: export parsing for real export shape"`.
