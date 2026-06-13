// Tiny Express wrapper around the handler. Our resolver sets a plain URL, so
// EIP-3668 clients POST { sender, data }; we also accept GET /:sender/:data for
// client compatibility. Both call the same handler.

import express from 'express'
import { handleRequest } from './handler.js'

export function createApp(deps) {
  const app = express()
  app.use(express.json({ limit: '1mb' }))

  const handle = async (req, res) => {
    const data =
      req.body?.data ?? (req.params?.data ? req.params.data.replace(/\.json$/, '') : undefined)
    if (!data) return res.status(400).json({ message: 'missing "data" (the encoded resolve call)' })
    try {
      const responseData = await handleRequest({ data }, deps)
      res.json({ data: responseData })
    } catch (e) {
      // A malformed request is the caller's fault; surface it without leaking internals.
      res.status(500).json({ message: e?.shortMessage ?? e?.message ?? 'gateway error' })
    }
  }

  app.post('/', handle)
  app.get('/:sender/:data', handle)
  app.get('/health', (_req, res) => res.json({ ok: true }))
  return app
}
