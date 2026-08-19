# Messaging archive model

Narrow contract for conversation archive / soft-delete and the engagement-review → per-user archive bridge. Commercial amounts shown in work chats must follow [`COMMERCIAL_MODEL.md`](./COMMERCIAL_MODEL.md). Overall messaging status: [`ROADMAP.md`](./ROADMAP.md).

## Two archive concepts

| Field | Where | Meaning |
| --- | --- | --- |
| `Conversation.archivedAt` | Conversation row | Legacy / conversation-level lock. When set, the thread is read-only for everyone. **No longer** set automatically when work is `completed`. |
| `ConversationParticipant.archivedAt` | Per user | Hides the chat from that user's **inbox**; still listed under `?scope=archived`. Does not by itself make the thread read-only. |
| `ConversationParticipant.deletedAt` | Per user | Soft-hide: excluded from inbox **and** archived lists for that user. Peer still sees the conversation. |

## Work completion flow

1. Engagement → `completed` → system message in work chat; chat stays in **inbox**, **read-only** (engagement status).
2. User submits `POST /engagements/:id/reviews` → review saved → **that user's** participant row is archived (`archiveForParticipant`).
3. Until they rate, completed work chats remain visible in inbox so they can open the thread / rate.

## API

- `GET /users/me/conversations?scope=inbox|archived` (default `inbox`)
- `POST /conversations/:id/archive` / `unarchive`
- `DELETE /conversations/:id` → soft-delete for me (204)
- Unread summary only counts non-archived, non-deleted participations
