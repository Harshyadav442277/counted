import { config, paymentsEnabled, publicUrl } from "../config.js";
import { RULES } from "../core/audit.js";
import { TOKENS } from "../core/chain.js";
import type { CallRow, Stats } from "../core/ledger/types.js";
import { howToPay, priceUsd } from "../core/x402.js";
import { escapeHtml as e, page } from "./layout.js";

const PASS = `<svg class="y" viewBox="0 0 16 16" aria-label="passes"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const FAIL = `<svg class="n" viewBox="0 0 16 16" aria-label="fails"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;

const TOOL_LABEL = { verify: "Verify a wallet", tagcheck: "Check the tag in a transaction", audit: "Audit a project wallet" } as const;
type Tool = keyof typeof TOOL_LABEL;

function toolOptions(selected: Tool): string {
  return (Object.keys(TOOL_LABEL) as Tool[])
    .map((t) => `<option value="${t}"${t === selected ? " selected" : ""}>${e(TOOL_LABEL[t])}, $${priceUsd(t).toFixed(2)}</option>`)
    .join("");
}

function checkForm(o: { tool: Tool; tag: string | null; autofocus?: boolean }): string {
  const wantsTx = o.tool === "tagcheck";
  return `<form class="check" action="/pay" method="get" id="check">
  <label class="wide">What to check<select name="tool">${toolOptions(o.tool)}</select></label>
  <label class="wide">Wallet address or transaction hash<input class="addr" name="subject" required${o.autofocus ? " autofocus" : ""} autocomplete="off" spellcheck="false" placeholder="${wantsTx ? "0x… 64 hex characters" : "0x… 40 hex characters"}" pattern="0x[0-9a-fA-F]{40}|0x[0-9a-fA-F]{64}"></label>
  <label>Your attribution tag, if you have one<input class="addr" name="tag" value="${e(o.tag ?? "")}" autocomplete="off" spellcheck="false" placeholder="celo_…"></label>
  <button type="submit">Continue to payment</button>
</form>`;
}

/**
 * The hero's example is real: Counted's audit of its own test wallet, run on 15 Sep 2026.
 * It is the one wallet whose truth we know, and it fails the way most do.
 */
const EXAMPLE = `<aside class="sheet" aria-label="Example verdict">
<p class="who">0x5510…5726</p>
<p class="src">Counted's own test wallet, as the audit saw it on 15 Sep 2026</p>
<ul class="checks">
  <li style="--i:0">${PASS}<div>Paid over x402<small>0.05 USA₮ settled on Celo mainnet, 11 Sep</small></div></li>
  <li style="--i:1">${FAIL}<div>Moved a token between 29 Jun and 28 Aug<small>First seen 11 Sep, inside the counting window</small></div></li>
  <li style="--i:2">${FAIL}<div>Not funded by the project<small>First funded by Counted's agent wallet</small></div></li>
  <li style="--i:3">${PASS}<div>Not a contract</div></li>
</ul>
<div class="verdict"><b><span class="hl">Not counted</span></b><span class="note">Neither a verified user nor a signer</span></div>
</aside>`;

export function landingPage(o: { stats: Stats; recent: CallRow[]; ledgerKind: string }): string {
  const base = publicUrl();
  const c = config();
  const bot = c.TELEGRAM_BOT_USERNAME ? `https://t.me/${c.TELEGRAM_BOT_USERNAME}` : null;
  const how = howToPay("verify", base);
  const body = `
<div class="hero">
<div>
<h1>Does your Celo activity actually count?</h1>
<p class="lede">The Agents at Work leaderboard only counts a user whose wallet moved a token on Celo between 29 June and 28 August and was never funded by your project. A block explorer can't show which of yours pass. Counted can, for $${priceUsd("verify").toFixed(2)} a wallet, paid over x402 on Celo mainnet.</p>
${paymentsEnabled() ? "" : '<p class="warn">Payments are not configured on this deployment, so checks cannot be paid for yet.</p>'}
${checkForm({ tool: "verify", tag: null })}
<p class="small muted">Pay from a wallet that moved a token on Celo between 29 June and 28 August: that payment counts for you and for us. Need USA₮? Verify once in the <a href="https://self.xyz">Self app</a>, then claim from the <a href="https://cloud.google.com/application/web3/faucet/celo/mainnet">Google Cloud faucet</a>.</p>
</div>
${EXAMPLE}
</div>

<section aria-labelledby="other-ways">
<h2 id="other-ways">Run checks without the browser</h2>
<div class="cols">
<div><h3>Agents with <code>@celo/buy</code></h3><p class="muted">No CELO needed; the gas is sponsored.</p><pre>${e(how.buyCurl)}</pre></div>
<div><h3>Any x402 v2 client</h3><p class="muted">Request <code>/api/verify?wallet=0x…</code>, <code>/api/tagcheck?tx=0x…</code> or <code>/api/audit?wallet=0x…</code>. The 402 response offers USA₮, USDC and USD₮ on <code>eip155:42220</code>.</p></div>
<div><h3>MCP clients and Telegram</h3><pre>claude mcp add --transport http counted ${e(base)}/mcp</pre>${bot ? `<p class="muted">In <a href="${bot}">@${e(c.TELEGRAM_BOT_USERNAME)}</a>, <code>/standing celo_…</code> is free and paid checks post their result back into the chat.</p>` : ""}</div>
</div>
</section>

<section id="rules" aria-labelledby="rules-h">
<h2 id="rules-h">What the leaderboard counts</h2>
<ul class="rules">${RULES.map((r) => `<li>${e(r)}</li>`).join("")}</ul>
<p class="small muted">Sources: <a href="https://dune.com/celo/agents-at-work-hackathon">the live leaderboard and its SQL</a> and <a href="https://celobuilders.xyz/hackathons/agents-at-work/rules">the portal rules</a>.</p>
</section>

<section aria-labelledby="ledger-h">
<h2 id="ledger-h">Ledger</h2>
<p class="muted">Every paid check, with the payer and the settlement transaction.</p>
${figures(o.stats, [["paidCalls", "paid checks"], ["payers", "distinct payers"], ["revenue", "settled over x402"], ["today", "checks today"]])}
${ledgerNote(o.ledgerKind)}${ledgerTable(o.recent)}
<p class="links"><a href="/ledger">All calls</a><a href="/api/ledger">Ledger as JSON</a></p>
</section>`;
  return page("Counted — does your Celo activity actually count?", body);
}

type Figure = "calls" | "paidCalls" | "payers" | "revenue" | "today";
function figures(s: Stats, items: Array<[Figure, string]>): string {
  const value = (f: Figure) =>
    f === "revenue" ? `$${s.revenueUsd.toFixed(2)}` : f === "today" ? String(s.today.calls) : String(s[f]);
  return `<div class="figures">${items.map(([f, label]) => `<div><b>${e(value(f))}</b><span>${e(label)}</span></div>`).join("")}</div>`;
}

function ledgerNote(kind: string): string {
  return kind === "memory" ? `<p class="warn small">This ledger is held in memory on this deployment, so it empties when the server restarts.</p>` : "";
}

export function ledgerTable(rows: CallRow[]): string {
  if (!rows.length) return `<p class="muted">No calls yet. The first paid check will appear here with its settlement transaction.</p>`;
  return `<div class="tablewrap"><table><thead><tr><th>When (UTC)</th><th>Check</th><th>Subject</th><th>Paid</th><th>Payer</th><th>Settlement</th><th>Result</th></tr></thead><tbody>${rows
    .map(
      (r) => `<tr><td class="mono">${e(r.at.slice(0, 16).replace("T", " "))}</td><td>${e(r.tool)}</td><td class="mono">${e(r.subject.slice(0, 12))}…</td><td>${r.paid ? `<span class="ok">$${(r.amountUsd ?? 0).toFixed(2)} ${e(r.asset ?? "")}</span>` : '<span class="muted">free</span>'}</td><td class="mono">${r.payer ? `<a href="https://celoscan.io/address/${e(r.payer)}">${e(r.payer.slice(0, 10))}…</a>` : ""}</td><td class="mono">${r.settlementTx ? `<a href="https://celoscan.io/tx/${e(r.settlementTx)}">${e(r.settlementTx.slice(0, 12))}…</a>` : ""}</td><td>${e(r.summary ?? "")}</td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}

export function ledgerPage(o: { stats: Stats; rows: CallRow[]; ledgerKind: string }): string {
  const body = `<h1 class="page">Ledger</h1>
<p class="lede">Every call, newest first. Paid rows link to their settlement on Celoscan. The payer is the wallet that signed the EIP-3009 authorisation, which is the signer the leaderboard counts.</p>
${figures(o.stats, [["calls", "calls"], ["paidCalls", "paid"], ["payers", "payers"], ["revenue", "settled"]])}
${ledgerNote(o.ledgerKind)}${ledgerTable(o.rows)}`;
  return page("Counted — ledger", body);
}

export function mcpInfoPage(): string {
  const base = publicUrl();
  const body = `<h1 class="page">Counted over MCP and HTTP</h1>
<p class="lede">Six MCP tools. Rules and standing are free; verify, tagcheck and audit are paid over x402.</p>
<section aria-labelledby="add-h"><h2 id="add-h">Add the server</h2><pre>claude mcp add --transport http counted ${e(base)}/mcp</pre>
<p>Paid tools take an optional <code>payment</code> argument: a base64 x402 v2 PaymentPayload, the same value an x402 client sends in <code>PAYMENT-SIGNATURE</code>. Without it they return the 402 terms and a <code>buy</code> command that pays them.</p></section>
<section aria-labelledby="ep-h"><h2 id="ep-h">HTTP endpoints</h2><pre>GET ${e(base)}/api/verify?wallet=0x…&amp;own=0x…      $${priceUsd("verify").toFixed(2)}
GET ${e(base)}/api/tagcheck?tx=0x…&amp;tag=celo_…     $${priceUsd("tagcheck").toFixed(2)}
GET ${e(base)}/api/audit?wallet=0x…&amp;tag=celo_…     $${priceUsd("audit").toFixed(2)}
GET ${e(base)}/api/standing?tag=celo_…              free
GET ${e(base)}/api/rules, /api/prices, /api/ledger, /api/health   free</pre></section>`;
  return page("Counted — MCP and API", body);
}

/**
 * `/pay?tool=verify` with no subject yet. `howToPay` hands that URL out over MCP and the
 * site, so it has to be a usable page rather than a 400: ask for the thing that is
 * missing instead of refusing the request.
 */
export function payPromptPage(o: { tool: Tool; tag: string | null }): string {
  const label = TOOL_LABEL[o.tool];
  const body = `
<h1 class="page">${e(label)}, $${priceUsd(o.tool).toFixed(2)}</h1>
<p class="lede">Settled in USA₮, USDC or USD₮ over x402 on Celo mainnet. Paste ${o.tool === "tagcheck" ? "the transaction to look at" : "the wallet to check"} and the payment page opens next.</p>
${checkForm({ tool: o.tool, tag: o.tag, autofocus: true })}
<p class="small muted">Pay from a wallet that moved a token on Celo between 29 June and 28 August: that is the one the leaderboard counts as a verified user.</p>
<section aria-labelledby="nobrowser-h"><h2 id="nobrowser-h">Without a browser</h2><pre>${e(howToPay(o.tool, publicUrl()).buyCurl)}</pre>
<p class="muted">Or add the MCP server: <code>claude mcp add --transport http counted ${e(publicUrl())}/mcp</code></p></section>`;
  return page(`Counted — ${label.toLowerCase()}`, body);
}

/** The browser pay page: connect a wallet, sign EIP-3009, let the facilitator settle, show the result. */
export function payPage(o: { tool: Tool; params: Record<string, string>; chat: string | null }): string {
  const base = publicUrl();
  const tokens = ["USAT", "USDC", "USDT"].map((k) => {
    const t = TOKENS[k]!;
    return { key: k, symbol: t.symbol, address: t.address.toLowerCase(), name: t.eip712!.name, version: t.eip712!.version, decimals: t.decimals };
  });
  const query = new URLSearchParams({ ...o.params, ...(o.chat ? { chat: o.chat } : {}), via: "web" }).toString();
  const subject = o.params["wallet"] ?? o.params["tx"] ?? "";
  const body = `
<h1 class="page">${o.tool === "audit" ? "Audit" : o.tool === "tagcheck" ? "Tag check" : "Verify"}, $${priceUsd(o.tool).toFixed(2)}</h1>
<p class="lede mono" style="font-size:16px;overflow-wrap:anywhere">${e(subject)}</p>
<p>Your wallet signs a one-time EIP-3009 authorisation for exactly $${priceUsd(o.tool).toFixed(2)}. The Celo x402 facilitator submits it and pays the gas, so there is no approval and no CELO needed.${o.chat ? " The result is also posted back into your Telegram chat." : ""}</p>
<div class="step"><div class="num">1</div><div><h2>Choose the asset</h2>
<div class="choices" id="assets"></div>
<p class="small muted">USA₮ settled over x402 scores highest for the stablecoin bounty. Get USA₮ free after Self verification at the <a href="https://cloud.google.com/application/web3/faucet/celo/mainnet">Google Cloud faucet</a>.</p></div></div>
<div class="step"><div class="num">2</div><div><h2>Pay and get the result</h2>
<div class="payrow"><button id="pay" type="button">Connect wallet and pay</button><span id="status" class="status muted" role="status">Reading the payment terms…</span></div>
<pre id="out" hidden></pre></div></div>
<script>
(function(){
  var TOOL=${JSON.stringify(o.tool)}, QUERY=${JSON.stringify(query)}, TOKENS=${JSON.stringify(tokens)};
  var url='/api/'+TOOL+'?'+QUERY, terms=null, chosen=null;
  var $=function(id){return document.getElementById(id)};
  function status(t,cls){var s=$('status');s.className='status '+(cls||'muted');if(cls==='ok'){var m=document.createElement('span');m.className='hl';m.textContent=t;s.replaceChildren(m)}else{s.textContent=t}}
  function show(obj){var o=$('out');o.hidden=false;o.textContent=typeof obj==='string'?obj:JSON.stringify(obj,null,2)}
  function b64(s){return btoa(unescape(encodeURIComponent(s)))}
  function ub64(s){return decodeURIComponent(escape(atob(s)))}
  function hexRandom(){var a=new Uint8Array(32);crypto.getRandomValues(a);return '0x'+Array.from(a).map(function(b){return b.toString(16).padStart(2,'0')}).join('')}
  async function loadTerms(){
    var r=await fetch(url,{headers:{accept:'application/json'}});
    if(r.status!==402){status('This check did not ask for payment (HTTP '+r.status+').','warn');show(await r.text());return}
    var h=r.headers.get('PAYMENT-REQUIRED');
    terms=h?JSON.parse(ub64(h)):await r.json();
    var box=$('assets');box.replaceChildren();
    (terms.accepts||[]).forEach(function(req,i){
      var t=TOKENS.find(function(x){return x.address===String(req.asset).toLowerCase()});
      var label=(t?t.symbol:req.asset.slice(0,8))+', '+(Number(req.amount)/1e6).toFixed(2);
      var b=document.createElement('button');b.type='button';b.className='choice';b.textContent=label;b.setAttribute('aria-pressed','false');
      b.onclick=function(){chosen=req;Array.from(box.children).forEach(function(c){c.setAttribute('aria-pressed','false')});b.setAttribute('aria-pressed','true');status('Paying with '+label)};
      box.appendChild(b);if(i===0)b.click();
    });
    status('Terms loaded. Connect a wallet on Celo mainnet, such as MetaMask or Rabby.');
  }
  async function ensureChain(eth){
    var id=await eth.request({method:'eth_chainId'});
    if(id==='0xa4ec')return;
    try{await eth.request({method:'wallet_switchEthereumChain',params:[{chainId:'0xa4ec'}]})}
    catch(err){await eth.request({method:'wallet_addEthereumChain',params:[{chainId:'0xa4ec',chainName:'Celo',nativeCurrency:{name:'CELO',symbol:'CELO',decimals:18},rpcUrls:['https://forno.celo.org'],blockExplorerUrls:['https://celoscan.io']}]})}
  }
  async function pay(){
    var eth=window.ethereum;
    if(!eth){status('No browser wallet found. Install MetaMask or Rabby, or pay with buy or any x402 client.','bad');return}
    if(!chosen){status('Choose an asset first.','warn');return}
    $('pay').disabled=true;
    try{
      var accounts=await eth.request({method:'eth_requestAccounts'});var from=accounts[0];
      await ensureChain(eth);
      var t=TOKENS.find(function(x){return x.address===String(chosen.asset).toLowerCase()})||{};
      var extra=chosen.extra||{};
      var validAfter='0', validBefore=String(Math.floor(Date.now()/1000)+240), nonce=hexRandom();
      var typed={types:{EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}],
        TransferWithAuthorization:[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}]},
        primaryType:'TransferWithAuthorization',
        domain:{name:extra.name||t.name,version:extra.version||t.version,chainId:42220,verifyingContract:chosen.asset},
        message:{from:from,to:chosen.payTo,value:chosen.amount,validAfter:validAfter,validBefore:validBefore,nonce:nonce}};
      status('Sign the authorisation in your wallet…');
      var sig=await eth.request({method:'eth_signTypedData_v4',params:[from,JSON.stringify(typed)]});
      var payload={x402Version:2,resource:terms.resource,accepted:chosen,payload:{signature:sig,authorization:{from:from,to:chosen.payTo,value:chosen.amount,validAfter:validAfter,validBefore:validBefore,nonce:nonce}}};
      status('Settling on Celo through the facilitator…');
      var r=await fetch(url,{headers:{accept:'application/json','PAYMENT-SIGNATURE':b64(JSON.stringify(payload))}});
      var body=await r.json().catch(function(){return {}});
      var pr=r.headers.get('PAYMENT-RESPONSE');var settle=pr?JSON.parse(ub64(pr)):null;
      if(r.ok){status('Settled.'+(settle&&settle.transaction?' Tx '+settle.transaction:''),'ok');show({settlement:settle,result:body})}
      else{status('The payment did not go through (HTTP '+r.status+'). The response is below.','bad');show(body)}
    }catch(err){status(err&&err.message?err.message:String(err),'bad')}
    $('pay').disabled=false;
  }
  $('pay').onclick=pay;loadTerms().catch(function(e){status(e.message,'bad')});
})();
</script>
<section aria-labelledby="agents-h"><h2 id="agents-h">Paying from an agent</h2><pre>${e(howToPay(o.tool, base).buyCurl.replace("0x…", subject || "0x…"))}</pre></section>`;
  return page(`Counted — pay $${priceUsd(o.tool).toFixed(2)} for ${o.tool}`, body);
}
