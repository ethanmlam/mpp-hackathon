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
# create .env with MPP_SECRET_KEY=...
npm run dev
```

<img width="1512" height="855" alt="Screenshot 2026-03-19 at 7 35 21 PM" src="https://github.com/user-attachments/assets/2b2b0ee4-bb3c-4dc0-ac8c-3af8917694b3" />


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
# Free endpoints
curl -i http://localhost:3000/
curl -i http://localhost:3000/api/channels

# Paid endpoints return 402 (payment challenge) without a wallet
curl -i http://localhost:3000/api/clips/trending

# With Tempo CLI (requires a configured wallet)
tempo wallet login
# Tip: if you restarted the dev server and get a session reuse error, use 127.0.0.1
# (different origin = fresh payment session), or close the old session:
# tempo wallet sessions close http://localhost:3000
tempo request http://127.0.0.1:3000/api/clips/trending

# With mppx CLI
npx mppx account create
npx mppx http://localhost:3000/api/clips/trending
```

## Built at MPP Hackathon, March 19 2026
