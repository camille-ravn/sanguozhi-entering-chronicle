const fs = require("fs");
const path = "C:/Users/Kanolinka/WorkBuddy/2026-09-26-14-10-20/data.js";
global.window = {};
require(path);
const people = window.SGZ_DATA.people;

const API = "https://zh.wikipedia.org/w/api.php";
const UA = "WorkBuddy-SGZ-Chronicle/1.0 (local research prototype; contact: local)";

async function fetchBatch(titles) {
  const url = `${API}?action=query&format=json&formatversion=2&redirects=1&prop=extracts&exintro=1&explaintext=1&exsentences=4&titles=${encodeURIComponent(titles.join("|"))}&origin=*`;
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

(async () => {
  const out = {};
  const problems = [];
  const all = people.map((p) => p.name);
  for (let i = 0; i < all.length; i += 20) {
    const batch = all.slice(i, i + 20);
    const json = await fetchBatch(batch);
    const pages = json?.query?.pages || [];
    for (const page of pages) {
      if (page.missing || !page.extract) { problems.push({ title: page.title, reason: page.missing ? "missing" : "no-extract" }); continue; }
      out[page.title] = { title: page.title, extract: page.extract.trim(), url: "https://zh.wikipedia.org/wiki/" + encodeURIComponent(page.title) };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  const matched = people.filter((p) => out[p.name]);
  const unmatched = people.filter((p) => !out[p.name]).map((p) => p.name);
  console.log(JSON.stringify({ fetched: Object.keys(out).length, matched: matched.length, unmatched, problems: problems.slice(0, 20) }, null, 1));
  fs.writeFileSync("C:/Users/Kanolinka/WorkBuddy/2026-09-26-14-10-20/.wiki-raw.json", JSON.stringify(out, null, 1), "utf8");
})();
