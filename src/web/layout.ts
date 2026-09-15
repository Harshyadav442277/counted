import { publicUrl } from "../config.js";

/** Shared HTML shell. One inline stylesheet, no build step. */
export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The look is an auditor's tally sheet: cool ledger paper, blue-black ink, ruled lines and a
 * red margin. Celo yellow appears only as a highlighter, on a verdict or the option chosen.
 * Motion follows motion.dev's performance guidance: opacity and clip-path only, one sequence
 * on load, one on a settled payment, nothing under prefers-reduced-motion.
 */
export const CSS = `
:root{--paper:#eef2ee;--sheet:#f8faf7;--ink:#1b2a3a;--ink-2:#44525e;--rule:#c9d4cc;--field:#9fb0a6;--margin:#dc9c95;--mark:#fcff52;--pass:#2f6b2f;--fail:#a3312b;--warn:#7d5200;
--sans:"Schibsted Grotesk",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--ease:cubic-bezier(.2,.8,.2,1)}
*{box-sizing:border-box}html{color-scheme:light}
body{margin:0;background:var(--paper);color:var(--ink);font:400 16px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:underline;text-decoration-color:var(--field);text-decoration-thickness:1px;text-underline-offset:3px}
a:hover{text-decoration-color:var(--ink)}
:focus-visible{outline:2px solid var(--ink);outline-offset:3px}
.wrap{max-width:1080px;margin:0 auto;padding:0 28px}
header.top{display:flex;align-items:center;justify-content:space-between;gap:12px 28px;flex-wrap:wrap;padding:20px 0 16px;border-bottom:1px solid var(--rule)}
.brand{display:inline-flex;align-items:center;gap:10px;font-weight:700;font-size:21px;letter-spacing:-.01em;text-decoration:none}
.brand svg{width:28px;height:20px;flex:none}
nav.site{display:flex;gap:6px 22px;flex-wrap:wrap;font-size:15px}
nav.site a{color:var(--ink-2);text-decoration:none}
nav.site a:hover{color:var(--ink);text-decoration:underline}
main{padding:52px 0 64px}
h1{font-size:clamp(36px,5vw,54px);line-height:1.05;letter-spacing:-.025em;font-weight:700;margin:0 0 20px;max-width:15ch}
h1.page{font-size:clamp(30px,4vw,40px);max-width:none}
h2{font-size:21px;line-height:1.25;font-weight:600;letter-spacing:-.005em;margin:0 0 10px}
h3{font-size:16px;line-height:1.3;font-weight:600;margin:0 0 6px}
p{margin:0 0 14px;max-width:66ch}
.lede{font-size:19px;line-height:1.5}
.muted{color:var(--ink-2)}.small{font-size:14px}
.ok{color:var(--pass)}.bad{color:var(--fail)}.warn{color:var(--warn)}
.mono,code,pre{font-family:var(--mono)}
code{font-size:.88em;background:#e1e8e2;padding:1px 5px;border-radius:3px;overflow-wrap:anywhere}
pre{font-size:13.5px;line-height:1.5;background:var(--sheet);border:1px solid var(--rule);border-left:3px solid var(--ink);border-radius:0 4px 4px 0;padding:12px 14px;margin:8px 0 12px;overflow:auto;white-space:pre-wrap;word-break:break-word}
section{margin-top:56px;padding-top:28px;border-top:1px solid var(--rule)}
section>p:last-child{margin-bottom:0}

.hero{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:56px;align-items:start}
.sheet{position:relative;background:var(--sheet);border:1px solid var(--rule);border-radius:6px;padding:20px 22px 18px 46px;margin-top:6px}
.sheet::before{content:"";position:absolute;top:0;bottom:0;left:30px;width:1px;background:var(--margin)}
.sheet .who{font:500 16px/1.4 var(--mono);margin:0 0 2px}
.sheet .src{font-size:13px;color:var(--ink-2);margin:0 0 14px}
.checks{list-style:none;margin:0;padding:0}
.checks li{display:grid;grid-template-columns:20px minmax(0,1fr);gap:10px;padding:10px 0;border-top:1px solid var(--rule);font-size:15px;line-height:1.4}
.checks svg{width:16px;height:16px;margin-top:2px}
.checks .y{color:var(--pass)}.checks .n{color:var(--fail)}
.checks small{display:block;margin-top:2px;font-size:13px;color:var(--ink-2)}
.verdict{display:flex;justify-content:space-between;align-items:baseline;gap:6px 14px;flex-wrap:wrap;margin-top:6px;padding-top:12px;border-top:2px solid var(--ink)}
.verdict b{font-size:24px;line-height:1.2;letter-spacing:-.015em}
.verdict .note{font-size:13px;color:var(--ink-2)}
.hl{position:relative;z-index:0;padding:0 .1em}
.hl::before{content:"";position:absolute;z-index:-1;left:-.06em;right:-.06em;top:.18em;bottom:.02em;background:var(--mark);transform:skewX(-8deg)}

form.check{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;max-width:600px;margin:30px 0 14px}
form.check label{display:grid;gap:5px;font-size:14px;color:var(--ink-2)}
form.check .wide{grid-column:1/-1}
form.check button{align-self:end}
input,select{width:100%;min-width:0;font:400 16px/1.3 var(--sans);color:var(--ink);background:#fff;border:1px solid var(--field);border-radius:4px;padding:11px 12px}
input.addr{font-family:var(--mono);font-size:15px}
input::placeholder{color:#76837f}
input:focus-visible,select:focus-visible{outline:2px solid var(--ink);outline-offset:1px;border-color:var(--ink)}
button,a.btn{display:inline-block;font:600 16px/1 var(--sans);color:var(--sheet);background:var(--ink);border:1px solid var(--ink);border-radius:4px;padding:13px 18px;cursor:pointer;text-decoration:none}
button:hover,a.btn:hover{background:#0e1b29}
button[disabled]{opacity:.55;cursor:progress}
button.choice{color:var(--ink);background:#fff;border-color:var(--field);font-weight:500;padding:11px 14px}
button.choice:hover{border-color:var(--ink);background:#fff}
button.choice[aria-pressed="true"]{background:var(--mark);border-color:var(--ink)}

.cols{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:36px;margin-top:18px}
.cols p{font-size:15px}
ul.rules{list-style:none;margin:16px 0 14px;padding:0;max-width:74ch}
ul.rules li{padding:11px 0;border-top:1px solid var(--rule)}
ul.rules li:last-child{border-bottom:1px solid var(--rule)}

.figures{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:18px 0 22px;border-top:2px solid var(--ink);border-bottom:1px solid var(--rule)}
.figures div{padding:14px 16px 12px}
.figures div:first-child{padding-left:0}
.figures div+div{border-left:1px solid var(--rule)}
.figures b{display:block;font:500 28px/1.1 var(--mono);font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.figures span{font-size:14px;color:var(--ink-2)}
.tablewrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;font-weight:600;color:var(--ink-2);padding:8px 14px 8px 0;border-bottom:2px solid var(--ink);white-space:nowrap}
td{padding:9px 14px 9px 0;border-bottom:1px solid var(--rule);vertical-align:top}
.links{display:flex;gap:18px;flex-wrap:wrap;font-size:15px}

.step{display:grid;grid-template-columns:48px minmax(0,1fr);padding:24px 0;border-top:1px solid var(--rule)}
.step .num{font:500 26px/1.1 var(--mono);color:var(--ink-2)}
.step h2{margin-bottom:12px}
.choices{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}
.payrow{display:flex;gap:10px 16px;align-items:center;flex-wrap:wrap}
.status{font-size:15px}

footer{border-top:1px solid var(--rule);padding:22px 0 44px;font-size:14px;color:var(--ink-2)}
footer p{max-width:84ch}

@media (max-width:860px){.hero{grid-template-columns:minmax(0,1fr);gap:36px}.cols{grid-template-columns:minmax(0,1fr);gap:24px}}
@media (max-width:600px){.wrap{padding:0 18px}main{padding-top:36px}form.check{grid-template-columns:minmax(0,1fr)}.figures{grid-template-columns:repeat(2,minmax(0,1fr))}.figures div:nth-child(3){padding-left:0;border-left:0}.figures div:nth-child(n+3){border-top:1px solid var(--rule)}.step{grid-template-columns:36px minmax(0,1fr)}}
@media (prefers-reduced-motion:no-preference){
.checks li{animation:appear .36s var(--ease) both;animation-delay:calc(var(--i,0) * 120ms + 180ms)}
.verdict{animation:appear .36s var(--ease) both;animation-delay:.7s}
.verdict .hl::before,.status .hl::before{animation:swipe .5s var(--ease) both}
.verdict .hl::before{animation-delay:.95s}
}
@keyframes appear{from{opacity:0}to{opacity:1}}
@keyframes swipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Schibsted+Grotesk:wght@400;500;600;700&display=swap">`;

/** Four strokes and a slash: the tally mark for five, which is what the product does. */
export const TALLY = `<svg viewBox="0 0 28 20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 2.5v15M10 2.5v15M16 2.5v15M22 2.5v15"/><path d="M1.5 14.5 26.5 5.5"/></g></svg>`;

export function page(title: string, body: string, opts: { description?: string } = {}): string {
  const base = publicUrl();
  const desc = escapeHtml(opts.description ?? "Does your Celo activity actually count? Pay-per-check audit of wallets, tags and projects for the Agents at Work leaderboard, settled in USA₮ over x402.");
  const t = escapeHtml(title);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t}</title><meta name="description" content="${desc}"><meta name="theme-color" content="#eef2ee">
<meta property="og:type" content="website"><meta property="og:site_name" content="Counted"><meta property="og:title" content="${t}"><meta property="og:description" content="${desc}"><meta property="og:url" content="${base}/">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${t}"><meta name="twitter:description" content="${desc}">
<link rel="icon" href="/counted.svg" type="image/svg+xml">
${FONTS}<style>${CSS}</style></head><body><div class="wrap">
<header class="top"><a class="brand" href="/">${TALLY}Counted</a>
<nav class="site" aria-label="Site"><a href="/#check">Run a check</a><a href="/ledger">Ledger</a><a href="/#rules">What counts</a><a href="/mcp-info">MCP and API</a><a href="https://github.com/Harshyadav442277/counted">GitHub</a><a href="https://dune.com/celo/agents-at-work-hackathon">Leaderboard</a></nav></header>
<main>
${body}
</main>
<footer><p>Counted is an entry in the Celo Agents at Work Hackathon, September 2026. Every paid check is a real x402 settlement on Celo mainnet and appears in the public ledger. The organisers' Dune queries decide what counts; Counted runs the same test early enough for you to act on it.</p></footer>
</div></body></html>`;
}
