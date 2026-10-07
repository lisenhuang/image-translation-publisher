# Deployment validation

Verified on 7 October 2026 for https://hooboo.aify.nz.

- Production build passed on the Mac and Oracle US ARM64 Docker image.
- The API integration suite passed 63 HTTP response checks plus password-hash, secure-cookie, privacy, image-order, retry, publication and persistence assertions. It passed both locally and inside the deployed image.
- A separate Docker container passed account setup, login and a two-image upload into the real private R2 bucket. After restarting it, its account, authenticated session, submission ID, image order, exact image bytes and unauthorised-image rejection were unchanged. Its data volume contained no image directory. R2 English-output upload, completion, contributor approval and public image cache headers also passed in the isolated container. This environment was isolated from the public gallery.
- The browser test passed login, multiple-image selection, previews, moving the second image first, upload, worker retrieval and completion, bilingual review, approval and article navigation. The uploaded order survived an application restart.
- The worker CLI returned the same active job when repeated with its saved claim key, then saved outputs for contributor review. At initial deployment, the live worker CLI correctly reported no pending submissions.
- Published-image responses from the real Next.js server carry public cache directives with a seven-day shared-cache TTL. Original and unfinished image URLs remain private.
- The public icon returned Cloudflare MISS followed by HIT. Public login and session responses returned DYNAMIC with private/no-store directives. The public setup endpoint rejected a request with 403; the protected local setup path reached input validation with a one-time secret, without submitting any account credentials.
- Live HTTPS, security headers, honest empty gallery and health endpoint passed. The public site fit a 390-pixel viewport without horizontal overflow; mobile navigation opened correctly.
- A backup of the live SQLite metadata completed successfully, with the web container restarting afterwards. Other pre-existing applications and the AI news tunnel were preserved.

The contributor account has been created. One real submission was pending when administrator access was added. No real article has been translated or published in this session. The synthetic browser and container fixtures do not demonstrate translation quality and were never published on the live site.

Unattended AI processing, off-server backups and scheduled backups are not configured. The source includes a manual processing CLI to run on the Mac and a tested backup script. Actual English image quality must be reviewed after source material is uploaded.

The R2 bridge passed its strict TypeScript check and deployment dry run. The live bridge passed authenticated image PUT/GET, exact-byte comparison, unauthorised rejection and deletion checks. The bucket has public r2.dev access disabled. Test objects were cleaned up after validation. Originals and English image bytes use R2; the production application never writes image files to Oracle disk.

## Administrator access update

- Added a backward-compatible user-role migration: existing users become contributors; a separate `dot-admin` account has the admin role and a salted scrypt hash. Contributor credentials and submissions were preserved.
- Both local suites passed: 63 existing API response checks and 48 admin API response checks, plus role migration, revocation, private-download bytes, CSRF, lease, incomplete-output rejection, direct publication, idempotency and original-privacy assertions. Admin publication does not impersonate contributor approval.
- The isolated browser workflow passed admin login and redirect, claiming, private image preview, English file selection and preview, saving a complete English version and direct publication. The revised admin interface fit a 390-pixel viewport without horizontal overflow.
- Oracle ARM64 Docker production build passed. A metadata backup and rollback source/image snapshot were preserved before deployment.
- Live HTTPS verification passed admin login, private original download through R2 with exact declared byte length, contributor admin-access rejection, anonymous rejection, CSRF enforcement and test-session logout. The admin HTML and private APIs returned no-store.
- Live browser login redirected `dot-admin` to `/admin` and displayed the real pending submission without browser errors. The real submission was not claimed, translated or published by these checks.
- No image files were written to Oracle. R2 configuration and the existing tunnel were unchanged. Dot's hourly schedule and image-editing capability still need to be configured in Dot's cloud environment.

## Bilingual interface update

- Version 1.2.0 adds English and Simplified Chinese across the gallery, login, setup, contributor dashboard, administrator workspace, article navigation, page titles, accessibility labels and built-in errors. Chinese system variants default to Simplified Chinese; every other primary system language defaults to English. Manual choices are retained in a separate browser preference cookie.
- All four integration tests passed locally and in the Oracle ARM64 production image: 113 API response checks plus language defaults, cookie/header precedence, translations, role revocation, privacy, CSRF, leases and publication assertions.
- Six real HTTP checks passed for zh-TW, zh-Hant-HK, en-NZ, ja-JP and both manual preference overrides. They passed again over live HTTPS with no-store HTML responses.
- Browser checks passed switching both directions, retaining input during a switch, preserving the chosen language across navigation and reload, localised page titles, bilingual login errors, English and Chinese admin details, and a 390-pixel mobile viewport with no horizontal overflow. Live admin login and both language switches passed without browser errors.
- Live private R2 downloads remain authenticated; originals remain unavailable anonymously. Published-image CDN behaviour is unchanged. Administrator credentials were preserved during deployment.
- While final verification was running, the real submission progressed from ready to published outside these tests. This session did not translate, claim or publish that real article. Its public article and English image were verified, and its original remained private. Image-editing quality and Dot's hourly scheduler are outside these interface/access checks.
