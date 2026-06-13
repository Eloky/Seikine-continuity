// Self-served claim form served at GET / — the whole tier-2 demo loop lives at
// the gateway URL (open it, claim a name, resolve it), no frontend deploy needed.

export const CLAIM_FORM_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Claim a *.seikine.eth name</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 34rem; margin: 3rem auto; padding: 0 1rem; color: #18181b; }
  h1 { font-size: 1.4rem; } code { background: #f4f4f5; padding: .1rem .35rem; border-radius: .25rem; }
  input { display: block; width: 100%; padding: .55rem; margin: .45rem 0; font-size: 1rem; box-sizing: border-box; }
  button { padding: .6rem 1.1rem; font-size: 1rem; cursor: pointer; border: 0; border-radius: .4rem; background: #4f46e5; color: #fff; }
  pre { background: #f4f4f5; padding: 1rem; border-radius: .5rem; white-space: pre-wrap; word-break: break-all; min-height: 1.2rem; }
</style></head><body>
  <h1>Claim a <code>*.seikine.eth</code> name</h1>
  <p>Map a label to your address — then <code>borrow.&lt;name&gt;.seikine.eth</code> resolves your live Seikine position through ENS. Nothing is minted on-chain.</p>
  <form id="f">
    <input id="name" placeholder="name (a-z, 0-9, -)" autocomplete="off" />
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
        const res = await fetch('/register', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: $('name').value.trim(), address: $('address').value.trim() }),
        });
        const j = await res.json();
        $('out').textContent = res.ok
          ? '✅ claimed!\\n\\nResolvable names:\\n' + j.names.map((n) => '  ' + n).join('\\n')
          : '❌ ' + (j.error || 'failed');
      } catch (err) { $('out').textContent = '❌ ' + err.message; }
    });
  </script>
</body></html>`
