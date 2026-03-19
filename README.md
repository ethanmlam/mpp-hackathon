# Clip Service

Pay-per-clip Twitch highlights via MPP sessions on Tempo.

## What

An API that serves Twitch clip highlights behind MPP session payments. Agents or apps open a session, browse/search clips, and pay per clip accessed. Revenue can be split back to creators.

## Why

- Clippers on Twitch work for free. This gives them a revenue model.
- No API exists for "give me the best clips, pay per use."
- Sessions enable metered billing: browse 100 clips on a $1 deposit.

## Setup

```bash
npm install
npm run dev
```

## Endpoints

| Endpoint | Cost | Description |
|----------|------|-------------|
| `GET /` | Free | Service info |
| `GET /api/channels` | Free | List available channels |
| `GET /api/clips/trending` | $0.01 | Trending clips |
| `GET /api/clips/search?q=valorant` | $0.01 | Search clips |
| `GET /api/clips/:id` | $0.02 | Get specific clip with embed/download URLs |

## Test

```bash
# With Tempo CLI
tempo request http://localhost:3000/api/clips/trending

# With mppx CLI
npx mppx http://localhost:3000/api/clips/trending
```

## Built at MPP Hackathon, March 19 2026
