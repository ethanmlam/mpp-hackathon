// @ts-ignore — bypass package exports to access SessionManager directly
import { sessionManager } from '../node_modules/mppx/dist/tempo/client/SessionManager.js'
import { privateKeyToAccount } from 'viem/accounts'

export type PaymentEvent = {
  type: 'channel_open' | 'channel_update' | 'receipt' | 'close'
  channelId: string | null
  cumulative: string
  txHash?: string
}

export type ClipDropCallbacks = {
  onStatus: (step: string, message: string) => void
  onClip: (clip: any) => void
  onDone: (data: any) => void
  onError: (error: string) => void
  onPayment: (info: PaymentEvent) => void
}

export async function findClips(
  privateKey: string,
  url: string,
  phrase: string,
  callbacks: ClipDropCallbacks,
) {
  const account = privateKeyToAccount(privateKey as `0x${string}`)

  // SessionManager handles the full payment lifecycle:
  // 402 challenge → open channel → stream with per-clip vouchers → receipt
  const sm = sessionManager({
    account,
    maxDeposit: '1.00',
  })

  const streamUrl = `/api/find/stream?url=${encodeURIComponent(url)}&phrase=${encodeURIComponent(phrase)}`

  try {
    // sm.sse() handles:
    // - Initial 402 → auto open channel on-chain → retry with voucher → 200
    // - Mid-stream payment-need-voucher → auto-send new voucher
    // - payment-receipt → calls onReceipt callback
    // - Yields only application data (message events)
    const events = await sm.sse(streamUrl, {
      onReceipt(receipt) {
        callbacks.onPayment({
          type: 'receipt',
          channelId: receipt.channelId || null,
          cumulative: receipt.spent || '0',
          txHash: receipt.txHash,
        })
      },
    })

    if (sm.channelId) {
      callbacks.onPayment({
        type: 'channel_open',
        channelId: sm.channelId,
        cumulative: '0',
      })
    }

    for await (const data of events) {
      try {
        const parsed = JSON.parse(data)

        switch (parsed.type) {
          case 'status':
            callbacks.onStatus(parsed.step, parsed.message)
            break
          case 'clip':
            callbacks.onClip(parsed)
            break
          case 'done':
            callbacks.onDone(parsed)
            break
          case 'error':
            callbacks.onError(parsed.error)
            break
        }
      } catch {
        // Skip unparseable events
      }
    }
  } catch (err) {
    callbacks.onError(err instanceof Error ? err.message : String(err))
  }
}

// Expose to window for use in app.html
;(window as any).ClipDrop = { findClips }
