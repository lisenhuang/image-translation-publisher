# 🖼️ Image Translation Publisher

Turn Chinese article titles and images into English editions, preserving the artwork and layout, then share them in a public gallery.

**[🌍 Live website](https://hooboo.aify.nz)** · **[🔑 Sign in](https://hooboo.aify.nz/login)** · **[📚 Operations guide](docs/OPERATIONS.md)**

## 🔄 How it works

```text
[Upload Chinese originals]
            |
            v
[Translate with an AI tool / editor]
            |
            v
[Upload + check the English edition]
            |
            v
[Publish] --> [Public gallery] --> [Cloudflare CDN]

Originals + drafts --> private R2
Accounts + jobs   --> SQLite
```

> 🧠 Image translation uses an external AI or editing tool. The app handles uploads, processing jobs, review and publication. The processing agent configures its own schedule.

## 👥 Who can do what?

| Role | Access |
| --- | --- |
| ✍️ Contributor | Upload Chinese originals, track progress and approve ready editions |
| 🛠️ Administrator | Download originals, upload English outputs and publish directly |
| 📖 Visitor | Read published English articles and images |

Cloud agents can process and publish through the admin workspace or HTTPS API, without SSH or R2 credentials.

## 🧩 What's inside?

| Component | Purpose |
| --- | --- |
| Next.js + React | Gallery, login and contributor/admin workspaces |
| SQLite | Accounts, sessions, article metadata and processing jobs |
| Private Cloudflare R2 | Original images and English outputs |
| Cloudflare Tunnel + CDN | HTTPS routing and caching for public assets |
| Docker | Application deployment and persistent database storage |

🌐 **Interface:** English and Simplified Chinese. Chinese system languages, including Traditional Chinese, default to Simplified Chinese; all others default to English. Manual choices are remembered.

## 🚀 Run locally

Requires Node.js 22 and a configured private R2 bridge.

```sh
npm ci
cp .env.example .env.local
# Configure .env.local before starting
npm run dev
```

For local development, set `APP_ORIGIN=http://127.0.0.1:3318` and `DATA_DIR=./data`, then fill in the R2 settings and private tokens listed in [`.env.example`](.env.example).

Open **http://127.0.0.1:3318**. Follow the [operations guide](docs/OPERATIONS.md) for protected account setup, administrator access and Docker deployment.

| Command | Purpose |
| --- | --- |
| `npm test` | Test authentication, privacy, uploads, processing and publication |
| `npm run build` | Build the production application |
| `npm run dev` | Start local development on port 3318 |

## 📦 Upload limits

| Setting | Limit |
| --- | --- |
| Formats | Static JPG, PNG and WebP |
| Images per article | 20 |
| Size per image | 12 MB |
| Total per submission | 72 MB |
| Gallery storage | 1 GB by default; configurable |

🔒 Originals and unfinished editions stay private. Images are stored in R2; the application server stores database metadata. Passwords use salted scrypt hashes, and authenticated changes require CSRF verification.

## 📚 More detail

| Guide | Covers |
| --- | --- |
| [Operations](docs/OPERATIONS.md) | Deployment, account setup, worker/API workflow, R2 and backups |
| [Validation](VALIDATION.md) | Completed checks and practical limits |

Keep credentials, database files and uploaded images out of Git. Database backups do not include R2 image bytes.
