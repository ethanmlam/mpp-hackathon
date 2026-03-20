import 'dotenv/config'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Mppx, Store, tempo } from 'mppx/server'
import { Session } from 'mppx/tempo'
import { isAddress, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { tempo as tempoChain } from 'viem/chains'
import { createReadStream, existsSync, statSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  extractVideoId,
  fetchTranscript,
  findClips,
  extractClip,
  CACHE_DIR,
} from './clip_finder.js'

const PORT = Number(process.env.PORT || 3000)

if (!process.env.MPP_SECRET_KEY) {
  throw new Error(
    'Missing MPP_SECRET_KEY. Create a .env with MPP_SECRET_KEY=... (or export it) before starting the server.'
  )
}

const RECIPIENT_RAW =
  process.env.RECIPIENT_ADDRESS || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
if (!isAddress(RECIPIENT_RAW)) {
  throw new Error(`Invalid RECIPIENT_ADDRESS: ${RECIPIENT_RAW}`)
}
const RECIPIENT = RECIPIENT_RAW as `0x${string}`

const NETWORK = process.env.NETWORK || 'mainnet'

const TOKENS = {
  mainnet: '0x20C000000000000000000000b9537d11c60E8b50' as const,
  testnet: '0x20c0000000000000000000000000000000000000' as const,
}

const CURRENCY = TOKENS[NETWORK as keyof typeof TOKENS] || TOKENS.mainnet

console.log(`Network: ${NETWORK} | Currency: ${CURRENCY}`)

// File-backed channel store: persists across server restarts so the server
// recognises sessions the client already opened.
const STORE_PATH = join(CACHE_DIR, '_channel_store.json')

function reviveBigInts(obj: unknown): unknown {
  if (typeof obj === 'string' && obj.startsWith('__bigint__')) return BigInt(obj.slice(10))
  if (Array.isArray(obj)) return obj.map(reviveBigInts)
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) result[k] = reviveBigInts(v)
    return result
  }
  return obj
}

function loadStoreData(): Record<string, unknown> {
  try {
    if (existsSync(STORE_PATH)) return reviveBigInts(JSON.parse(readFileSync(STORE_PATH, 'utf-8'))) as Record<string, unknown>
  } catch {}
  return {}
}

function saveStoreData(data: Record<string, unknown>) {
  writeFileSync(STORE_PATH, JSON.stringify(data, (_key, value) =>
    typeof value === 'bigint' ? `__bigint__${value.toString()}` : value
  , 2), 'utf-8')
}

const storeData = loadStoreData()
const channelIds = new Set<string>(Object.keys(storeData))

const store = Store.from({
  async get(key: string) { return storeData[key] },
  async put(key: string, value: unknown) {
    channelIds.add(key)
    storeData[key] = value
    saveStoreData(storeData)
  },
  async delete(key: string) {
    channelIds.delete(key)
    delete storeData[key]
    saveStoreData(storeData)
  },
})

const channelStore = Session.ChannelStore.fromStore(store)
const ESCROW_CONTRACT = '0x33b901018174DDabE4841042ab76ba85D4e24f25'

// Wallet client used to submit settlement transactions on-chain.
const walletClient = createWalletClient({
  account: privateKeyToAccount((process.env.TEMPO_PRIVATE_KEY || process.env.MPP_SECRET_KEY) as `0x${string}`),
  chain: tempoChain,
  transport: http('https://gracious-knuth:goofy-chandrasekhar@rpc.tempo.xyz'),
})

const mppx = Mppx.create({
  methods: [
    tempo({
      currency: CURRENCY,
      recipient: RECIPIENT,
      store,
    }),
  ],
})

async function settleChannel(channelId: string): Promise<string | null> {
  try {
    const channel = await channelStore.getChannel(channelId)
    if (!channel || !channel.highestVoucher) {
      console.log(`[settle] Channel ${channelId}: no voucher yet`)
      return null
    }
    if (channel.finalized) {
      channelIds.delete(channelId)
      return null
    }
    const txHash = await Session.Chain.closeOnChain(
      walletClient,
      channel.escrowContract || ESCROW_CONTRACT,
      channel.highestVoucher,
      walletClient.account,
      undefined,
    )
    await channelStore.updateChannel(channelId, (current: any) => {
      if (!current) return null
      return { ...current, finalized: true }
    })
    channelIds.delete(channelId)
    console.log(`[settle] Channel ${channelId} settled. txHash: ${txHash}`)
    broadcast('settlement', { channelId, txHash, amount: channel.highestVoucher.cumulativeAmount })
    return txHash as string
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`[settle] Channel ${channelId} deferred: ${msg}`)
    return null
  }
}

// SSE broadcast: set of active /api/events response writers
const sseClients = new Set<(data: string) => void>()

function broadcast(eventType: string, data: unknown) {
  const line = `data: ${JSON.stringify({ type: eventType, ...(data as object) })}\n\n`
  for (const write of sseClients) {
    try {
      write(line)
    } catch {
      sseClients.delete(write)
    }
  }
}

const app = new Hono()

// SSE broadcast endpoint — clients connect here to receive real-time events
app.get('/api/events', (c) => {
  let write: (data: string) => void
  const stream = new ReadableStream({
    start(controller) {
      write = (data: string) => controller.enqueue(new TextEncoder().encode(data))
      sseClients.add(write)
      // Send a keepalive comment immediately
      write(': connected\n\n')
    },
    cancel() {
      sseClients.delete(write)
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})

// Service info (free)
app.get('/', (c) => {
  return c.json({
    name: 'ClipDrop',
    description: 'Find every moment a phrase is spoken in a YouTube video',
    endpoints: {
      'GET /api/find?url=YOUTUBE_URL&phrase=PHRASE': 'Find clips ($0.02 per clip found)',
      'GET /api/find/stream?url=YOUTUBE_URL&phrase=PHRASE': 'SSE streaming clip finder ($0.02 per clip)',
      'GET /api/transcript?url=YOUTUBE_URL': 'Fetch transcript (free)',
      'GET /api/clip/extract?url=YOUTUBE_URL&start=N&end=N': 'Extract clip segment ($0.01 per extraction)',
      'GET /api/clips/:filename': 'Serve cached clip file (free)',
      'GET /api/channels': 'List available channels (free)',
    },
    payment: {
      method: 'tempo',
      currency: 'USDC',
      session: true,
    },
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
    ],
  })
})

// Transcript fetch (free)
app.get('/api/transcript', async (c) => {
  const url = c.req.query('url')
  if (!url) {
    return c.json({ error: 'Missing url parameter' }, 400)
  }

  try {
    const videoId = extractVideoId(url)
    const transcript = await fetchTranscript(videoId)
    return c.json(transcript)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.json({ error: msg }, 500)
  }
})

// Find clips - session payment ($0.02 per clip found)
app.get('/api/find', async (c) => {
  const result = await mppx.session({
    amount: '0.02',
    unitType: 'clip',
    suggestedDeposit: '1.00',
  })(c.req.raw)

  if (result.status === 402) return result.challenge

  const url = c.req.query('url')
  const phrase = c.req.query('phrase')

  if (!url || !phrase) {
    return result.withReceipt(
      new Response(JSON.stringify({ error: 'Missing url or phrase parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  }

  try {
    broadcast('status', { step: 'search', message: 'Searching...', url, phrase })
    const clips = await findClips(url, phrase)
    const costPerClip = 0.02
    const totalCost = clips.clips_found * costPerClip

    const response = result.withReceipt(
      Response.json({
        ...clips,
        billing: {
          cost_per_clip: `$${costPerClip}`,
          clips_found: clips.clips_found,
          total_cost: `$${totalCost.toFixed(2)}`,
        },
      })
    )

    // Broadcast clips with 1s buffer to frontend (fire-and-forget)
    ;(async () => {
      const clipList = clips.clips || []
      for (let i = 0; i < clipList.length; i++) {
        await new Promise(r => setTimeout(r, 1000))
        broadcast('clip', clipList[i])
      }
      await new Promise(r => setTimeout(r, 1000))
      broadcast('done', {
        clips_found: clips.clips_found,
        total_segments: clips.total_segments,
        total_cost: totalCost.toFixed(2),
      })
    })()

    return response
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    broadcast('error', { error: msg })
    return result.withReceipt(
      new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  }
})

// SSE streaming find clips - session payment ($0.02 per clip)
app.get('/api/find/stream', async (c) => {
  const result = await mppx.session({
    amount: '0.02',
    unitType: 'clip',
    suggestedDeposit: '1.00',
  })(c.req.raw)

  if (result.status === 402) return result.challenge

  const url = c.req.query('url')
  const phrase = c.req.query('phrase')

  if (!url || !phrase) {
    return new Response(
      JSON.stringify({ error: 'Missing url or phrase parameter' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { channelId, challengeId, tickCost } = Session.Sse.fromRequest(c.req.raw)

  const body = Session.Sse.serve({
    store: channelStore,
    channelId,
    challengeId,
    tickCost,
    async *generate(ctrl: Session.Sse.SessionController) {
      type QueueItem = { value: string; charge: boolean } | null
      let waiting: ((item: QueueItem) => void) | null = null
      const buffer: QueueItem[] = []

      function push(item: QueueItem) {
        if (waiting) {
          const resolve = waiting
          waiting = null
          resolve(item)
        } else {
          buffer.push(item)
        }
      }

      function sendSSE(eventType: string, data: unknown) {
        const json = JSON.stringify({ type: eventType, ...(data as object) })
        push({ value: json, charge: eventType === 'clip' })
        // Also broadcast to passive /api/events listeners (fire-and-forget)
        try { broadcast(eventType, data as object) } catch {}
      }

      // Broadcast search start so passive listeners know what's being searched
      try { broadcast('status', { step: 'search', message: 'Starting search...', url, phrase }) } catch {}

      console.error(`[stream] Finding '${phrase}' in ${url}`)
      const findPromise = findClips(url, phrase, sendSSE)
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          sendSSE('error', { error: msg })
        })
        .finally(() => push(null))

      try {
        while (true) {
          const item = buffer.length > 0
            ? buffer.shift()!
            : await new Promise<QueueItem>((r) => { waiting = r })
          if (item === null) break
          if (item.charge) await ctrl.charge()
          yield item.value
        }
      } finally {
        await findPromise
      }
    },
  })

  return Session.Sse.toResponse(body)
})

// Extract clip segment (free for demo)
app.get('/api/clip/extract', async (c) => {
  const url = c.req.query('url')
  const startStr = c.req.query('start')
  const endStr = c.req.query('end')

  if (!url || !startStr || !endStr) {
    return c.json({ error: 'Missing url, start, or end parameter' }, 400)
  }

  try {
    const videoId = extractVideoId(url)
    const start = parseInt(startStr, 10)
    const end = parseInt(endStr, 10)

    await extractClip(url, videoId, start, end)

    return c.json({
      clip_url: `/api/clips/${videoId}_${start}_${end}.mp4`,
      duration: end - start,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.json({ error: msg }, 500)
  }
})

// Serve cached clip files (free, with range support)
app.get('/api/clips/:filename', (c) => {
  const filename = c.req.param('filename')

  // Reject path traversal
  if (filename.includes('..') || filename.includes('/')) {
    return c.json({ error: 'Invalid filename' }, 400)
  }

  const filePath = join(CACHE_DIR, filename)

  if (!existsSync(filePath)) {
    return c.json({ error: 'Clip not found' }, 404)
  }

  const fileSize = statSync(filePath).size
  const rangeHeader = c.req.header('Range')

  if (rangeHeader) {
    const parts = rangeHeader.replace('bytes=', '').split('-')
    const rangeStart = parts[0] ? parseInt(parts[0], 10) : 0
    const rangeEnd = parts[1] ? Math.min(parseInt(parts[1], 10), fileSize - 1) : fileSize - 1
    const contentLength = rangeEnd - rangeStart + 1

    const nodeStream = createReadStream(filePath, { start: rangeStart, end: rangeEnd })
    const webStream = new ReadableStream({
      start(controller) {
        nodeStream.on('data', (chunk) => controller.enqueue(chunk))
        nodeStream.on('end', () => controller.close())
        nodeStream.on('error', (err) => controller.error(err))
      },
    })

    return new Response(webStream, {
      status: 206,
      headers: {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${rangeStart}-${rangeEnd}/${fileSize}`,
        'Content-Length': String(contentLength),
      },
    })
  }

  const nodeStream = createReadStream(filePath)
  const webStream = new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk) => controller.enqueue(chunk))
      nodeStream.on('end', () => controller.close())
      nodeStream.on('error', (err) => controller.error(err))
    },
  })

  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(fileSize),
    },
  })
})

// Serve static files from public/
app.use('/public/*', serveStatic({ root: './' }))

// Serve the wallet key for local dev auto-fill
app.get('/api/local-key', (c) => {
  const key = process.env.TEMPO_PRIVATE_KEY || ''
  const address = key ? privateKeyToAccount(key as `0x${string}`).address : ''
  return c.json({ key, address })
})

// Redirect /app to the frontend
app.get('/app', (c) => c.redirect('/public/app.html'))


console.log(`ClipDrop running on http://localhost:${PORT}`)
console.log(`Recipient wallet: ${RECIPIENT}`)
console.log(`\nTest with: tempo request http://localhost:${PORT}/api/find?url=YOUTUBE_URL&phrase=PHRASE`)
console.log(`Frontend: http://localhost:${PORT}/app`)

serve({ fetch: app.fetch, port: PORT })
