# Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Verified Identity Gate**: Every read and write on operational collections (`admins`, `app_config`, `locations`, `products`, `parts`, `sessions`, `entries`) requires `request.auth != null` and `request.auth.token.email_verified == true`.
2. **Admin Role Isolation**: Only the bootstrapped admin (`fahmiarachman56@gmail.com` with verified email) or UIDs explicitly registered in `/admins/{uid}` may manage master catalog records (`locations`, `products`, `parts`), session lifecycle (`sessions` create/close/reopen/delete), entry reopening/deletion, or PIN updates (`app_config`). Self-elevation to `/admins/{uid}` by non-admins is strictly forbidden.
3. **Referential Parent Integrity**:
   - A `ProductPart` (`/parts/{partId}`) cannot be created unless its parent `Product` (`/products/{product_doc_id}`) exists.
   - An `OpnameEntry` (`/entries/{entryId}`) cannot be created unless its parent `OpnameSession` (`/sessions/{session_doc_id}`) exists and has `status == 'active'`, and its referenced `Product` (`/product_doc_id`) exists.
4. **Terminal State Locking**:
   - Once an `OpnameEntry` has `is_submitted == true`, non-admin operators cannot modify or delete it. Only an admin can reopen it (`is_submitted: false`) while the parent session is `active`.
   - Once an `OpnameSession` has `status == 'closed'`, non-admin operators cannot modify or submit entries or update `prepared_by` on that session.
5. **Temporal Integrity & Immutability**:
   - All `created_at` fields must equal `request.time` on `create` and remain immutable on `update`.
   - All `updated_at` fields must equal `request.time` on `create` and `update`.
   - Relational foreign IDs (`id`, `session_id`, `session_doc_id`, `product_id`, `product_doc_id`, `workspace`) are immutable on `update`.
6. **Strict Schema & Bounds**:
   - Every document enforces exact `keys().hasAll(...)` and `keys().hasOnly(...)` allowlists, path ID regex `^[a-zA-Z0-9_-]+$` (`<= 128` chars), and `.size()` limits on all strings.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Read/Write**: Unauthenticated client attempts `get`/`create` on `/entries/101` -> `PERMISSION_DENIED`.
2. **Unverified Email Spoofing**: Authenticated user with `email: "fahmiarachman56@gmail.com"` and `email_verified: false` attempts admin write on `/products/1` -> `PERMISSION_DENIED`.
3. **Privilege Escalation (Self-Admin)**: Non-admin verified operator attempts `setDoc` on `/admins/{ownUid}` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection**: Verified user sends `{ ..., isAdmin: true }` or `{ ..., ghostField: "x" }` on `/entries/101` -> `PERMISSION_DENIED`.
5. **Path ID Poisoning**: Client attempts `create` at `/entries/../../evil` or 200-char document ID -> `PERMISSION_DENIED`.
6. **Oversized String Exhaustion (Denial of Wallet)**: Client sends `notes` with 5,000 characters (`> 500`) -> `PERMISSION_DENIED`.
7. **Orphaned Part Creation**: Admin attempts to create `/parts/99` pointing to nonexistent `product_doc_id: "99999"` -> `PERMISSION_DENIED`.
8. **Orphaned Entry / Closed Session Injection**: Operator attempts to create a new draft entry on a `closed` session -> `PERMISSION_DENIED`.
9. **Locked Entry Tampering**: Operator attempts to edit `qty_ok` on an entry where `existing().is_submitted == true` -> `PERMISSION_DENIED`.
10. **Submitted By UID Spoofing**: Operator attempts to submit an entry while setting `submitted_by_uid` to another user's UID -> `PERMISSION_DENIED`.
11. **Timestamp Forgery**: Client attempts to pass a backdated client `Date` for `created_at` or `updated_at` instead of `request.time` -> `PERMISSION_DENIED`.
12. **Blanket List Scraping**: Client attempts `list` on `/entries` without `workspace == 'sinyotama'` filter or as an unauthenticated user -> `PERMISSION_DENIED`.
