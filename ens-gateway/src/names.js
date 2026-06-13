// Tier-1 label -> address map. Isolated behind one function so the tier-2 live
// `POST /register` endpoint (see README) is a drop-in swap, not a rewrite.

export const NAME_MAP = {
  alice: '0x5b9dC9e5F402b2c79A9570457Bbea2d3D8832A21',
}

/** Resolve a subname label to an address, or null if unknown. */
export function getAddressForLabel(label) {
  if (!label) return null
  return NAME_MAP[label.toLowerCase()] ?? null
}
