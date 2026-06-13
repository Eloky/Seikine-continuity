// Tiny Express wrapper around the handler. Our resolver sets a plain URL, so
// EIP-3668 clients POST { sender, data }; we also accept GET /:sender/:data for
// client compatibility. Both call the same handler.

import express from 'express'
import { handleRequest } from './handler.js'
import { registerName } from './names.js'
import { CLAIM_FORM_HTML } from './form.js'

// Permissive CORS. Applied to the tier-2 form/register routes AND the CCIP
// `POST /` — the latter is read-only and returns signed, already-public on-chain
// position data (no secret, no state change, no auth), so any web origin calling
// it is the intended use: a browser resolving an ENS name via CCIP-Read (viem
// does a cross-origin fetch when it follows OffchainLookup). `*` is fine for the
// demo; scope to the frontend origin later. HTTP-layer only — the resolve/sign/
// digest core is untouched.
const cors = (_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  next()
}

export function createApp(deps) {
  const register = deps.register ?? registerName
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

  // CCIP-Read endpoint + browser preflight. CORS so a browser can resolve through
  // it; `handle`'s resolve/sign logic is unchanged — these are response headers only.
  app.options('/', cors, (_req, res) => res.sendStatus(204))
  app.post('/', cors, handle)
  app.get('/:sender/:data', handle)
  app.get('/health', (_req, res) => res.json({ ok: true }))

  // ── Tier-2: live registration + self-served claim form (additive) ──────────
  app.get('/', cors, (_req, res) => res.type('html').send(CLAIM_FORM_HTML))
  app.options('/register', cors, (_req, res) => res.sendStatus(204))
  app.post('/register', cors, (req, res) => {
    const { name, address } = req.body || {}
    const r = register(name, address)
    res.status(r.ok ? 200 : 400).json(r)
  })

  return app
}
