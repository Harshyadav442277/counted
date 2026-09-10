import { publicUrl } from "../config.js";

/** Shared HTML shell. One inline stylesheet, no build step, readable in both themes. */
export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const CSS = `
:root{--bg:#0b0f14;--panel:#121821;--line:#1f2a37;--fg:#e6edf3;--muted:#8b98a5;--accent:#fcff52;--accent-fg:#111;--ok:#3fb950;--warn:#f0883e;--bad:#f85149;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-color-scheme: light){:root{--bg:#fcfcf7;--panel:#ffffff;--line:#e4e4d8;--fg:#1a1f26;--muted:#5f6b78;--accent:#476520;--accent-fg:#fff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
main{max-width:940px;margin:0 auto;padding:28px 20px 64px}
header.top{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:22px}
header.top h1{font-size:26px;margin:0;letter-spacing:.3px}header.top nav a{margin-left:16px;color:var(--muted)}
.lede{font-size:22px;max-width:760px;margin:0 0 10px;line-height:1.35}.sub{color:var(--muted);max-width:760px;margin:0 0 18px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px}.stat b{display:block;font-size:26px;font-variant-numeric:tabular-nums}.stat span{color:var(--muted);font-size:13px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:16px 0}.panel h2{margin:0 0 10px;font-size:17px}
button,a.btn{display:inline-block;padding:11px 18px;border-radius:8px;border:0;background:var(--accent);color:var(--accent-fg);font-weight:700;cursor:pointer;font-size:15px}button[disabled]{opacity:.6;cursor:wait}a.btn:hover{text-decoration:none;filter:brightness(1.06)}
input,select{padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font-size:15px;min-width:200px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600}
code,pre,.mono{font-family:var(--mono);font-size:12.5px}pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}.muted{color:var(--muted)}.tablewrap{overflow-x:auto}
footer{color:var(--muted);font-size:13px;margin-top:40px}.badge{display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid var(--line);font-size:12px;color:var(--muted)}
ol.steps li{margin:6px 0}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
`;

export function page(title: string, body: string, opts: { description?: string } = {}): string {
  const base = publicUrl();
  const desc = escapeHtml(opts.description ?? "Does your Celo activity actually count? Pay-per-check audit of wallets, tags and projects for the Agents at Work leaderboard, settled in USA₮ over x402.");
  const t = escapeHtml(title);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t}</title><meta name="description" content="${desc}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Counted"><meta property="og:title" content="${t}"><meta property="og:description" content="${desc}"><meta property="og:url" content="${base}/">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${t}"><meta name="twitter:description" content="${desc}">
<style>${CSS}</style></head><body><main>
<header class="top"><h1><a href="/" style="color:inherit">Counted</a> <span class="badge">Celo mainnet · x402 · USA₮</span></h1>
<nav><a href="/#pay">Pay</a><a href="/ledger">Ledger</a><a href="/api/rules">Rules</a><a href="/mcp-info">MCP</a><a href="https://github.com/Harshyadav442277/counted">GitHub</a><a href="https://dune.com/celo/agents-at-work-hackathon">Board</a></nav></header>
${body}
<footer>Counted is an entry in the Celo Agents at Work Hackathon (Sep 2026). Every check is a real x402 settlement on Celo mainnet; every settlement is in the public ledger. Nothing is mocked. The organisers' Dune queries are the only authority on what counts; this is the same test, run early enough to act on.</footer>
</main></body></html>`;
}
