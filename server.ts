import 'dotenv/config'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Mppx, tempo } from 'mppx/server'
import { isAddress } from 'viem'
import { getClips, getClipById, searchClips, type Clip } from './clips.js'

const PORT = Number(process.env.PORT || 3000)

if (!process.env.MPP_SECRET_KEY) {
  throw new Error(
    'Missing MPP_SECRET_KEY. Create a .env with MPP_SECRET_KEY=... (or export it) before starting the server.'
  )
}

// Your wallet address - receives payments
const RECIPIENT_RAW =
  process.env.RECIPIENT_ADDRESS || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
if (!isAddress(RECIPIENT_RAW)) {
  throw new Error(`Invalid RECIPIENT_ADDRESS: ${RECIPIENT_RAW}`)
}
const RECIPIENT = RECIPIENT_RAW as `0x${string}`

// Toggle: NETWORK=testnet or NETWORK=mainnet (default: mainnet)
const NETWORK = process.env.NETWORK || 'mainnet'

const TOKENS = {
  mainnet: '0x20C000000000000000000000b9537d11c60E8b50' as const,  // USDC on Tempo mainnet
  testnet: '0x20c0000000000000000000000000000000000000' as const,  // pathUSD on Tempo testnet
}

const CURRENCY = TOKENS[NETWORK as keyof typeof TOKENS] || TOKENS.mainnet

console.log(`Network: ${NETWORK} | Currency: ${CURRENCY}`)

const mppx = Mppx.create({
  methods: [tempo({
    currency: CURRENCY,
    recipient: RECIPIENT,
  })],
})

const app = new Hono()

// Health check (free)
app.get('/', (c) => {
  return c.json({
    name: 'Clip Service',
    description: 'Pay-per-clip Twitch highlights via MPP sessions',
    endpoints: {
      '/api/clips/trending': 'Get trending clips ($0.01/request)',
      '/api/clips/search?q=valorant': 'Search clips ($0.01/request)',
      '/api/clips/:id': 'Get a specific clip ($0.02/clip)',
      '/api/channels': 'List available channels (free)',
    },
    payment: {
      method: 'tempo',
      currency: 'USDC',
      session: true,
    }
  })
})

// List channels (free - discovery)
app.get('/api/channels', (c) => {
  return c.json({
    channels: [
      { name: 'xqc', game: 'Just Chatting', clips_available: 50 },
      { name: 'shroud', game: 'Valorant', clips_available: 35 },
      { name: 'pokimane', game: 'Just Chatting', clips_available: 28 },
      { name: 'summit1g', game: 'CS2', clips_available: 42 },
      { name: 'timthetatman', game: 'Fortnite', clips_available: 31 },
    ]
  })
})

// Trending clips - session payment ($0.01 per request)
app.get('/api/clips/trending', async (c) => {
  const result = await mppx.session({
    amount: '0.01',
    unitType: 'request',
    suggestedDeposit: '1.00',
  })(c.req.raw)

  if (result.status === 402) return result.challenge

  const limit = parseInt(c.req.query('limit') || '10')
  const channel = c.req.query('channel')
  const clips = getClips({ sort: 'trending', limit, channel })

  return result.withReceipt(
    Response.json({
      clips,
      count: clips.length,
      cost: '$0.01',
    })
  )
})

// Search clips - session payment ($0.01 per request)
app.get('/api/clips/search', async (c) => {
  const result = await mppx.session({
    amount: '0.01',
    unitType: 'request',
    suggestedDeposit: '1.00',
  })(c.req.raw)

  if (result.status === 402) return result.challenge

  const q = c.req.query('q') || ''
  const limit = parseInt(c.req.query('limit') || '10')
  const clips = searchClips(q, limit)

  return result.withReceipt(
    Response.json({
      query: q,
      clips,
      count: clips.length,
      cost: '$0.01',
    })
  )
})

// Get specific clip - session payment ($0.02 per clip, includes embed URL)
app.get('/api/clips/:id', async (c) => {
  const result = await mppx.session({
    amount: '0.02',
    unitType: 'clip',
    suggestedDeposit: '1.00',
  })(c.req.raw)

  if (result.status === 402) return result.challenge

  const id = c.req.param('id')
  const clip = getClipById(id)

  if (!clip) {
    return result.withReceipt(
      new Response(JSON.stringify({ error: 'Clip not found' }), { status: 404 })
    )
  }

  return result.withReceipt(
    Response.json({
      clip: {
        ...clip,
        embed_url: clip.embed_url,
        download_url: clip.download_url,
      },
      cost: '$0.02',
    })
  )
})

// Serve static files from public/
app.use('/public/*', serveStatic({ root: './' }))

// Redirect /app to the frontend
app.get('/app', (c) => c.redirect('/public/app.html'))

console.log(`Clip Service running on http://localhost:${PORT}`)
console.log(`Recipient wallet: ${RECIPIENT}`)
console.log(`\nTest with: tempo request http://localhost:${PORT}/api/clips/trending`)
console.log(`Frontend: http://localhost:${PORT}/app`)

serve({ fetch: app.fetch, port: PORT })
