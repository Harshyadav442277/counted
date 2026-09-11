// Paste into the browser console on https://dune.com/celo/agents-at-work-hackathon
// after scrolling to the bottom once (the tables render lazily). Copies a board
// snapshot JSON to the clipboard and prints it. Upload with `npm run board:snapshot`.
(() => {
  const byQuery = { 8400974: "track1", 8405652: "track2", 8405664: "stablecoin", 8425318: "headline", 8667672: "askbots", 8405672: "registered" };
  const tables = {};
  document.querySelectorAll("table").forEach((t) => {
    let h = t;
    let key = null;
    for (let i = 0; i < 12 && h; i++) {
      h = h.parentElement;
      const a = h && h.querySelector('a[href*="/queries/"]');
      const m = a && a.getAttribute("href").match(/\/queries\/(\d+)/);
      if (m) {
        key = byQuery[m[1]];
        break;
      }
    }
    if (!key || tables[key]) return;
    const rows = [...t.querySelectorAll("tr")];
    const head = [...rows[0].querySelectorAll("th,td")].map((c) => c.innerText.trim().replace(/\s+/g, " "));
    tables[key] = rows.slice(1).map((r) => {
      const cells = [...r.querySelectorAll("th,td")].map((c) => c.innerText.trim().replace(/\s+/g, " "));
      const o = {};
      head.forEach((k, i) => {
        o[k] = cells[i] ?? "";
      });
      return o;
    });
  });
  const updated = [...document.querySelectorAll("*")]
    .map((e) => e.childNodes.length === 1 && e.textContent.trim())
    .find((s) => s && /^Updated\b/.test(s)) || undefined;
  const snap = { capturedAt: new Date().toISOString(), boardUpdated: updated, tables };
  const json = JSON.stringify(snap);
  if (navigator.clipboard) navigator.clipboard.writeText(json).catch(() => {});
  console.log(json);
  return json;
})();
