# Security Specification for Vocab Jam Arena

## Data Invariants
1. A Room must have a unique 4-letter ID (handled by document ID).
2. A Player cannot exist without a valid Room.
3. Players can only update their own score and `lastAnsweredIndex`.
4. Only the Host (identified by `hostId`) can start the game, change questions, or end the game.
5. Nicknames must be unique within a room (this is enforced at the application layer before joining, but rules can prevent simple reuse if we knew all nicknames, but query checks in rules are expensive or impossible for uniqueness without specialized collections. We will rely on query check in app + rules to ensure users only write to their own Player document).

## The "Dirty Dozen" Payloads (Denial Tests)
1. Join room with a 1MB nickname string.
2. Join room and try to set `score` to 999999.
3. As a player, try to update the `rooms/{roomId}` status to `active`.
4. As a player, try to update another player's score.
5. Create a room with a fake `createdAt` (client time instead of server time).
6. Update a room without providing `updatedAt`.
7. Try to delete a room as a player.
8. Inject a "Ghost Field" `isAdmin: true` into the `Player` document.
9. Change `hostId` of an existing room.
10. Update `lastAnsweredIndex` to a value higher than current question index (well, we can't easily check current index vs question count without a `get`, which we will do in the "Master Gate").
11. Update a player document after the room status is `ended`.
12. Create a question with 100 distractors.

## Red Team Audit Strategy
- Verify `affectedKeys().hasOnly()` on all updates.
- Ensure `isOwner()` or `isHost()` for sensitive paths.
- Validate types and sizes.
