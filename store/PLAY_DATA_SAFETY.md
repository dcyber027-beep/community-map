# Google Play Data Safety + UGC answer sheet

Practical, code-grounded answers to paste into the Play Console **Data safety**
form and the **User-generated content** declaration for `au.communitymap.app`
(Melbourne Community Map). Verified against `backend/server.py`.

App model in one line: **anonymous, no user accounts.** Public identities are
one-way HMAC tokens, never raw IDs. Most data is optional and user-triggered.

## Data collected and why

| Data type (Play category) | Collected? | Optional? | Purpose | Public? |
|---|---|---|---|---|
| Precise/approximate **location** (lat/lng of an incident or street note) | Yes | Optional, user-triggered (tap map / use GPS) | App functionality (place reports/notes on the map) | Yes, the point is shown on the map |
| **Photos** (optional incident image) | Yes | Optional | App functionality (illustrate a report) | Yes, shown on the report |
| **Email address** / **phone** on an incident report | Yes | Optional | App functionality (lets admins verify a report) | No, stripped from public responses; admin-only |
| **Name / phone / email** on a Helping Hand street note | Yes | Optional | App functionality (let helpers make contact) | Only if the author sets `contact_public` = true |
| **In-app messages** (community chat) + **other UGC** (reports, notes) | Yes | Required to post (optional to use the app) | App functionality | Yes |
| **IP address** | Processed transiently | n/a | Security/anti-abuse (rate limiting, Cloudflare Turnstile) | No, not stored in the database |

Notes for the form:
- There are **no accounts**, so no user IDs, passwords, or profile data are collected.
- IP is **processed ephemerally** for security and is not persisted — declare it as "processed ephemerally" rather than "collected".

## Data sharing (third parties that receive data)

- **Cloudinary** - stores optional uploaded images.
- **Cloudflare Turnstile** - receives IP + a challenge token for bot protection.
- **OpenStreetMap Nominatim** - receives coordinates for reverse geocoding (address lookup).
- **CARTO / OpenStreetMap tile servers** - serve map tiles (receive viewport + IP).
- Infrastructure (processors, not "sharing" for sale): **Render** (backend), **MongoDB Atlas** (database), **Netlify** (frontend).

No data is sold. No data is used for advertising or tracking across apps.

## Security and handling answers

- **Encrypted in transit:** Yes (HTTPS end-to-end).
- **Users can request deletion:** No in-app account deletion (anonymous app). Provide the support email `communitymap@outlook.com` for content-removal requests; admins can remove any report/note/chat message; street notes also auto-expire (server TTL).
- **Committed to Play Families policy:** only if you target children (you should set the target audience to adults/teens, not children).

## User-generated content (UGC) declaration

Play requires public-UGC apps to offer reporting and blocking plus moderation.
This app satisfies all three:

- **Report objectionable content:** in-app report flow on incidents, street notes, and chat messages (categories: misinformation, harassment, spam, violence, privacy, other).
- **Block users:** client-side user-level block/mute (on-device), available from the content overflow menu.
- **Moderation:** authenticated admin can remove incidents, notes, and chat messages, and pin/verify content.

## Store listing safety/review notes (paste into "Notes for review")

- This is a community awareness tool, **not an emergency service**. In-app guidance directs users to call **000** for emergencies.
- All content is user-generated and **moderated**; reports, chat, and images can be removed by admins, and users can report and block.
- **Location and contact details are optional and user-initiated**; report contact info is not shown publicly, and Helping Hand contact details are shown only when the author explicitly opts in.

## Category and metadata

- Primary category: **Maps & Navigation** (Social as a secondary tag if desired).
- Privacy policy: `https://commap.netlify.app/privacy.html`
- Support: `https://commap.netlify.app/support.html`
- Terms: `https://commap.netlify.app/terms.html`
- Target API level: **35 (Android 15)** - Bubblewrap targets a recent SDK by default; confirm before upload.
