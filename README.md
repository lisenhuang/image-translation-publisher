# 🖼️ Image Translation Publisher

[![CI/CD](https://github.com/lisenhuang/image-translation-publisher/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/lisenhuang/image-translation-publisher/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/lisenhuang/image-translation-publisher?label=version)](package.json)
[![GitHub stars](https://img.shields.io/github/stars/lisenhuang/image-translation-publisher?style=flat&logo=github)](https://github.com/lisenhuang/image-translation-publisher/stargazers)

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-22-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Cloudflare R2](https://img.shields.io/badge/Cloudflare-R2-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/r2/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](Dockerfile)

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

## ✅ CI/CD

Every push to `main` and pull request runs:

| Check | Covers |
| --- | --- |
| 🧪 Tests | Authentication, admin roles, upload/publish flow, privacy and languages |
| 🏗️ Builds | Next.js production build, Worker type checking and deployment dry run |
| 🐳 Containers | Build and HTTP smoke tests on Linux AMD64 and ARM64 |
| 📦 Delivery | Tested Docker images and checksums saved for 7 days after successful `main` pushes |

Download images from the [Actions run](https://github.com/lisenhuang/image-translation-publisher/actions/workflows/ci.yml). Use ARM64 for Oracle US. Live deployment follows the [operations guide](docs/OPERATIONS.md). CI uses isolated data and needs no production credentials.

## 📦 Upload limits

| Setting | Limit |
| --- | --- |
| Formats | Static JPG, PNG and WebP |
| Images per article | 20 |
| Size per image | 12 MB |
| Total per submission | 72 MB |
| Total tracked images | App cap: 10 GiB via `MAX_STORAGE_BYTES`; includes originals and English outputs |

🔒 Originals and unfinished editions stay private. Images are stored in R2; the application server stores database metadata. Passwords use salted scrypt hashes, and authenticated changes require CSRF verification.

## 📚 More detail

| Guide | Covers |
| --- | --- |
| [Operations](docs/OPERATIONS.md) | Deployment, account setup, worker/API workflow, R2 and backups |
| [Validation](VALIDATION.md) | Completed checks and practical limits |

Keep credentials, database files and uploaded images out of Git. Database backups do not include R2 image bytes.
