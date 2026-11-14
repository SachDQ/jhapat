// Asks YouTube's oEmbed whether each upload in the catalog still plays outside YouTube (401: its owner turned embedding off,
// 404: private or removed). Prints a Markdown report of the dead ones on stdout (nothing when every one plays), which the weekly
// workflow (.github/workflows/uploads.yml) turns into an issue. Run it by hand with `node scripts/check-uploads.mjs`.
// It reads only public data (the catalog, with the publishable key) and sends a generic User-Agent.
const API = 'https://hckzkaprxywohazohmcu.supabase.co/rest/v1', KEY = 'sb_publishable_BxH35gKGU8uwTsn-jGur9g_a_L-b98T';
const UA = { 'User-Agent': 'lyrics-matcher/1.0' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cat = await (await fetch(API + '/rpc/catalog', { headers: { apikey: KEY } })).json();
if (!cat || !Array.isArray(cat.songs)) { console.error('no catalog'); process.exit(1); }
const list = [];
for (const s of cat.songs) (s.videos || []).forEach(v => list.push({ s, yt: v.yt, others: (s.videos || []).length - 1 }));
async function ask(yt) { // the HTTP status, or 0 when YouTube didn't answer properly after three tries
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + yt), { headers: UA });
      if (r.status !== 429 && r.status < 500) return r.status;
    } catch (e) {}
    await sleep(2000 * (t + 1));
  }
  return 0;
}
const dead = [], unsure = [];
let k = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (k < list.length) {
    const x = list[k++], code = await ask(x.yt);
    if (code === 401 || code === 403 || code === 404) dead.push({ ...x, code });
    else if (code !== 200) unsure.push(x);
  }
}));
console.error(`Checked ${list.length} uploads of ${cat.songs.length} songs: ${dead.length} stopped playing, ${unsure.length} didn't answer.`);
if (dead.length) {
  const md = s => String(s || '').replace(/[|\\`*_[\]<>]/g, c => '\\' + c);
  const day = new Date().toISOString().slice(0, 10);
  console.log(`**${dead.length} upload${dead.length === 1 ? '' : 's'} stopped playing outside YouTube** (checked ${list.length} on ${day}${unsure.length ? `; ${unsure.length} didn't answer` : ''}).\n`);
  console.log('Turn them off in [Studio › Reports](https://jhapat.live/studio/#reports): Check every upload, then Turn off all. A song whose only upload stopped is out of the player until it gets a new one.\n');
  console.log('| Song | Upload | Why | Other uploads |\n|---|---|---|---|');
  for (const x of dead.sort((a, b) => a.s.title.localeCompare(b.s.title)))
    console.log(`| ${md(x.s.title)} · ${md(x.s.artist)} | [youtu.be/${x.yt}](https://youtu.be/${x.yt}) | ${x.code === 404 ? 'private or removed' : 'embedding turned off'} | ${x.others ? x.others : 'none'} |`);
}
