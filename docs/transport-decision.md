# Transport decision

2026-11-06. Tested on @ignaguri (personal, private) from the deck tab's spike panel.

## Winner: Option 2, pinned-tab relay

The deck tab asks the content script in a pinned instagram.com tab to make the call, so it's a same-origin fetch from the page. The service worker injects `content.js` if the tab has none (tabs opened before an extension reload).

POSTs also need the page tokens `fb_dtsg` (from `DTSGInitialData` in the page HTML) and `jazoest` (`"2"` + the sum of the csrftoken's char codes, as the site computes it for API POSTs). The content script reads them right before each POST and adds them to the form body. They're never stored or logged. GETs don't use them. Approved by Ignacio on 2026-11-06.

## Raw results

| Option | GET followers | POST show_many |
|---|---|---|
| 1, direct fetch from the extension | 200 JSON | 200 HTML (rejected) |
| 2, relay, no page tokens | 200 JSON | 200 HTML (rejected) |
| 2, relay + `fb_dtsg`/`jazoest` | 200 JSON (`{"users":[...]}`) | 200 JSON (`{"friendship_statuses":{...},"status":"ok"}`) |

Diagnosis, in the IDE browser on the same account with read-only show_many: adding `X-IG-WWW-Claim` and then `X-ASBD-ID` still returned HTML. Adding `fb_dtsg` + `jazoest` to the body returned JSON. So the origin was never the problem; the missing tokens were.

Option 1 could work with the tokens too, but it would have to fetch an instagram.com page to get them. The relay already sits on that page.
