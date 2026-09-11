// Paste into the browser console on https://dune.com/celo/agents-at-work-hackathon.
// Dune mounts each table only while it is on screen, so this scrolls the page in
// steps and merges what it sees. Copies a board snapshot JSON to the clipboard and
// prints it. Upload with `npm run board:snapshot -- board.json`.
(async () => {
  const byQuery = { 8400974: "track1", 8405652: "track2", 8405664: "stablecoin", 8425318: "headline", 8667672: "askbots", 8405672: "registered" };
  const tables = {};
  const heads = {};
  const clean = (c) => c.innerText.trim().replace(/\s+/g, " ");
  const grab = () => {
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
      if (!key) return;
      const rows = [...t.querySelectorAll("tr")];
      if (rows.length < 2) return;
      const head = [...rows[0].querySelectorAll("th,td")].map(clean);
      // The first table seen under a query title wins; a later one only replaces it
      // when it has the same columns and more rows (a longer render of the same table).
      if (heads[key] && heads[key] !== head.join("|")) return;
      const data = rows.slice(1).map((r) => {
        const cells = [...r.querySelectorAll("th,td")].map(clean);
        const o = {};
        head.forEach((k, i) => {
          o[k] = cells[i] ?? "";
        });
        return o;
      });
      if (!tables[key] || data.length > tables[key].length) {
        tables[key] = data;
        heads[key] = head.join("|");
      }
    });
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.scrollTo(0, 0);
  await sleep(1500);
  grab();
  const total = document.documentElement.scrollHeight;
  for (let y = 0; y < total + 800; y += 600) {
    window.scrollTo(0, y);
    await sleep(700);
    grab();
  }
  const updated = [...document.querySelectorAll("*")]
    .map((e) => e.childNodes.length === 1 && e.textContent.trim())
    .find((s) => s && /^Updated\b/.test(s)) || undefined;
  const snap = { capturedAt: new Date().toISOString(), boardUpdated: updated, tables };
  const json = JSON.stringify(snap);
  if (navigator.clipboard) navigator.clipboard.writeText(json).catch(() => {});
  console.log(Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length + " rows"])));
  console.log(json);
  return json;
})();
