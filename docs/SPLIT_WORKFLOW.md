# One image per article

An administrator can turn an unpublished submission containing 2–20 ordered originals into separate single-image articles. Existing published articles are never split or changed.

## Admin workspace

1. Open `/admin` and select the multi-image submission.
2. Choose **Split into one-image articles**, review the explanation, and confirm.
3. Each child enters the usual processing queue. Claim, translate, review, complete, and publish each child separately.
4. Inspect the individual image before choosing its English title. The copied Chinese title with `[position/count]` is only source context; it is not a proposed English title.

The original submission stays in private history as **Split into individual articles**. Its original images, combined Chinese text, and any existing English drafts remain available there. Existing drafts and combined body text are not copied to the children: that would risk attaching a multi-image translation to the wrong individual image. Each child's private provenance points back to the original submission and image position. Contributor, attribution, and source URL are retained.

## API

`POST /api/admin/submissions/ARTICLE_ID/split` requires an authenticated administrator session, the configured `Origin`, and its `X-CSRF-Token`. Bearer worker credentials and contributor sessions cannot split submissions. No request body is required.

For an actively processing parent, include the matching `X-Job-Lease`. A missing or stale lease returns 409; an expired parent lease does not need to be reused. A successful split invalidates the parent lease. In-flight parent uploads recheck the lease and split marker before committing their asset metadata.

The response is `{ok: true, parent_id, children, already_split}`. Children are returned in original image order with private article metadata. Repeating the request returns the same child IDs and their current states, even if those children have already been completed or published. It never creates another set, resets child processing, or changes publication timestamps.

Children use the existing claim, heartbeat, upload, complete, and publish endpoints. A successful completion can be retried with exactly the same lease, English title, and body; it returns `already_completed: true`. Changed content or a different lease is rejected. Publication still requires every expected English output and a nonempty English title. Administrator publication never sets contributor approval.

## Storage and concurrency

- An immediate SQLite transaction creates the split marker, all child articles, original-asset aliases, and provenance records together. Unique parent/image links and deterministic UUIDv8 IDs prevent duplicate children.
- Children reference the existing private R2 object keys. Splitting performs no R2 reads, writes, copies, or deletions. Quota accounting groups by object key so aliases do not consume storage twice.
- Parent source records and drafts are preserved. A separate split marker freezes parent processing, retry, completion, and publication. Its lease fields are cleared; the original status and timestamps remain as history.
- Public article responses omit provenance, original-image metadata, and the private parent context. Originals remain private after child publication.
- The database migration adds tables and an index only. It does not rewrite or remove existing articles or R2 objects.

## Production deployment and rollback

Use the existing host deployment procedure in [OPERATIONS.md](OPERATIONS.md). Preserve `.env.production`, tunnel configuration, the SQLite volume, and the private R2 bridge. No new credential, public bucket, or paid service is needed.

Before deployment, back up the current database metadata and retain the current source/image. Test the production image and use the same Node 22 / ARM64 checks as CI. Do not overlap old and new application instances against the same database: stop the old web instance before serving the new version and enabling splits. After deployment, verify the admin split controls and authentication guards before processing real content. Do not create test articles in the public gallery.

Once a real split has been performed, do not run the older application against the updated database: older code does not know that the parent is frozen and may offer it for processing again. Prefer a forward fix. Any coordinated source/database rollback must be explicitly planned to preserve newer children and publications; never restore an old database over newer live work or delete the data volume.

The repository's current CI builds/tests and saves Docker artifacts. It does not deploy the live host automatically.
