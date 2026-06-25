// Tiny Express wrapper around the handler. Our resolver sets a plain URL, so
// EIP-3668 clients POST { sender, data }; we also accept GET /:sender/:data for
// client compatibility. Both call the same handler.

import express from 'express'
import { handleRequest } from './handler.js'
import { registerName, getAddressForLabel } from './names.js'
import {
  preview as previewClaim,
  claim as claimName,
  getClaimByAddress,
  getClaimByHandle,
  publicClaim,
  normalizeLabel,
} from './claims.js'
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
  // Claims consult legacy/seed labels as "taken" so a clean handle can never
  // shadow an existing name (spec §1). Default to the same store the resolver
  // falls back to; tests can inject `preview`/`claim`/`getAddressForLabel`.
  const legacyLookup = deps.getAddressForLabel ?? getAddressForLabel
  const preview = deps.preview ?? ((label, address) => previewClaim(label, address, { legacyLookup }))
  const claim = deps.claim ?? ((label, address) => claimName(label, address, { legacyLookup }))
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

  // ── Tier-2: self-served claim form + in-app name claim (additive) ──────────
  app.get('/', cors, (_req, res) => res.type('html').send(CLAIM_FORM_HTML))

  // In-app claim (spec §4): display/handle split, auto-suffix, idempotent on
  // address. Preview never returns "taken" — duplication yields a suffixed
  // handle, not an error. The only thing the frontend nudges on is `valid:false`.
  app.get('/preview', cors, (req, res) => {
    const { label, address } = req.query
    res.json(preview(label, address))
  })
  app.options('/claim', cors, (_req, res) => res.sendStatus(204))
  app.post('/claim', cors, (req, res) => {
    const { label, address } = req.body || {}
    const r = claim(label, address)
    res.status(r.ok ? 200 : 400).json(r) // 400 only when the label can't become a handle
  })

  // In-app identity reads (Phase 2 §0a): pure reads of indexes that already
  // exist. ENS has no address->handle reverse, so the wallet button asks the
  // gateway "does this address already have a claim?". GET disambiguates from
  // the POST above by method.
  app.get('/claim', cors, (req, res) => {
    const { address, handle } = req.query
    if (address) {
      const c = publicClaim(getClaimByAddress(address))
      return res.json(c ? { claimed: true, ...c } : { claimed: false })
    }
    if (handle !== undefined) {
      let rec = null
      try {
        rec = getClaimByHandle(normalizeLabel(handle)) // normalize so callers can pass any case
      } catch {
        rec = null
      }
      const c = publicClaim(rec)
      return res.json(c ? { found: true, ...c } : { found: false })
    }
    res.status(400).json({ message: 'provide ?address= or ?handle=' })
  })

  // Legacy registration (pre-claim flat label->address map). Kept working.
  app.options('/register', cors, (_req, res) => res.sendStatus(204))
  app.post('/register', cors, (req, res) => {
    const { name, address } = req.body || {}
    const r = register(name, address)
    res.status(r.ok ? 200 : 400).json(r)
  })

  return app
}
