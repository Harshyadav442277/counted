import { config, paymentsEnabled, publicUrl } from "../config.js";
import { RULES } from "../core/audit.js";
import { TOKENS } from "../core/chain.js";
import type { CallRow, Stats } from "../core/ledger/types.js";
import { howToPay, priceUsd } from "../core/x402.js";
import { escapeHtml as e, page } from "./layout.js";

export function landingPage(o: { stats: Stats; recent: CallRow[]; ledgerKind: string }): string {
  const base = publicUrl();
  const c = config();
  const bot = c.TELEGRAM_BOT_USERNAME ? `https://t.me/${c.TELEGRAM_BOT_USERNAME}` : null;
  const how = howToPay("verify", base);
  const body = `
<p class="lede">The Agents at Work leaderboard only counts counterparties that are <b>independent</b> and <b>existed before 28 August</b>. Nobody can see that from a block explorer. Counted runs the organisers' audit on any wallet, transaction or project, and settles each check in USA₮ over x402.</p>
<p class="sub">Verified users, returning users, signer gate, adjusted volume, attribution tags, stablecoin rails: the same checks the published Dune queries apply, run early enough to act on. ${paymentsEnabled() ? "" : '<span class="warn">Payments are not configured on this deployment yet.</span>'}</p>
<div class="grid">
  <div class="stat"><b>${o.stats.paidCalls}</b><span>paid checks</span></div>
  <div class="stat"><b>${o.stats.payers}</b><span>distinct payers</span></div>
  <div class="stat"><b>$${o.stats.revenueUsd.toFixed(2)}</b><span>settled over x402</span></div>
  <div class="stat"><b>${o.stats.today.calls}</b><span>checks today</span></div>
</div>
<div class="panel" id="pay"><h2>Run a check</h2>
<form class="row" action="/pay" method="get">
  <select name="tool"><option value="verify">Verify a wallet ($${priceUsd("verify").toFixed(2)})</option><option value="tagcheck">Check a tag in a transaction ($${priceUsd("tagcheck").toFixed(2)})</option><option value="audit">Audit my project wallet ($${priceUsd("audit").toFixed(2)})</option></select>
  <input name="subject" placeholder="0x… wallet or transaction hash" required pattern="0x[0-9a-fA-F]{40}(0x[0-9a-fA-F]{24})?|0x[0-9a-fA-F]{64}">
  <input name="tag" placeholder="celo_… (optional)">
  <button type="submit">Continue to payment</button>
</form>
<p class="muted">Pay from the wallet you used before 28 August: that is the one that counts as a verified user. Need USA₮? Verify once in the <a href="https://self.xyz">Self app</a> and claim from the <a href="https://cloud.google.com/application/web3/faucet/celo/mainnet">Google Cloud faucet</a>.</p>
</div>
<div class="panel"><h2>Three ways to pay</h2>
<ol class="steps">
<li><b>Agents with <code>@celo/buy</code></b> (no CELO needed, gas is sponsored):<pre>${e(how.buyCurl)}</pre></li>
<li><b>Any x402 v2 client</b>: GET <code>${e(base)}/api/verify?wallet=0x…</code>, <code>/api/tagcheck?tx=0x…</code>, <code>/api/audit?wallet=0x…</code>. The 402 lists USA₮, USDC and USD₮ on <code>eip155:42220</code>.</li>
<li><b>Browser wallet</b>: the form above. MetaMask or Rabby signs an EIP-3009 authorisation; the facilitator settles it and pays the gas.</li>
</ol>
${bot ? `<p>In Telegram: <a href="${bot}">@${e(c.TELEGRAM_BOT_USERNAME)}</a> — <code>/standing celo_…</code> is free, paid checks post their result back into the chat.</p>` : ""}
<p>MCP: <code>claude mcp add --transport http counted ${e(base)}/mcp</code></p>
</div>
<div class="panel"><h2>What counts</h2><ul>${RULES.map((r) => `<li>${e(r)}</li>`).join("")}</ul><p class="muted">Sources: <a href="https://dune.com/celo/agents-at-work-hackathon">the live board and its SQL</a>, <a href="https://celobuilders.xyz/hackathons/agents-at-work/rules">the portal rules</a>.</p></div>
<div class="panel"><h2>Ledger <span class="badge">${e(o.ledgerKind)}</span></h2>${ledgerTable(o.recent)}<p><a href="/ledger">All calls</a> · <a href="/api/ledger">JSON</a></p></div>`;
  return page("Counted — does your Celo activity actually count?", body);
}

export function ledgerTable(rows: CallRow[]): string {
  if (!rows.length) return `<p class="muted">No calls yet.</p>`;
  return `<div class="tablewrap"><table><thead><tr><th>when (UTC)</th><th>tool</th><th>subject</th><th>paid</th><th>payer</th><th>settlement</th><th>result</th></tr></thead><tbody>${rows
    .map(
      (r) => `<tr><td class="mono">${e(r.at.slice(0, 16).replace("T", " "))}</td><td>${e(r.tool)}</td><td class="mono">${e(r.subject.slice(0, 12))}…</td><td>${r.paid ? `<span class="ok">$${(r.amountUsd ?? 0).toFixed(2)} ${e(r.asset ?? "")}</span>` : '<span class="muted">free</span>'}</td><td class="mono">${r.payer ? `<a href="https://celoscan.io/address/${e(r.payer)}">${e(r.payer.slice(0, 10))}…</a>` : ""}</td><td class="mono">${r.settlementTx ? `<a href="https://celoscan.io/tx/${e(r.settlementTx)}">${e(r.settlementTx.slice(0, 12))}…</a>` : ""}</td><td>${e(r.summary ?? "")}</td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}

export function ledgerPage(o: { stats: Stats; rows: CallRow[]; ledgerKind: string }): string {
  const body = `<p class="lede">Every call, newest first. Paid rows link to the settlement on Celoscan; the payer is the EIP-3009 authoriser, which is the signer the leaderboard counts.</p>
<div class="grid"><div class="stat"><b>${o.stats.calls}</b><span>calls</span></div><div class="stat"><b>${o.stats.paidCalls}</b><span>paid</span></div><div class="stat"><b>${o.stats.payers}</b><span>payers</span></div><div class="stat"><b>$${o.stats.revenueUsd.toFixed(2)}</b><span>settled</span></div></div>
<div class="panel"><h2>Calls <span class="badge">${e(o.ledgerKind)}</span></h2>${ledgerTable(o.rows)}</div>`;
  return page("Counted — ledger", body);
}

export function mcpInfoPage(): string {
  const base = publicUrl();
  const body = `<p class="lede">Counted is also an MCP server. Six tools: rules and standing are free; verify, tagcheck and audit are paid over x402.</p>
<div class="panel"><h2>Add it</h2><pre>claude mcp add --transport http counted ${e(base)}/mcp</pre>
<p>Paid tools accept an optional <code>payment</code> argument: a base64 x402 v2 PaymentPayload (the same value an x402 client puts in <code>PAYMENT-SIGNATURE</code>). Without it they return the 402 terms plus a <code>buy</code> one-liner that pays them.</p></div>
<div class="panel"><h2>Endpoints</h2><pre>GET ${e(base)}/api/verify?wallet=0x…&amp;own=0x…      $${priceUsd("verify").toFixed(2)}
GET ${e(base)}/api/tagcheck?tx=0x…&amp;tag=celo_…     $${priceUsd("tagcheck").toFixed(2)}
GET ${e(base)}/api/audit?wallet=0x…&amp;tag=celo_…     $${priceUsd("audit").toFixed(2)}
GET ${e(base)}/api/standing?tag=celo_…              free
GET ${e(base)}/api/rules · /api/prices · /api/ledger · /api/health   free</pre></div>`;
  return page("Counted — MCP and API", body);
}

/**
 * `/pay?tool=verify` with no subject yet. `howToPay` hands that URL out over MCP and the
 * site, so it has to be a usable page rather than a 400: ask for the thing that is
 * missing instead of refusing the request.
 */
export function payPromptPage(o: { tool: "verify" | "tagcheck" | "audit"; tag: string | null }): string {
  const wantsTx = o.tool === "tagcheck";
  const label = { verify: "Verify a wallet", tagcheck: "Check a tag in a transaction", audit: "Audit a project wallet" }[o.tool];
  const opts = (["verify", "tagcheck", "audit"] as const)
    .map((t) => `<option value="${t}"${t === o.tool ? " selected" : ""}>${e({ verify: "Verify a wallet", tagcheck: "Check a tag in a transaction", audit: "Audit a project wallet" }[t])} ($${priceUsd(t).toFixed(2)})</option>`)
    .join("");
  const body = `
<p class="lede">${e(label)} — $${priceUsd(o.tool).toFixed(2)}, settled in USA₮, USDC or USD₮ over x402 on Celo mainnet.</p>
<p class="sub">One thing missing: ${wantsTx ? "the transaction to look at" : "the wallet to check"}. Paste it below and the payment page opens next.</p>
<div class="panel"><h2>Run a check</h2>
<form class="row" action="/pay" method="get">
  <select name="tool">${opts}</select>
  <input name="subject" autofocus required placeholder="${wantsTx ? "0x… transaction hash (64 hex)" : "0x… wallet address (40 hex)"}" pattern="${wantsTx ? "0x[0-9a-fA-F]{64}" : "0x[0-9a-fA-F]{40}"}">
  <input name="tag" value="${e(o.tag ?? "")}" placeholder="celo_… (optional)">
  <button type="submit">Continue to payment</button>
</form>
<p class="muted">Pay from a wallet that was active on Celo before 28 August: that is the one the leaderboard counts as a verified user.</p></div>
<div class="panel"><h2>Prefer not to use a browser?</h2><pre>${e(howToPay(o.tool, publicUrl()).buyCurl)}</pre>
<p class="muted">Or add the MCP server: <code>claude mcp add --transport http counted ${e(publicUrl())}/mcp</code></p></div>`;
  return page(`Counted — ${label.toLowerCase()}`, body);
}

/** The browser pay page: connect a wallet, sign EIP-3009, let the facilitator settle, show the result. */
export function payPage(o: { tool: "verify" | "tagcheck" | "audit"; params: Record<string, string>; chat: string | null }): string {
  const base = publicUrl();
  const tokens = ["USAT", "USDC", "USDT"].map((k) => {
    const t = TOKENS[k]!;
    return { key: k, symbol: t.symbol, address: t.address.toLowerCase(), name: t.eip712!.name, version: t.eip712!.version, decimals: t.decimals };
  });
  const query = new URLSearchParams({ ...o.params, ...(o.chat ? { chat: o.chat } : {}), via: "web" }).toString();
  const subject = o.params["wallet"] ?? o.params["tx"] ?? "";
  const body = `
<p class="lede">${o.tool === "audit" ? "Audit" : o.tool === "tagcheck" ? "Tag check" : "Verify"} <code>${e(subject)}</code></p>
<p class="sub">Price $${priceUsd(o.tool).toFixed(2)}. Your wallet signs a one-time EIP-3009 authorisation for exactly that amount; the Celo x402 facilitator submits it and pays the gas. No approval, no CELO needed.${o.chat ? " The result is also posted back into your Telegram chat." : ""}</p>
<div class="panel"><h2>1. Choose the asset</h2>
<div class="row" id="assets"></div>
<p class="muted">USA₮ settled over x402 is the highest-scoring rail for the stablecoin bounty. Get USA₮ free after Self verification at the <a href="https://cloud.google.com/application/web3/faucet/celo/mainnet">Google Cloud faucet</a>.</p></div>
<div class="panel"><h2>2. Pay and get the result</h2>
<div class="row"><button id="pay" type="button">Connect wallet and pay</button><span id="status" class="muted">Reading the 402 terms…</span></div>
<pre id="out" hidden></pre></div>
<script>
(function(){
  var TOOL=${JSON.stringify(o.tool)}, QUERY=${JSON.stringify(query)}, TOKENS=${JSON.stringify(tokens)};
  var url='/api/'+TOOL+'?'+QUERY, terms=null, chosen=null;
  var $=function(id){return document.getElementById(id)};
  function status(t,cls){var s=$('status');s.textContent=t;s.className=cls||'muted'}
  function show(obj){var o=$('out');o.hidden=false;o.textContent=typeof obj==='string'?obj:JSON.stringify(obj,null,2)}
  function b64(s){return btoa(unescape(encodeURIComponent(s)))}
  function ub64(s){return decodeURIComponent(escape(atob(s)))}
  function hexRandom(){var a=new Uint8Array(32);crypto.getRandomValues(a);return '0x'+Array.from(a).map(function(b){return b.toString(16).padStart(2,'0')}).join('')}
  async function loadTerms(){
    var r=await fetch(url,{headers:{accept:'application/json'}});
    if(r.status!==402){status('This route did not ask for payment ('+r.status+').','warn');show(await r.text());return}
    var h=r.headers.get('PAYMENT-REQUIRED');
    terms=h?JSON.parse(ub64(h)):await r.json();
    var box=$('assets');box.replaceChildren();
    (terms.accepts||[]).forEach(function(req,i){
      var t=TOKENS.find(function(x){return x.address===String(req.asset).toLowerCase()});
      var label=(t?t.symbol:req.asset.slice(0,8))+' · '+(Number(req.amount)/1e6).toFixed(2);
      var b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.i=i;
      b.onclick=function(){chosen=req;Array.from(box.children).forEach(function(c){c.style.outline=''});b.style.outline='3px solid var(--fg)';status('Paying with '+label)};
      box.appendChild(b);if(i===0)b.click();
    });
    status('Terms loaded. Connect a wallet on Celo mainnet (MetaMask, Rabby).');
  }
  async function ensureChain(eth){
    var id=await eth.request({method:'eth_chainId'});
    if(id==='0xa4ec')return;
    try{await eth.request({method:'wallet_switchEthereumChain',params:[{chainId:'0xa4ec'}]})}
    catch(err){await eth.request({method:'wallet_addEthereumChain',params:[{chainId:'0xa4ec',chainName:'Celo',nativeCurrency:{name:'CELO',symbol:'CELO',decimals:18},rpcUrls:['https://forno.celo.org'],blockExplorerUrls:['https://celoscan.io']}]})}
  }
  async function pay(){
    var eth=window.ethereum;
    if(!eth){status('No browser wallet found. Install MetaMask or Rabby, or pay with buy / any x402 client.','bad');return}
    if(!chosen){status('Pick an asset first.','warn');return}
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
      else{status('Payment did not go through ('+r.status+').','bad');show(body)}
    }catch(err){status(err&&err.message?err.message:String(err),'bad')}
    $('pay').disabled=false;
  }
  $('pay').onclick=pay;loadTerms().catch(function(e){status(e.message,'bad')});
})();
</script>
<p class="muted">Agents: <code>${e(howToPay(o.tool, base).buyCurl.replace("0x…", subject || "0x…"))}</code></p>`;
  return page(`Counted — pay $${priceUsd(o.tool).toFixed(2)} for ${o.tool}`, body);
}
