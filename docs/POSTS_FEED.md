# Posts + Hybrid Home Feed

Canonical contract for the Mawahib social feed vertical slice.

**Architecture:** Expo → NestJS → Prisma → Supabase PostgreSQL  
**Media:** Nest signed upload → Supabase Storage (`posts` bucket) → `media_assets` → `PostMedia`

---

## Product behavior

Home feed is **hybrid**:

| Source | Rule |
|--------|------|
| `self` | `authorId == viewer` |
| `connection` | Active `Connection` (`endedAt` null) with author |
| `discovery` | Public post from non-connected, non-self author |

Pending connection requests do **not** change `feedSource` (still `discovery`). After accept + refresh → `connection`.

**Mix (deterministic):** ~70% social / ~30% discovery when both pools have content. Zipper pattern `S S S D`. Empty social → 100% discovery (new users). Dual opaque cursor (social + discovery watermarks).

**Visibility:** `PostVisibility = public | connections` (default `public`). Connections-only posts never enter discovery.

**Post image limit:** maximum **4** images per post (`MAX_POST_IMAGES`). Enforced in Nest `CreatePostDto` / `PostsService` and the Expo Post creator (counter `0/4`–`4/4`).

**Stories:** Deferred — Home hides Stories row.  
**Reviews aggregation:** Deferred — Home hides rating when `ratingCount === 0`.  
**Comment report UI:** Implemented on PostDetail (Jobs-style deferred sheet). **No** `CommentReport` model / Nest report API yet — full moderation/persistence is deferred.

---

## APIs

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/v1/feed?cursor&limit` | JWT |
| POST | `/api/v1/posts` | JWT |
| GET | `/api/v1/posts/:id` | JWT |
| DELETE | `/api/v1/posts/:id` | JWT (author) |
| POST/DELETE | `/api/v1/posts/:id/likes` | JWT |
| GET | `/api/v1/posts/:id/likes` | JWT (same visibility as post) |
| POST/DELETE | `/api/v1/posts/:id/saves` | JWT |
| GET/POST | `/api/v1/posts/:id/comments` | JWT |
| DELETE | `/api/v1/comments/:id` | JWT (comment author **or** post owner) |
| GET | `/api/v1/users/:userId/posts` | JWT |

Connections CTAs reuse existing Connections APIs.

**Social notifications** (existing Notifications domain):

| Type | When | Recipient | Notes |
|------|------|-----------|-------|
| `post_liked` | New `PostLike` created | Post author | No self-like notify; duplicate like → no second notif; unlike keeps historical notif |
| `post_commented` | New `PostComment` created | Post author | No self-comment notify; preview ≤100 chars in payload |

**No** notifications for: saves, views, shares.

**Public profile:** `GET /users/:id` and `GET /users/:id/public` return `PublicProfileDto` (no email/phone). Owner private data remains on `GET /users/me`.

---

## Schema

`Post`, `PostMedia`, `PostLike`, `PostComment`, `PostSave`  
Enums: `PostVisibility`, `MediaPurpose.post`  
Notification types: `post_liked`, `post_commented`  
Migrations (applied on shared Dev DB):

- `20260826180000_posts_hybrid_feed`
- `20260827140000_post_social_notifications`

Soft-delete: `Post.deletedAt`, `PostComment.deletedAt`. Soft-deleted posts/comments stay in Postgres; Storage objects for post media are **intentionally retained** until Account Lifecycle / media cleanup.

Uniqueness: `PostLike` / `PostSave` composite PK `(postId, userId)`; `PostMedia` unique `(postId, position)` and `(postId, mediaAssetId)`.

---

## FeedPostDto

Includes `feedSource`, public `author`, `relationship { status, connectionRequestId }`, text, media URLs, engagement, timestamps. Never email/phone.

Likes list items use the same public author summary: **displayName + title** (title omitted when empty). No user-facing `@username`.

---

## Home carousels

Jobs / Services / Talents remain on existing explore & job-listing endpoints — not inside `/feed`.

## Validation status (2026-08-27 final audit)

| Layer | Status |
|-------|--------|
| Automated backend tests (`npm test`, 173) | **PASS** |
| Backend build + `prisma validate` | **PASS** |
| Frontend `tsc --noEmit` + posts/comments/social-notifications/auth/avatar selftests | **PASS** |
| Multi-user Nest API + Postgres + Storage E2E | **PASS** (script `scripts/final-posts-social-audit.mjs` + connection CTA) |
| Manual Expo local E2E | **NOT RUN** |
| Railway deploy / E2E | **NOT RUN** |

**Freeze posture:** Ready to freeze **after** manual Expo E2E. Do not claim Expo/Railway pass until executed.
