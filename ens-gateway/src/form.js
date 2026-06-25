// Self-served claim form served at GET / — the whole tier-2 demo loop lives at
// the gateway URL (open it, claim a name, resolve it), no frontend deploy needed.
// Posts to /claim (display/handle split, auto-suffix) and reveals the real,
// shareable handle on success (spec §6b).

export const CLAIM_FORM_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Claim your seikine name</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 34rem; margin: 3rem auto; padding: 0 1rem; color: #18181b; }
  h1 { font-size: 1.4rem; } code { background: #f4f4f5; padding: .1rem .35rem; border-radius: .25rem; }
  input { display: block; width: 100%; padding: .55rem; margin: .45rem 0; font-size: 1rem; box-sizing: border-box; }
  button { padding: .6rem 1.1rem; font-size: 1rem; cursor: pointer; border: 0; border-radius: .4rem; background: #4f46e5; color: #fff; }
  pre { background: #f4f4f5; padding: 1rem; border-radius: .5rem; white-space: pre-wrap; word-break: break-all; min-height: 1.2rem; }
</style></head><body>
  <h1>Claim your <code>seikine</code> name</h1>
  <p>Pick a name and map it to your address — then <code>&lt;handle&gt;.seikine.eth</code> resolves to you, and <code>borrow.&lt;handle&gt;.seikine.eth</code> shows your live Seikine position through ENS. Nothing is minted on-chain.</p>
  <form id="f">
    <input id="label" placeholder="your name, e.g. Elian" autocomplete="off" />
    <input id="address" placeholder="0x… your address" autocomplete="off" />
    <button type="submit">Claim</button>
  </form>
  <pre id="out"></pre>
  <script>
    const $ = (id) => document.getElementById(id);
    $('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('out').textContent = 'claiming…';
      try {
        const res = await fetch('/claim', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label: $('label').value.trim(), address: $('address').value.trim() }),
        });
        const j = await res.json();
        if (!res.ok || !j.ok) { $('out').textContent = '❌ ' + (j.reason || 'failed'); return; }
        let msg = '✅ Claimed!\\n\\n'
          + 'Name (display): ' + j.displayName + '\\n'
          + 'Handle (shareable): ' + j.name;
        if (!j.clean) {
          msg += '\\n\\n"' + j.base + '" was taken, so your shareable handle is ' + j.name + '.';
        }
        $('out').textContent = msg;
      } catch (err) { $('out').textContent = '❌ ' + err.message; }
    });
  </script>
</body></html>`
