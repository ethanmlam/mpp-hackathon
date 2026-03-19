import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { Mppx, tempo } from 'mppx/server'
import { getClips, getClipById, searchClips, type Clip } from './clips.js'

const PORT = 3000

// Your wallet address - receives payments
const RECIPIENT = process.env.RECIPIENT_ADDRESS || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

// pathUSD on Tempo testnet
const PATHUSD = '0x20c0000000000000000000000000000000000000'

const mppx = Mppx.create({
  methods: [tempo({
    currency: PATHUSD,
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
      currency: 'pathUSD',
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
  const result = await mppx.session({ amount: '0.01' })(c.req.raw)

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
  const result = await mppx.session({ amount: '0.01' })(c.req.raw)

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
  const result = await mppx.session({ amount: '0.02' })(c.req.raw)

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

console.log(`Clip Service running on http://localhost:${PORT}`)
console.log(`Recipient wallet: ${RECIPIENT}`)
console.log(`\nTest with: tempo request http://localhost:${PORT}/api/clips/trending`)

serve({ fetch: app.fetch, port: PORT })
