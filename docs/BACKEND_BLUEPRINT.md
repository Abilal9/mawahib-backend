# Mawahib Backend Blueprint

**Status:** Architecture reference — not an implementation  
**Audience:** Backend engineers, tech leads, frontend API consumers  
**Derived from:** `mawahib-ui-prototype` domain types, repositories, services, contexts, and screens  
**Stack:** NestJS · TypeScript · Prisma · PostgreSQL · Supabase (Auth / Storage / optional Realtime)

> React Native → NestJS API → Services → Repository interfaces → Prisma → PostgreSQL  
> Supabase is infrastructure only. The mobile app must never call Supabase for domain CRUD.

---

## Executive Summary

Mawahib is a two-sided talent marketplace (`talent` | `business`) with social feed, profile/portfolio/services, job listings, work engagements (hire → pay → deliver → review), messaging, connections, and notifications.

The NestJS foundation already validates config, Prisma connectivity, and health. This blueprint defines the **domain model, schema intent, modules, APIs, authz, storage, and phased delivery** so implementation can proceed without redesign.

**Guiding decisions**

1. **Single write path:** All domain mutations go through Nest. Prisma owns application tables.
2. **Supabase Auth on client; Nest verifies JWT** (JWKS preferred). Nest creates/links the app `users` row after signup.
3. **Supabase Storage** for media via Nest-issued signed upload URLs (or short-lived tokens). No public write buckets for user content.
4. **Work engagement** (`UserJob` in the UI) is the commercial core — separate from explore `JobListing`.
5. **Catalog explore** (talents / services / jobs) is primarily **query projections** over users, profile services, and listings — not a parallel write model.
6. **Currency:** standardize on **SAR** (`SAR`) for MVP; migrate UI away from AED/﷼ inconsistency.
7. **Postpone:** Premium subscriptions, availability calendars as a product, reporting/moderation tools, Elasticsearch, group chat, Stories-as-product (optional Phase 5+).

---

## 1. Domain Model

Entities below are derived from the frontend. Names in parentheses are UI labels.

### 1.1 User

| | |
|---|---|
| **Purpose** | Canonical account identity for the app (linked to Supabase Auth) |
| **Owner** | Self (profile fields); platform for verification flags |
| **Relationships** | 1:1 Profile; 1:N posts, listings, engagements, messages, notifications, reviews; M:N connections |
| **Lifecycle** | Created on signup → active → soft-deleted / banned |
| **Screens** | AccountType, SignUp, SignIn, ConfirmCode, Profile, UserProfile, Settings, Search |
| **Extensions** | Admin roles, KYC, device tokens, locale |

### 1.2 Profile (Talent / Business facets)

| | |
|---|---|
| **Purpose** | Public-facing profile content (bio, about sections, stats denorm) |
| **Owner** | User |
| **Relationships** | Owned by User; has languages, education, experience, certifications, talents, portfolio, services |
| **Lifecycle** | Empty after signup → filled via setup / edit screens |
| **Screens** | Profile, EditProfile, EditAboutSection, ProfileSetup, UserProfile |
| **Extensions** | Visibility (public/connections/private), business org name |

**Note:** Do **not** split TalentProfile / BusinessProfile into separate tables for MVP. Use `account_type` on `users` + optional business fields. Account type changes are rare and product-gated.

### 1.3 ProfileLanguage / Education / Experience / Certification

| | |
|---|---|
| **Purpose** | About-tab structured rows |
| **Owner** | Profile owner |
| **Relationships** | N:1 Profile (User) |
| **Lifecycle** | CRUD by owner |
| **Screens** | EditAboutSection, About tab |
| **Extensions** | Verification of credentials |

### 1.4 TalentTag (skills / talents chips)

| | |
|---|---|
| **Purpose** | Searchable skill/talent labels on a profile |
| **Owner** | Profile owner |
| **Relationships** | M:N User ↔ Tag (or array of strings for MVP) |
| **Lifecycle** | Set during setup / edit |
| **Screens** | ProfileSetup skills, Search talent filters |
| **Extensions** | Canonical taxonomy + synonyms |

**MVP recommendation:** `text[]` or join table `user_skills(skill_slug)`. Prefer join table if search/filter volume grows.

### 1.5 PortfolioProject + PortfolioMedia

| | |
|---|---|
| **Purpose** | Showcase work with ordered media |
| **Owner** | Profile owner |
| **Relationships** | Project N:1 User; Media N:1 Project |
| **Lifecycle** | Create → reorder media → update → soft-delete |
| **Screens** | AddPortfolioProject, PortfolioProjectDetail, ManageProfileList |
| **Extensions** | Case-study text, client name, external links |

### 1.6 ServiceOffering + ServicePackage + ServiceAddon

| | |
|---|---|
| **Purpose** | Profile services (hireable packages) — **not** the same as explore catalog DTO alone |
| **Owner** | Talent (primarily); business may list later |
| **Relationships** | Offering N:1 User; packages/addons N:1 Offering |
| **Lifecycle** | Draft/published → updated → archived |
| **Screens** | AddProfileService, ServiceDetail, RequestService, ManageProfileList |
| **Extensions** | Inventory, custom offers, multi-currency |

### 1.7 Post + PostMedia + Comment + PostLike + PostSave

| | |
|---|---|
| **Purpose** | Social feed |
| **Owner** | Author (post); commenter (comment); actor (like/save) |
| **Relationships** | Post N:1 User; media/comments/likes/saves N:1 Post |
| **Lifecycle** | Create → engage → soft-delete |
| **Screens** | Home, PostDetail, PostCreate, UserPosts, Photo/Video capture flows |
| **Extensions** | Shares as entity, hashtags, mentions, reports |

### 1.8 Story + StoryItem *(Should Have / later)*

| | |
|---|---|
| **Purpose** | Ephemeral media on home |
| **Owner** | User |
| **Relationships** | Story N:1 User; items N:1 Story; views N:1 Story |
| **Lifecycle** | Publish → expire (24h) → purge |
| **Screens** | StoryViewer, Home |
| **Extensions** | Highlights |

### 1.9 JobListing

| | |
|---|---|
| **Purpose** | Public/open job post in explore & Jobs “posted” |
| **Owner** | Poster (typically business) |
| **Relationships** | N:1 User (poster); 1:N applications (engagements) |
| **Lifecycle** | open → in_progress → completed \| cancelled |
| **Screens** | PostJob, JobListingDetail, Search jobs, Home explore |
| **Extensions** | Budget range structured fields, company profile |

### 1.10 WorkEngagement *(frontend: UserJob / JobApplication)*

| | |
|---|---|
| **Purpose** | Bilateral commercial engagement (apply, service request, hire, pay, deliver, review) |
| **Owner** | Shared: `client_user_id` + `provider_user_id` (derived from type/counterpart in UI) |
| **Relationships** | Optional listing; optional service offering; N:1 each party; 1:N status events; 0:1 payment; 0:1 review |
| **Lifecycle** | See Enums §4 (strict state machine) |
| **Screens** | Jobs, JobInProgress, RequestService, ConfirmPayment, WriteReview, Notifications |
| **Extensions** | Milestones, disputes, escrow release rules |

**Design fix vs UI:** Persist **absolute roles** (`client_id`, `provider_id`) instead of view-relative `type: received|sent`. API maps to received/sent for the current user.

### 1.11 EngagementDetail / AddonLine *(frontend: UserJobDetails)*

| | |
|---|---|
| **Purpose** | Snapshot of package, addons, price, notes, attachments, location at request time |
| **Owner** | Engagement |
| **Relationships** | 1:1 Engagement |
| **Lifecycle** | Created with request; mutable during “request edits” |
| **Screens** | JobInProgress, RequestService |
| **Extensions** | Versioned change proposals |

### 1.12 Connection

| | |
|---|---|
| **Purpose** | Social graph request/accept |
| **Owner** | Requester / addressee |
| **Relationships** | User ↔ User (directed then undirected when connected) |
| **Lifecycle** | none → outgoing/incoming → connected \| cancelled \| denied |
| **Screens** | Connections, Search connect buttons, UserProfile |
| **Extensions** | Follow vs connect distinction |

### 1.13 Conversation + ConversationParticipant + Message

| | |
|---|---|
| **Purpose** | 1:1 messaging |
| **Owner** | Participants |
| **Relationships** | Conversation 1:N messages; M:N users via participants |
| **Lifecycle** | Created on first message or on connect; messages append-only |
| **Screens** | MessagesInbox, Chat |
| **Extensions** | Attachments, typing, groups |

### 1.14 Notification

| | |
|---|---|
| **Purpose** | In-app activity + actionable job prompts |
| **Owner** | Recipient user |
| **Relationships** | N:1 User; optional FKs to post, listing, engagement, conversation, actor |
| **Lifecycle** | Created by system → read → optional action cleared → archived |
| **Screens** | Notifications |
| **Extensions** | Push/email channels, preferences |

### 1.15 Review

| | |
|---|---|
| **Purpose** | Rating after completed engagement |
| **Owner** | Author; subject is reviewed user (and optional service) |
| **Relationships** | N:1 author, N:1 subject, 0:1 engagement, optional media |
| **Lifecycle** | Submit once per engagement/author → editable short window → locked |
| **Screens** | WriteReview, Reviews |
| **Extensions** | Provider↔client mutual reviews |

### 1.16 Payment + PaymentMethod *(MVP skeleton)*

| | |
|---|---|
| **Purpose** | Record payment attempts/results for engagements |
| **Owner** | Payer (client); platform settles |
| **Relationships** | N:1 Engagement; N:1 User (payer) |
| **Lifecycle** | requires_payment → processing → succeeded \| failed \| refunded |
| **Screens** | ConfirmPayment, ApplePay, ScanCard |
| **Extensions** | Escrow, payouts to provider, invoices |

### 1.17 MediaAsset

| | |
|---|---|
| **Purpose** | Normalized file metadata for all uploads |
| **Owner** | Uploader |
| **Relationships** | Polymorphic attach (post, portfolio, service, review, engagement attachment, avatar) |
| **Lifecycle** | upload pending → ready → soft-delete → GC |
| **Screens** | All media flows |
| **Extensions** | Transcoding, virus scan |

### 1.18 Category / ExploreTag *(reference data)*

| | |
|---|---|
| **Purpose** | Filter chips for search/explore |
| **Owner** | Platform |
| **Relationships** | Soft refs on listings/services/users |
| **Lifecycle** | Admin-managed |
| **Screens** | Search, Explore filters |
| **Extensions** | Localized labels |

### 1.19 Explicitly out of MVP schema

| Concept | Frontend | Blueprint decision |
|---------|----------|--------------------|
| Report | Absent | Future |
| Availability / weekly slots | Unregistered ProfileSetupStep5 | Future |
| CalendarEvent | Mock seed only | Future / client-local until productized |
| Premium plans | Display only | Future |
| CatalogService / Talent as tables | Explore DTOs | **Views/queries**, not separate write models |

---

## 2. Database Blueprint

Conventions for all tables unless noted:

- PK: `id uuid` default `gen_random_uuid()`
- `created_at timestamptz` default `now()`, `updated_at timestamptz` default `now()`
- Soft delete: `deleted_at timestamptz null` where user content can be recovered
- Money: `amount numeric(12,2)` + `currency char(3)` (`SAR`)
- Auth link: `users.id` = Supabase `auth.users.id` (uuid)

### 2.1 `users`

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| id | uuid | N | — | = auth.users.id |
| account_type | enum | N | — | talent \| business |
| email | citext | N | — | unique |
| display_name | text | N | — | |
| username | citext | N | — | unique |
| avatar_media_id | uuid | Y | null | FK media_assets |
| cover_media_id | uuid | Y | null | |
| bio | text | Y | null | |
| title | text | Y | null | role headline |
| location_city | text | Y | null | |
| location_country | text | Y | null | |
| is_verified | boolean | N | false | |
| rating_avg | numeric(3,2) | N | 0 | denormalized |
| rating_count | int | N | 0 | denormalized |
| followers_count | int | N | 0 | denorm from connections |
| following_count | int | N | 0 | |
| posts_count | int | N | 0 | |
| deleted_at | timestamptz | Y | null | |
| created_at / updated_at | timestamptz | N | now() | |

**Indexes:** unique(email), unique(username), (account_type), gin/trgm on display_name+username (search)  
**Ownership:** self  
**Cascade:** soft-delete user; do not hard-delete if financial history exists

### 2.2 `user_skills`

| Column | Type | Null | Notes |
|--------|------|------|-------|
| user_id | uuid | N | FK users ON DELETE CASCADE |
| skill | text | N | normalized slug or label |
| created_at | timestamptz | N | |

**PK:** (user_id, skill)  
**Indexes:** (skill)

### 2.3 `profile_languages` / `profile_educations` / `profile_experiences` / `profile_certifications`

Child tables of `users` (profile owner = user_id).

Common: `id`, `user_id`, ordered fields matching frontend, `position int`, `created_at`, `updated_at`, `deleted_at`.

**FK:** user_id → users ON DELETE CASCADE  
**Ownership:** profile owner

### 2.4 `portfolio_projects`

| Column | Type | Null | Notes |
|--------|------|------|-------|
| id | uuid | N | |
| user_id | uuid | N | FK |
| title | text | N | |
| description | text | N | default '' |
| position | int | N | 0 |
| deleted_at | timestamptz | Y | |
| created_at / updated_at | | | |

### 2.5 `portfolio_media`

| Column | Type | Null | Notes |
|--------|------|------|-------|
| id | uuid | N | |
| project_id | uuid | N | FK CASCADE |
| media_asset_id | uuid | N | FK |
| position | int | N | |
| is_video | boolean | N | false |
| created_at | | | |

### 2.6 `service_offerings`

| Column | Type | Null | Notes |
|--------|------|------|-------|
| id | uuid | N | |
| user_id | uuid | N | provider |
| title | text | N | |
| description | text | N | |
| category | text | Y | explore chip |
| status | enum | N | draft \| published \| archived |
| rating_avg / rating_count | | | denorm |
| currency | char(3) | N | SAR |
| deleted_at | | | |
| created_at / updated_at | | | |

**Indexes:** (user_id, status), (category), full-text title/description

### 2.7 `service_packages`

| Column | Type | Null | Notes |
|--------|------|------|-------|
| id | uuid | N | |
| offering_id | uuid | N | FK CASCADE |
| tier | enum | N | basic \| standard \| premium |
| price | numeric(12,2) | N | |
| currency | char(3) | N | SAR |
| delivery_label | text | N | e.g. "3 days" |
| includes | jsonb | N | string[] |
| created_at / updated_at | | | |

**Unique:** (offering_id, tier)

### 2.8 `service_addons`

| Column | Type | Null | Notes |
|--------|------|------|-------|
| id | uuid | N | |
| offering_id | uuid | N | FK CASCADE |
| title | text | N | |
| price | numeric(12,2) | N | |
| currency | char(3) | N | |
| created_at / updated_at | | | |

### 2.9 `service_media`

Like portfolio_media → offering_id + media_asset_id + position.

### 2.10 `posts`

| Column | Type | Null | Notes |
|--------|------|------|-------|
| id | uuid | N | |
| author_id | uuid | N | FK |
| caption | text | N | |
| location | text | Y | |
| role_label | text | Y | denorm author title at post time optional |
| likes_count / comments_count / shares_count | int | N | 0 |
| deleted_at | | | |
| created_at / updated_at | | | |

**Indexes:** (author_id, created_at desc), (created_at desc)

### 2.11 `post_media` / `post_comments` / `post_likes` / `post_saves`

- **post_media:** post_id, media_asset_id, position  
- **post_comments:** post_id, author_id, body, deleted_at  
- **post_likes / post_saves:** unique(post_id, user_id)

### 2.12 `job_listings`

| Column | Type | Null | Notes |
|--------|------|------|-------|
| id | uuid | N | |
| poster_id | uuid | N | FK users |
| title | text | N | |
| company_name | text | Y | |
| employment_type | enum | N | full_time \| part_time \| contract \| freelance \| gig |
| location | text | N | |
| salary_label | text | Y | keep label MVP; structured later |
| description | text | N | |
| skills | text[] | N | default '{}' |
| explore_tag | text | Y | |
| status | enum | N | open \| in_progress \| completed \| cancelled |
| logo_media_id | uuid | Y | |
| deleted_at | | | |
| posted_at | timestamptz | N | now() |
| created_at / updated_at | | | |

**Indexes:** (status, posted_at desc), (poster_id), gin(skills), explore_tag

### 2.13 `work_engagements`

| Column | Type | Null | Notes |
|--------|------|------|-------|
| id | uuid | N | |
| listing_id | uuid | Y | FK job_listings SET NULL |
| service_offering_id | uuid | Y | FK SET NULL |
| client_id | uuid | N | FK users |
| provider_id | uuid | N | FK users |
| title | text | N | |
| status | enum | N | see §4 |
| due_at | timestamptz | Y | |
| scheduled_at | timestamptz | Y | upcoming |
| source | enum | N | listing_application \| service_request \| direct |
| deleted_at | | | |
| created_at / updated_at | | | |

**Indexes:** (client_id, status), (provider_id, status), (listing_id), (status, updated_at)  
**Check:** client_id <> provider_id

### 2.14 `work_engagement_details`

| Column | Type | Null | Notes |
|--------|------|------|-------|
| engagement_id | uuid | N | PK/FK CASCADE |
| service_name | text | N | |
| package_name | text | N | |
| package_price | numeric(12,2) | N | |
| currency | char(3) | N | SAR |
| addons | jsonb | N | [{name,price}] |
| deadline_label | text | Y | |
| location_url | text | Y | |
| location_city / country / details | text | Y | |
| notes | text | N | '' |
| attachment_media_id | uuid | Y | |
| requested_at | timestamptz | N | |

### 2.15 `work_engagement_events`

Append-only audit: `id`, `engagement_id`, `actor_id`, `from_status`, `to_status`, `payload jsonb`, `created_at`.  
**Never delete.**

### 2.16 `connections`

| Column | Type | Null | Notes |
|--------|------|------|-------|
| id | uuid | N | |
| requester_id | uuid | N | |
| addressee_id | uuid | N | |
| status | enum | N | pending \| accepted \| declined \| cancelled |
| created_at / updated_at | | | |

**Unique:** pair unordered uniqueness via `LEAST/GREATEST` unique index or application rule  
**Indexes:** (addressee_id, status), (requester_id, status)

### 2.17 `conversations` / `conversation_participants` / `messages`

- **conversations:** id, last_message_at, last_message_preview, created_at  
- **conversation_participants:** conversation_id, user_id, last_read_at, unread_count; PK (conversation_id, user_id)  
- **messages:** id, conversation_id, sender_id, body, created_at, deleted_at  

**Unique 1:1:** for MVP enforce at most one conversation per user pair (sorted pair key on conversation).

### 2.18 `notifications`

| Column | Type | Null | Notes |
|--------|------|------|-------|
| id | uuid | N | |
| recipient_id | uuid | N | |
| actor_id | uuid | Y | |
| type | enum | N | |
| title | text | Y | |
| body | text | N | |
| read_at | timestamptz | Y | |
| post_id / listing_id / engagement_id / conversation_id | uuid | Y | |
| actions | text[] | Y | accept, decline |
| show_rating | boolean | N | false |
| created_at | | | |

**Indexes:** (recipient_id, created_at desc), (recipient_id) WHERE read_at IS NULL

### 2.19 `reviews`

| Column | Type | Null | Notes |
|--------|------|------|-------|
| id | uuid | N | |
| engagement_id | uuid | N | unique with author |
| author_id | uuid | N | |
| subject_id | uuid | N | reviewed user |
| service_name | text | Y | |
| rating | int | N | 1–5 check |
| body | text | N | |
| media_asset_id | uuid | Y | |
| created_at / updated_at | | | |

**Unique:** (engagement_id, author_id)  
**Trigger/service:** update subject rating_avg/count

### 2.20 `payments`

| Column | Type | Null | Notes |
|--------|------|------|-------|
| id | uuid | N | |
| engagement_id | uuid | N | |
| payer_id | uuid | N | |
| amount | numeric(12,2) | N | |
| currency | char(3) | N | |
| status | enum | N | |
| provider | text | Y | apple_pay \| card \| mock |
| provider_ref | text | Y | external id |
| failure_code | text | Y | |
| paid_at | timestamptz | Y | |
| created_at / updated_at | | | |

**Indexes:** (engagement_id), (provider_ref) unique where not null

### 2.21 `media_assets`

| Column | Type | Null | Notes |
|--------|------|------|-------|
| id | uuid | N | |
| owner_id | uuid | N | |
| bucket | text | N | |
| object_key | text | N | |
| mime_type | text | N | |
| byte_size | bigint | N | |
| width / height | int | Y | |
| status | enum | N | pending \| ready \| failed |
| created_at / updated_at | | | deleted_at |

**Unique:** (bucket, object_key)

### 2.22 Reference: `explore_tags` / `categories` (optional seed tables)

`slug`, `label`, `domain` (talent|service|job), `position`.

---

## 3. Relationship Map

```text
auth.users (Supabase)
    └── 1:1 users
            ├── 1:N user_skills, profile_*, portfolio_projects, service_offerings, posts
            ├── 1:N job_listings (as poster)
            ├── 1:N work_engagements (as client OR provider)
            ├── 1:N connections (requester/addressee)
            ├── 1:N conversation_participants → conversations → messages
            ├── 1:N notifications, reviews(author|subject), payments(payer), media_assets

portfolio_projects 1:N portfolio_media → media_assets
service_offerings 1:N packages, addons, service_media
posts 1:N post_media, comments; M:N users via likes/saves
job_listings 1:N work_engagements
work_engagements 1:1 details; 1:N events; 0:1..N payments; 0:N reviews
```

| Cardinality | Examples |
|-------------|----------|
| **1:1** | users↔auth; engagement↔details |
| **1:N** | user→posts; offering→packages; conversation→messages |
| **M:N** | users↔users (connections); users↔posts (likes); users↔conversations |

**Deletion strategy**

- Soft-delete user content (posts, offerings, projects).  
- Hard-delete only pending media orphans via job.  
- Financial + engagement_events: **retain**.  
- Connection decline: update status, keep row.  
- Avoid circular FKs: reviews reference users + engagement; engagement does not FK review.

---

## 4. Enums

### `account_type`
`talent` | `business`  
**Transitions:** set at signup; change only via support/admin.

### `profile_visibility` *(future)*
`public` | `connections` | `private`

### `service_offering_status`
`draft` | `published` | `archived`  
**Transitions:** draft→published→archived; archived→published.

### `package_tier`
`basic` | `standard` | `premium`

### `employment_type`
`full_time` | `part_time` | `contract` | `freelance` | `gig`

### `job_listing_status`
`open` → `in_progress` → `completed`  
`open` → `cancelled`  
`in_progress` → `cancelled` (constrained)

### `engagement_status` *(replaces messy UI statuses)*

| Value | Meaning |
|-------|---------|
| `pending` | Awaiting provider decision |
| `changes_requested` | Provider asked edits (UI: sent-for-review) |
| `pending_payment` | Accepted; awaiting client pay |
| `in_progress` | Paid / active work |
| `upcoming` | Scheduled future start (optional) |
| `completed` | Successfully finished |
| `declined` | Provider declined |
| `cancelled` | Either party/admin cancelled |

**Drop for backend:** UI `done` (alias→completed), `sent` (legacy).  
**Allowed transitions (core):**

```text
pending → changes_requested | pending_payment | declined | cancelled
changes_requested → pending_payment | declined | cancelled
pending_payment → in_progress | cancelled
in_progress → completed | cancelled
upcoming → in_progress | cancelled
```

### `engagement_source`
`listing_application` | `service_request` | `direct`

### `connection_status`
`pending` | `accepted` | `declined` | `cancelled`

### `notification_type`
`like` | `comment` | `follow` | `job` | `message` | `system`

### `payment_status`
`created` | `processing` | `succeeded` | `failed` | `refunded`

### `media_status`
`pending` | `ready` | `failed`

### `media_type` *(logical)*
`image` | `video` | `document`

---

## 5. Module Design (NestJS)

| Module | Purpose | Entities | Depends on |
|--------|---------|----------|------------|
| **AuthModule** | JWT validation, current user, signup bootstrap | users | Config, Users |
| **UsersModule** | User CRUD, search identity | users, skills | Media |
| **ProfilesModule** | About sections, portfolio, profile services | profile_*, portfolio_*, offerings | Media, Users |
| **PostsModule** | Feed, comments, likes, saves | posts* | Media, Notifications |
| **JobsModule** | Listings + engagements + details + events | listings, engagements | Payments, Notifications, Profiles |
| **ConnectionsModule** | Graph requests | connections | Notifications, Messages |
| **MessagesModule** | Conversations & messages | conversations, messages | Users |
| **NotificationsModule** | In-app notifications | notifications | — |
| **ReviewsModule** | Reviews + aggregates | reviews | Jobs, Users |
| **PaymentsModule** | Payment intents & webhooks | payments | Jobs |
| **CatalogModule** | Explore read APIs (talents/services/jobs) | queries | Users, Profiles, Jobs |
| **SearchModule** | Unified search (can start inside Catalog) | — | Catalog |
| **MediaModule** | Upload sessions, asset metadata | media_assets | Supabase Storage infra |
| **HealthModule** | Exists | — | Prisma, Supabase |

**Per module pattern:** Controller → Service → Repository interface → Prisma repository in `infrastructure` or `modules/*/repositories`.

**DTO folders:** `dto/request`, `dto/response` per module.  
**Growth:** split Jobs into ListingsModule + EngagementsModule when file size warrants.

---

## 6. Repository Contracts

Interfaces only (no implementations).

### UserRepository
`findById`, `findByEmail`, `findByUsername`, `create`, `update`, `softDelete`, `search({q, accountType, skills, cursor})`, `updateCounts`

### ProfileRepository
`getAbout(userId)`, `replaceLanguages`, `replaceEducations`, `replaceExperiences`, `replaceCertifications`, `setBio`, `setSkills`

### PortfolioRepository
`listByUser`, `findById`, `create`, `update`, `softDelete`, `setMediaOrder`

### ServiceOfferingRepository
`listByUser`, `findById`, `create`, `update`, `setStatus`, `upsertPackages`, `upsertAddons`, `setMedia`

### PostRepository
`listFeed({cursor})`, `listByAuthor`, `findById`, `create`, `softDelete`, `addComment`, `listComments`, `like`, `unlike`, `save`, `unsave`

### JobListingRepository
`list({filters, cursor})`, `findById`, `create`, `update`, `setStatus`

### WorkEngagementRepository
`listForUser({role, status, section, sort})`, `findById`, `create`, `updateStatus`, `upsertDetails`, `addEvent`, `findOpenByListingAndClient`

### ConnectionRepository
`getRelation(a,b)`, `listConnected`, `listIncoming`, `listOutgoing`, `request`, `accept`, `decline`, `cancel`, `disconnect`

### ConversationRepository
`listForUser`, `findByIdForUser`, `findOrCreateDm(userA,userB)`, `listMessages({cursor})`, `appendMessage`, `markRead`

### NotificationRepository
`listForUser`, `markRead`, `markAllRead`, `create`, `clearActions`, `clearRatingPrompt`, `softDelete`

### ReviewRepository
`listForSubject`, `getBundle(subjectId)`, `create`, `findByEngagementAuthor`

### PaymentRepository
`create`, `updateStatus`, `findById`, `findByProviderRef`, `listByEngagement`

### MediaAssetRepository
`createPending`, `markReady`, `findById`, `softDelete`, `listOrphans`

### CatalogQueryRepository *(read model)*
`listTalents`, `listServices`, `listJobListings` with explore filters

---

## 7. Service Layer Responsibilities

| Belongs in Service | Never in Controller |
|--------------------|---------------------|
| State machine transitions | Direct Prisma/Supabase calls |
| Authz checks (owner/participant) | Business branching |
| Input normalization + domain validation | Multi-step transactions without service |
| Emitting notifications | Payment provider crypto/signing details (use PaymentsService) |
| Transactions (`prisma.$transaction`) | Aggregating unrelated domains |
| Denormalized counter updates | |

**Transaction boundaries (examples)**

- Accept engagement: status event + notification  
- markPaid: payment succeeded + engagement→in_progress + notification  
- complete + review: engagement completed + review insert + rating recompute  
- accept connection: connection accepted + optional conversation ensure + notification  

---

## 8. REST API Specification

Base: `/api/v1` · Auth: Bearer Supabase access token unless noted.

### Auth / Users
| Method | Route | Purpose | Auth | Roles |
|--------|-------|---------|------|-------|
| POST | `/auth/bootstrap` | Create app user after Supabase signup | JWT | any new |
| GET | `/users/me` | Current user + profile summary | JWT | user |
| PATCH | `/users/me` | Update profile basics | JWT | owner |
| GET | `/users/:id` | Public profile header | JWT/optional | — |
| GET | `/users` | Search users | JWT | — |

### Profiles
| Method | Route | Purpose |
|--------|-------|---------|
| GET/PUT | `/users/me/about` | About aggregate |
| POST/PATCH/DELETE | `/users/me/languages/:id` etc. | Section CRUD (or bulk PUT) |
| CRUD | `/users/me/portfolio` | Projects + media order |
| CRUD | `/users/me/services` | Offerings/packages/addons |

### Posts
| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/posts` | Feed |
| POST | `/posts` | Create |
| GET | `/posts/:id` | Detail |
| POST | `/posts/:id/comments` | Comment |
| POST/DELETE | `/posts/:id/likes` | Like toggle |
| POST/DELETE | `/posts/:id/saves` | Save toggle |
| GET | `/users/:id/posts` | User posts |

### Jobs
| Method | Route | Purpose |
|--------|-------|---------|
| GET/POST | `/job-listings` | List/create |
| GET/PATCH | `/job-listings/:id` | Detail/update |
| POST | `/job-listings/:id/applications` | Apply → engagement |
| GET | `/engagements` | My jobs (received/sent filters) |
| GET | `/engagements/:id` | Detail |
| POST | `/engagements` | Service request create |
| POST | `/engagements/:id/accept` | → pending_payment |
| POST | `/engagements/:id/decline` | |
| POST | `/engagements/:id/request-changes` | |
| POST | `/engagements/:id/complete` | |
| POST | `/engagements/:id/pay` | Start payment |

### Connections
| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/connections` | Lists by tab |
| POST | `/connections/:userId/request` | |
| POST | `/connections/:userId/accept` | |
| POST | `/connections/:userId/decline` | |
| DELETE | `/connections/:userId` | Disconnect / cancel |

### Messages
| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/conversations` | Inbox |
| GET | `/conversations/:id/messages` | History |
| POST | `/conversations/:id/messages` | Send |
| POST | `/conversations/dm/:userId` | Open/create DM |

### Notifications
| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/notifications` | List + filters |
| POST | `/notifications/read-all` | |
| POST | `/notifications/:id/read` | |
| POST | `/notifications/:id/clear-actions` | |

### Reviews / Payments / Media / Catalog
| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/users/:id/reviews` | Bundle |
| POST | `/engagements/:id/reviews` | Submit |
| POST | `/payments/webhooks/:provider` | **No user JWT**; signed |
| POST | `/media/upload-sessions` | Signed upload |
| GET | `/catalog/talents` `/services` `/jobs` | Explore |

**Errors (standard):** `400` validation, `401` unauthenticated, `403` forbidden, `404` missing, `409` illegal state transition, `422` domain rule, `429` rate limit.

**Frontend mapping:** each screen in §1 maps to the routes above (JobsScreen→`/engagements`, RequestService→`POST /engagements`, etc.).

---

## 9. Authentication Design

```text
RN App                    Supabase Auth              Nest API
  │  signUp/signIn/OTP          │                       │
  │────────────────────────────>│                       │
  │  access + refresh tokens    │                       │
  │<────────────────────────────│                       │
  │  POST /auth/bootstrap + Bearer                      │
  │────────────────────────────────────────────────────>│
  │                         verify JWT (JWKS)            │
  │                         upsert users row             │
  │  subsequent API calls + Bearer                      │
  │────────────────────────────────────────────────────>│
```

| Concern | Design |
|---------|--------|
| Signup/Login/Logout/Reset/Verify | **Supabase Auth** (client SDK) |
| Session restore / refresh | Supabase client |
| API auth | `Authorization: Bearer <access_token>` |
| Verification | Passport JWT + **JWKS** (`SUPABASE_JWT_JWKS_URL`); HS256 secret only as fallback |
| Current user | `@CurrentUser()` → `users` row by `sub` |
| Roles | `account_type` + future `platform_role` |
| Profile creation | Bootstrap creates empty profile; setup screens PATCH |

**Nest does not** implement password login endpoints for MVP.

---

## 10. Authorization Matrix

Roles: **Guest**, **User** (authenticated), **Talent**, **Business**, **Owner**, **Admin** (future).

| Resource | Guest | User | Owner | Notes |
|----------|-------|------|-------|-------|
| Public profiles / published services / open listings / public posts | R | R | R/W own | |
| Feed create | — | C | — | |
| Engagement create (request/apply) | — | C | — | business↔talent rules in service |
| Engagement accept/decline | — | — | Provider | |
| Pay | — | — | Client | |
| Complete | — | — | Client or provider (product rule: either with confirm) | Prefer client confirms delivery |
| Messages | — | participants only | | |
| Notifications | — | recipient | | |
| Admin overrides | — | — | — | Admin future |

Talent vs Business: enforce at service layer (e.g. only business posts certain listings; talents publish services) — keep soft for MVP if UI allows both.

---

## 11. RLS Strategy

| Layer | Responsibility |
|-------|----------------|
| **Nest services** | Primary authorization for all domain tables accessed via Prisma |
| **Supabase RLS** | Mandatory on **Storage** objects; optional defense-in-depth on tables **only if** client ever reads SQL directly (avoid for MVP) |
| **Auth schema** | Managed by Supabase |

**MVP:** No direct PostgREST for app tables → RLS on `public` app tables is optional. Prefer network isolation (service role only on server).  
**Never** ship `SUPABASE_SECRET_KEY` to the client.

Ownership rules for Storage RLS: `owner_id = auth.uid()` for write; public read only for `avatars` / published portfolio if product requires CDN-public; else signed URLs only.

---

## 12. Storage Design

| Bucket | Visibility | Types | Limits (start) | Ownership | Lifecycle |
|--------|------------|-------|----------------|-----------|-----------|
| `avatars` | public read | jpeg/png/webp | 5 MB | user | replace on update |
| `covers` | public read | image | 10 MB | user | replace |
| `portfolio` | private + signed | image/video | 50 MB | user | soft-delete |
| `services` | private + signed | image | 20 MB | user | with offering |
| `posts` | private + signed | image/video | 50 MB | user | with post |
| `chat` | private | image/file | 20 MB | participants | retention policy |
| `engagement-docs` | private | pdf/doc | 20 MB | engagement parties | retain with engagement |
| `reviews` | private + signed | image | 10 MB | author | with review |

Uploads: `POST /media/upload-sessions` → client PUTs to signed URL → webhook/callback marks `media_assets.ready`.

---

## 13. Realtime Strategy

Use Realtime **sparingly**:

| Use | Mechanism |
|-----|-----------|
| New messages / unread | Supabase Realtime on `messages` **or** Nest websocket later — MVP: poll inbox every N s / refetch on focus |
| Notifications badge | Same — poll or light Realtime on `notifications` for recipient |
| Typing indicators | Postpone |
| Job status | Push notification + refetch; no live channel required |

**Do not** realtime the social feed for MVP.

---

## 14. Search Design

| Entity | Filters | Sort | Indexing |
|--------|---------|------|----------|
| Talents | q, skills, location, tags | recommended, top-rated, newest | trgm + skill index; rating |
| Services | q, category, price, location | price, rating, newest | title FTS |
| Jobs | q, employment_type, location, tag | newest | FTS + enums |

**MVP:** Postgres `pg_trgm` + `tsvector` generated columns.  
**Future:** OpenSearch when volume/latency demands; keep Nest SearchModule as facade.

---

## 15. Payment Design

```text
pending_payment → create Payment(created)
    → client confirms Apple Pay / card (PSP)
    → webhook → processing → succeeded
    → engagement in_progress
```

| Topic | Decision |
|-------|----------|
| PSP | Choose later (Stripe/Tap/Apple); Nest owns webhook signature verify |
| Escrow | **Postpone** — record payment success; manual payout ops initially |
| Payouts | Future provider accounts |
| Idempotency | `provider_ref` unique; webhook retries safe |
| Currency | SAR only MVP |

Business rules: cannot `in_progress` without succeeded payment (except admin waive).

---

## 16. Notification Design

**Events → type**

| Event | type | actions |
|-------|------|---------|
| Connection request | follow | — |
| Engagement requested | job | accept, decline |
| Engagement accepted / declined / paid / completed | job | — |
| Rating prompt | job | show_rating |
| New message | message | — |
| Like/comment | like/comment | — |
| Platform | system | — |

**Channels:** in-app (MVP) → push (device tokens table later) → email (transactional later).  
**Preferences:** future table `notification_preferences`.

---

## 17. Implementation Roadmap

### Phase 0 — Foundation *(done)*
Health, config, Prisma connectivity, Auth stub.

### Phase 1 — Auth + Users + Profiles
**Tables:** users, skills, profile_*, media_assets (avatars)  
**API:** bootstrap, users/me, about CRUD  
**Screens unlocked:** SignUp/SignIn → Profile edit basics, ProfileSetup 1–2  
**Tests:** auth guard, profile ownership  
**Acceptance:** JWT user can read/write own profile; visitor can read public profile

### Phase 2 — Media + Portfolio + Services
**Tables:** portfolio_*, service_*  
**API:** upload sessions, portfolio/services CRUD  
**Screens:** AddPortfolio, AddProfileService, ServiceDetail  
**Acceptance:** signed upload → attach → list on profile

### Phase 3 — Catalog Search + Job Listings
**Tables:** job_listings, categories/tags  
**API:** catalog + listings CRUD  
**Screens:** Search, PostJob, JobListingDetail  
**Acceptance:** filters return consistent results

### Phase 4 — Work Engagements + Payments skeleton
**Tables:** work_engagements, details, events, payments  
**API:** apply, request service, accept/decline/changes/pay/complete  
**Screens:** Jobs, JobInProgress, RequestService, ConfirmPayment (mock PSP OK)  
**Acceptance:** illegal transitions return 409; pay moves to in_progress

### Phase 5 — Connections + Messaging + Notifications
**Tables:** connections, conversations, messages, notifications  
**API:** full social graph + DM send + notifications  
**Screens:** Connections, Chat, Notifications  
**Acceptance:** send persists; accept connection works; actionable notifications

### Phase 6 — Posts Feed + Reviews
**Tables:** posts*, reviews  
**API:** feed + reviews bundle  
**Screens:** Home, PostCreate, PostDetail, WriteReview, Reviews  
**Acceptance:** review updates rating_avg; one review per engagement/author

### Phase 7 — Hardening
JWKS-only JWT, push notifications, rate limits, CI, observability, Stories optional.

Each phase is independently testable with e2e against `/api/v1/health` + module e2e.

---

## 18. MVP vs Future

| Must Have | Should Have | Nice To Have | Future |
|-----------|-------------|--------------|--------|
| Auth bootstrap + profiles | Posts feed | Stories | Premium |
| Services + portfolio + media | Likes/saves/comments | Typing indicators | Escrow/payouts |
| Listings + engagements + pay skeleton | Realtime notifications | Availability calendar | OpenSearch |
| Connections + DM | Explore polish | Groups | Reports/moderation |
| Notifications in-app | Mutual reviews | Share tracking | Multi-currency |
| Reviews on complete | Push | | Admin console |

---

## 19. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Engagement state complexity | Explicit FSM + events table; no ad-hoc status strings |
| Direct DB exposure | Nest-only writes; no PostgREST for app tables |
| Media abuse | Size/MIME limits, virus scan later, private buckets |
| Payment webhook fraud | Signature verify, idempotency keys |
| Search latency | Postgres indexes first; facade for later search engine |
| Counters drift | Recompute jobs + transactional increments |
| Supabase lock-in | Prisma + Auth/Storage adapters behind infra modules |
| Chat scale | Cursor pagination; postpone Realtime |
| IPv6/direct DB issues | Session pooler `DATABASE_URL` (already required) |

---

## 20. Final Review

### Would you build Mawahib this way?
**Yes**, with the simplifications below.

### Change / simplify
1. Absolute `client_id`/`provider_id` instead of view-relative received/sent storage.  
2. Collapse legacy statuses (`done`, `sent`).  
3. Catalog as read models, not duplicate tables.  
4. Single currency SAR for MVP.  
5. Defer Stories, Premium, Availability, Reports.

### Postpone
Realtime feed, escrow, Elasticsearch, admin RBAC, group chat.

### Acceptable debt
Denormalized counters; mock/sandbox PSP in Phase 4; poll-based inbox initially.

### Never acceptable
- Client holding service-role key  
- Domain writes via `supabase.from` from RN  
- Status changes without authz + event audit for paid engagements  
- Secrets in git  

---

## Final Recommendations

1. Treat this document as the source of truth; update it when product changes.  
2. Implement **Phase 1** next (Auth bootstrap + Users/Profiles).  
3. Introduce repository interfaces with the first module — do not skip straight to Prisma in controllers.  
4. Finish JWKS verification before any sensitive engagement/payment endpoints ship.  
5. Keep frontend repository interfaces aligned with these Nest routes during the swap from mocks.

---

## Approval

> **If you were the Lead Solution Architect for Mawahib, would you approve this backend architecture before implementation begins?**

### **Yes — approved to begin Phase 1 implementation.**

No redesign blockers remain. Connectivity and foundation are validated. The domain map matches the shipped UI prototype with deliberate simplifications (FSM cleanup, SAR, catalog-as-query, deferred Stories/Premium).

**Do not start Phase 4+ payments with production money until webhook + idempotency + JWKS are done.** Phases 1–3 can proceed immediately.
