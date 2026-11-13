// Smoke test: load the page in jsdom with fake YouTube players and drive the main flows.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://jhapat.pages.dev/', pretendToBeVisual: true });
const w = dom.window, d = w.document;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// fake YT: every player keeps its own video, time, state and mute
const calls = [], fakes = [];
let autoplayBlocked = false, fakeMuted = false, refuseUnmute = false, seeks = [], fakeDur = 0;
const boxOf = f => d.getElementById('box' + f.id.slice(2));
const front = () => fakes.find(f => boxOf(f).classList.contains('front'));
w.YT = { Player: function (id, opts) {
  const me = this; me.id = id; me.events = opts.events; me.cur = { vid: null, t: 0, st: -1 }; me.muted = false;
  fakes.push(me);
  const fire = st => setTimeout(() => me.events.onStateChange({ data: st, target: me }), 5);
  me.loadVideoById = o => {
    calls.push(Object.assign({ p: me, front: boxOf(me).classList.contains('front') }, o));
    me.cur = { vid: o.videoId, t: o.startSeconds, st: autoplayBlocked && !me.muted ? -1 : 1 };
    if (me.cur.st === 1) fire(1);
  };
  me.isMuted = () => fakeMuted || me.muted;
  me.mute = () => { me.muted = true; };
  me.unMute = () => { if (!refuseUnmute) me.muted = false; };
  me.getDuration = () => fakeDur;
  me.getCurrentTime = () => me.cur.t;
  me.getPlayerState = () => me.cur.st;
  me.getVideoData = () => ({ video_id: me.cur.vid });
  me.pauseVideo = () => { if (me.cur.st !== 2) { me.cur.st = 2; fire(2); } };
  me.playVideo = () => { me.cur.st = 1; fire(1); };
  me.stopVideo = () => { me.cur.st = 5; };
  me.seekTo = s => { seeks.push(s); me.cur.t = s; };
  setTimeout(() => opts.events.onReady({ target: me }), 0);
} };
w.onYouTubeIframeAPIReady();

const click = sel => { const el = d.querySelector(sel); if (!el) throw new Error('missing ' + sel); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
const change = (sel, on) => { const el = d.querySelector(sel); el.checked = on; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
const mainCalls = () => calls.filter(c => c.front);
const lastMain = () => mainCalls().slice(-1)[0];
const state = () => JSON.parse(w.localStorage.getItem('jhapat.v1'));
const songOf = c => state().songs.find(x => x.videos[x.vi] === c.videoId);
const onSet = () => new Set(state().items.filter(i => i.on).map(i => i.id));
const tableTimes = s => { const on = onSet(); return s.tags.filter(t => on.has(t.item)).map(t => ({ at: t.t + (s.offset || 0), item: t.item })).sort((a, b) => a.at - b.at); };

(async () => {
  await sleep(30);
  ok(fakes.length === 2, 'desktop gets two players: one in front, one getting the next song ready');

  // 1. Start a round
  ok(d.querySelector('.now .title').textContent.includes('Start'), 'idle card shows before first drop');
  ok(d.querySelector('.now .meta').textContent.includes('7–10 seconds'), 'idle card says the 7–10s run-up');
  click('[data-act="next"]');
  ok(mainCalls().length === 1, 'Start loads a video');
  const S = state();
  ok(S.songs.length === 16 && S.seedV === 4 && S.settings.minLead === 7 && S.settings.maxLead === 10, 'fresh state: 16 songs, run-up 7–10s');
  const song = songOf(lastMain());
  ok(!!song && song.tags.length > 0, 'picked a song that has tags: ' + (song && song.title));
  ok(d.querySelector('.now .title').textContent === song.title, 'now-playing card shows the song');

  // 2. Many drops: the first table word after the drop arrives 7–10s later when there is room,
  //    and the drop never lands on the tail of an earlier table word
  let bad = 0, long = 0, close = 0, n = 0; const seen = new Set();
  for (let k = 0; k < 400; k++) {
    click('[data-act="next"]');
    const c = lastMain(), s = songOf(c);
    seen.add(s.id);
    const ts = tableTimes(s).map(x => x.at);
    const nextWord = ts.find(t => t > c.startSeconds), prevWord = [...ts].reverse().find(t => t <= c.startSeconds);
    const lead = nextWord - c.startSeconds;
    n++;
    if (!(lead > 0.9 && lead <= 10.05)) { bad++; if (bad < 4) console.log('  odd lead', s.id, c.startSeconds.toFixed(2), nextWord, lead); }
    if (lead >= 6.95) long++;
    if (prevWord !== undefined && c.startSeconds - prevWord < 1.15) { close++; if (close < 4) console.log('  close to previous word', s.id, prevWord, c.startSeconds.toFixed(2)); }
  }
  ok(bad === 0, `400 drops: first table word arrives 1–10s after the drop (bad=${bad})`);
  ok(long / n >= 0.85, `most drops get the full 7–10s run-up: ${long}/${n}`);
  ok(close === 0, `no drop starts within 1.2s after an earlier table word (close=${close})`);
  ok(![...seen].some(id => ['chiyabari', 'gurasai', 'bistarai', 'mayaraicha'].includes(id)), 'never picks untagged or Maya-only songs');
  ok(seen.size >= 10, 'picks across ' + seen.size + ' songs: ' + [...seen].join(','));

  // 3. No repeats until the list is used up
  click('[data-act="reset"]');
  const order = [];
  for (let k = 0; k < 3; k++) { click('[data-act="next"]'); order.push(lastMain().videoId); }
  ok(new Set(order).size === 3, 'three drops in a row hit three different songs');

  // 4. Tagging a new song
  click('[data-act="tab"][data-arg="songs"]');
  ok(d.querySelectorAll('.songbtn').length === 16, 'songs tab lists 16 songs: ' + d.querySelectorAll('.songbtn').length);
  click('[data-act="open"][data-arg="chiyabari"]');
  click('[data-act="tap"][data-arg="chiya"]');
  let F = state().songs.find(s => s.id === 'chiyabari');
  ok(F.tags.length === 0, 'tapping before pressing Play does not tag the wrong video');
  click('[data-act="tstart"]');
  ok(lastMain().videoId === '1mdiDuh-bUI' && lastMain().startSeconds === 0, 'Play from start loads this song at 0');
  front().cur.t = 12.5;
  click('[data-act="tap"][data-arg="chiya"]');
  F = state().songs.find(s => s.id === 'chiyabari');
  ok(F.tags.length === 1 && Math.abs(F.tags[0].t - 12.2) < 0.001, 'tap saves current time minus 0.3s delay: ' + JSON.stringify(F.tags[0]));
  click('[data-act="undo"]');
  F = state().songs.find(s => s.id === 'chiyabari');
  ok(F.tags.length === 0, 'undo removes the tap');

  // 5. Tap-sync on Phoolko Aankhama
  click('[data-act="back"]');
  click('[data-act="open"][data-arg="phoolko"]');
  ok(d.body.textContent.includes('Check sync'), 'Phoolko shows Check sync');
  click('[data-act="sync"]');
  front().cur.t = 33.0;
  click('[data-act="synctap"]');
  const P = state().songs.find(s => s.id === 'phoolko');
  ok(Math.abs(P.offset - 2.96) < 0.001 && P.sync === 'ok', 'sync sets offset from the first phool (29.74 → heard 32.70): ' + P.offset);
  ok(d.querySelector('.tagrow .time').textContent === '0:32.7', 'tag list shows synced time');

  // 6. Embedding blocked → falls back to the next upload
  click('[data-act="back"]');
  click('[data-act="open"][data-arg="simsime"]');
  click('[data-act="tstart"]');
  front().events.onError({ data: 150, target: front() });
  const Q = state().songs.find(s => s.id === 'simsime');
  ok(Q.vi === 1 && lastMain().videoId === 'kfAh1zSTgPI', 'blocked upload switches to the backup upload');

  // 7. Items: turning everything off leaves nothing to play
  click('[data-act="tab"][data-arg="play"]');
  ['paani', 'phool', 'chiya', 'paisa', 'chithi'].forEach(id => click(`.chip[data-act="item"][data-arg="${id}"]`));
  const before7 = mainCalls().length;
  click('[data-act="next"]');
  ok(mainCalls().length === before7, 'with no items on the table, Start does nothing and explains why');
  ok(d.querySelector('#toast').textContent.includes('No song'), 'toast explains: ' + d.querySelector('#toast').textContent);

  // 8. Link parser
  click('[data-act="tab"][data-arg="songs"]');
  d.querySelector('#addLink').value = 'https://youtube.com/shorts/JTZ7jzIpe_E?si=abc';
  d.querySelector('#addTitle').value = 'Test';
  d.querySelector('#addForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  ok(state().songs.slice(-1)[0].videos[0] === 'JTZ7jzIpe_E', 'shorts link parsed');

  // 9. Phone first-tap hint (one player, as on an iPhone)
  click('[data-act="tab"][data-arg="play"]');
  ['paani', 'phool', 'chiya', 'paisa', 'chithi'].forEach(id => click(`.chip[data-act="item"][data-arg="${id}"]`));
  change('#preload', false);
  ok(state().settings.preload === false, 'preload switch saves');
  autoplayBlocked = true;
  click('[data-act="next"]');
  const drop = lastMain(), h = d.querySelector('#tapHint');
  ok(h.hidden, 'no hint straight away');
  await sleep(2600);
  ok(h.hidden, 'a computer waits longer than 2s before asking for a tap');
  await sleep(4000);
  ok(!h.hidden && h.textContent.includes('Tap ▶'), 'blocked autoplay shows the tap hint after 6s on a computer: ' + h.textContent);
  front().cur.st = 1; front().cur.t = 0; // the phone started from 0 instead of the drop point
  await sleep(600);
  ok(h.hidden, 'hint hides once it plays with sound');
  ok(drop.startSeconds < 1.5 || Math.abs(front().cur.t - drop.startSeconds) < 0.01, 'started from 0 → jumped to the drop point ' + drop.startSeconds.toFixed(2));
  autoplayBlocked = false; fakeMuted = true;
  click('[data-act="next"]');
  await sleep(2600);
  ok(!h.hidden && h.textContent.includes('sound on'), 'muted playback asks for a tap to unmute: ' + h.textContent);
  fakeMuted = false;
  await sleep(600);
  ok(h.hidden, 'unmuted → hint hides');

  // 10a. Drop past the end of a short upload → skips, but never loops forever
  fakeDur = 2; const before10 = mainCalls().length;
  click('[data-act="next"]');
  await sleep(2500);
  const skips = mainCalls().length - before10 - 1;
  ok(skips >= 1 && skips <= 3, 'drops past the video end skip to another song, capped at 3: ' + skips + ' skips');
  ok(d.querySelector('#toast').textContent.length > 0, 'skip explains itself: ' + d.querySelector('#toast').textContent);
  fakeDur = 0;
  click('[data-act="next"]');
  await sleep(500);

  // 12. Background preloading
  change('#preload', true);
  click('[data-act="next"]');
  await sleep(500 + 3300);
  const spares = () => calls.filter(c => !c.front);
  let sc = spares().slice(-1)[0];
  ok(!!sc && sc.p.muted && sc.p.cur.st === 2, 'the player behind loads the next drop muted and holds it paused');
  ok(sc && songOf(sc).id !== songOf(lastMain()).id, 'it is a different song from the one playing');
  ok(d.querySelector('.now .meta').textContent.includes('next song ready'), 'now-playing card says the next song is ready');
  const nMain = mainCalls().length, oldFront = front();
  click('[data-act="next"]');
  ok(mainCalls().length === nMain, 'Next swaps to the ready player instead of loading');
  ok(front() === sc.p && front() !== oldFront, 'the ready player comes to the front');
  ok(Math.abs(front().cur.t - sc.startSeconds) < 0.01 && front().cur.st === 1 && !front().muted, 'it plays from the drop point with sound');
  ok(oldFront.cur.st === 2 && oldFront.muted, 'the old one is paused and muted behind');
  ok(d.querySelector('.now .title').textContent === songOf(sc).title, 'now-playing card shows the swapped-in song');
  await sleep(500 + 3300);
  sc = spares().slice(-1)[0];
  ok(sc.p === oldFront && sc.p.cur.st === 2, 'the old front player now gets the next one ready');
  // turning off the planned word's item re-plans the next song
  const plannedItem = tableTimes(songOf(sc)).find(x => x.at > sc.startSeconds).item;
  const nSpare = spares().length;
  click(`.chip[data-act="item"][data-arg="${plannedItem}"]`);
  await sleep(1500);
  const sc2 = spares().slice(-1)[0];
  const next2 = sc2 && tableTimes(songOf(sc2)).find(x => x.at > sc2.startSeconds);
  ok(spares().length === nSpare + 1 && next2 && next2.item !== plannedItem, 'turning off ' + plannedItem + ' re-plans the next song (' + (next2 && next2.item) + ')');
  click(`.chip[data-act="item"][data-arg="${plannedItem}"]`);
  await sleep(1500);
  // a browser that refuses sound after the swap → hint, then back to one player
  refuseUnmute = true;
  const nMain2 = mainCalls().length;
  click('[data-act="next"]');
  ok(mainCalls().length === nMain2, 'swapped again');
  await sleep(2600);
  ok(!h.hidden && h.textContent.includes('sound on'), 'if the swapped player stays muted, it asks for a tap: ' + h.textContent);
  refuseUnmute = false; front().muted = false;
  await sleep(600);
  click('[data-act="next"]');
  ok(mainCalls().length === nMain2 + 1, 'after a refused swap, Next loads in the front player again');
  const nSpare3 = spares().length;
  await sleep(4000);
  ok(spares().length === nSpare3, 'and stops getting songs ready behind');

  // 14. Small video
  change('#small', true);
  ok(d.querySelector('.stage').classList.contains('small') && state().settings.small === true, 'small video shrinks the box and saves');
  change('#small', false);
  ok(!d.querySelector('.stage').classList.contains('small'), 'and back');

  // 10. Embed refused (no referrer) → full cover with the web link
  front().events.onError({ data: 153, target: front() });
  const b = d.querySelector('#blocked');
  ok(!b.hidden && b.textContent.includes('sachdq.github.io/jhapat'), 'error 153 shows the cover with the web link');
  ok(d.querySelector('#idle').hidden, 'idle text is actually hidden now');

  // 11. An older save upgrades: new songs added, untagged seed songs get timings, the user's own songs and tags stay
  const oldState = { v: 1, seedV: 3, settings: { minLead: 3, maxLead: 8, autoNext: true, lag: 0.3 }, played: [], lastSong: null,
    items: [{ id: 'paani', name: 'Paani', words: 'paani', on: true }, { id: 'paisa', name: 'Paisa', words: 'paisa', on: true }],
    songs: [{ id: 'simsime', title: 'Sim Sime Panima', videos: ['7zpqYNZFdNI'], vi: 0, offset: 0, sync: 'ok', tags: [] },
            { id: 'baanma', title: 'Baan Ma Fulyo Phool', videos: ['5wxm1PAv3cE'], vi: 0, offset: 0, sync: 'ok', tags: [{ item: 'paani', t: 5, src: 'tap' }] },
            { id: 's1', title: 'My Song', videos: ['abcdefghijk'], vi: 0, offset: 0, sync: 'ok', tags: [{ item: 'paani', t: 10, src: 'tap' }] }] };
  const dom2 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://jhapat.pages.dev/', pretendToBeVisual: true,
    beforeParse(win) { win.localStorage.setItem('jhapat.v1', JSON.stringify(oldState)); } });
  const U = JSON.parse(dom2.window.localStorage.getItem('jhapat.v1'));
  ok(U.seedV === 4 && U.songs.length === 17, 'old save upgraded to 17 songs (16 seed + My Song): ' + U.songs.length);
  ok(U.settings.minLead === 7 && U.settings.maxLead === 10 && U.settings.preload === true, 'old default run-up 3–8s becomes 7–10s');
  ok(U.songs.find(x => x.id === 's1').tags.length === 1, 'user song kept');
  ok(U.songs.find(x => x.id === 'baanma').tags.length === 1, 'user-tagged seed song left alone');
  ok(U.songs.find(x => x.id === 'simsime').tags.length === 17, 'untagged seed song got the new timings');
  ok(/daam/.test(U.items.find(x => x.id === 'paisa').words) && U.items.some(x => x.id === 'chithi'), 'items upgraded');
  const kept = { ...oldState, settings: { minLead: 5, maxLead: 6, autoNext: true, lag: 0.3 } };
  const dom2b = new JSDOM(html, { runScripts: 'dangerously', url: 'https://jhapat.pages.dev/', pretendToBeVisual: true,
    beforeParse(win) { win.localStorage.setItem('jhapat.v1', JSON.stringify(kept)); } });
  const U2 = JSON.parse(dom2b.window.localStorage.getItem('jhapat.v1'));
  ok(U2.settings.minLead === 5 && U2.settings.maxLead === 6, 'a run-up someone chose themselves is kept');

  // 13. iPhone: one player only, and the preload switch explains why it's off
  const dom3 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/', pretendToBeVisual: true,
    beforeParse(win) {
      Object.defineProperty(win.navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
      win.__made = 0; win.YT = { Player: function () { win.__made++; } };
    } });
  dom3.window.onYouTubeIframeAPIReady();
  ok(dom3.window.__made === 1, 'iPhone gets one player');
  const pl3 = dom3.window.document.querySelector('#preload');
  ok(pl3.disabled && !pl3.checked && dom3.window.document.body.textContent.includes('Not on iPhone'), 'and the preload switch is off with the reason');

  // 15. Songs from the studio's database replace the built-in list, keep the table choices, and use each upload's offset
  const bundle = { id: 'party-mix', name: 'Nepali Party Mix', items: [{ id: 'paani', name: 'Paani', dev: 'पानी' }, { id: 'maya', name: 'Maya', dev: 'माया' }, { id: 'rumal', name: 'Rumal', dev: 'रुमाल' }],
    songs: [{ id: 'kaha', title: 'Kaha Hola Ghar', artist: 'Karma Band', status: 'tagged', videos: [{ yt: 'jU7L4KDAT6w', offset: 0, synced: true }, { yt: 'CCCCCCCCCCC', offset: 2.5, synced: true }], tags: [['paani', 96.5], ['maya', 70.1]] },
            { id: 'novid', title: 'No Upload', artist: '', status: 'tagged', videos: [], tags: [['paani', 20]] }] };
  const saved = JSON.parse(w.localStorage.getItem('jhapat.v1')); saved.items.find(i => i.id === 'maya').on = true;
  let fetched = null;
  const dom4 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/', pretendToBeVisual: true,
    beforeParse(win) { win.localStorage.setItem('jhapat.v1', JSON.stringify(saved));
      win.fetch = async (url, o) => { if (/playlist_bundle/.test(url)) fetched = { url, o }; return { ok: true, json: async () => bundle }; }; } });
  await sleep(50);
  const D4 = JSON.parse(dom4.window.localStorage.getItem('jhapat.v1')), d4 = dom4.window.document;
  ok(fetched && /rpc\/playlist_bundle$/.test(fetched.url) && JSON.parse(fetched.o.body).pid === 'party-mix' && fetched.o.headers.apikey.startsWith('sb_publishable_'), 'asks the database for the party-mix playlist with the public key');
  ok(D4.source === 'db' && D4.songs.length === 1 && D4.songs[0].id === 'kaha', 'database songs replace the built-in list (songs without an upload are skipped)');
  ok(D4.items.find(i => i.id === 'maya').on === true && D4.items.find(i => i.id === 'rumal').on === false && D4.items.find(i => i.id === 'paani').on === true, 'table choices carry over; new items start off');
  ok(d4.querySelector('.tabs').hidden && d4.querySelector('.plbar').textContent.includes('Nepali Party Mix'), 'tagging tabs step aside and the playlist is named');
  ok(D4.songs[0].offsets.join(',') === '0,2.5', 'each upload keeps its own offset');

  // 16. Playlist picker: pick a playlist → only its items, with counts → play. Items are remembered per playlist; opened playlists work offline.
  const IT = [{ id: 'paani', name: 'Paani', dev: 'पानी' }, { id: 'phool', name: 'Phool', dev: 'फूल' }, { id: 'maya', name: 'Maya', dev: 'माया' }, { id: 'chiya', name: 'Chiya', dev: 'चिया' }];
  const mkSong = (id, tags) => ({ id, title: 'Song ' + id, artist: 'A', status: 'tagged', videos: [{ yt: (id + 'xxxxxxxxxxx').slice(0, 11), offset: 0, synced: true }], tags });
  const B = {
    'party-mix': { id: 'party-mix', name: 'Nepali Party Mix', items: IT, songs: [mkSong('p1', [['paani', 30], ['phool', 60]]), mkSong('p2', [['paani', 40], ['maya', 80]])] },
    'love': { id: 'love', name: 'Love Songs', items: IT, songs: [mkSong('l1', [['maya', 30], ['phool', 50]]), mkSong('l2', [['maya', 45]])] },
  };
  const CARDS = [{ id: 'party-mix', name: 'Nepali Party Mix', description: 'The big one', songs: 2, items: { paani: 2, phool: 1, maya: 1 }, sort: 0 },
    { id: 'love', name: 'Love Songs', description: null, songs: 2, items: { maya: 2, phool: 1 }, sort: 1 },
    { id: 'empty', name: 'Empty', description: null, songs: 0, items: {}, sort: 2 }];
  let online = true; const asked = [];
  const net = async (url, o) => { asked.push(url.replace(/^.*\/rest\/v1\//, '') + (o && o.body ? ' ' + o.body : ''));
    if (!online) throw new Error('offline');
    if (/playlist_cards/.test(url)) return { ok: true, json: async () => CARDS };
    return { ok: true, json: async () => B[JSON.parse(o.body).pid] || null }; };
  const dom5 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/', pretendToBeVisual: true, beforeParse(win) { win.fetch = net; } });
  const w5 = dom5.window, d5 = w5.document, st5 = () => JSON.parse(w5.localStorage.getItem('jhapat.v1'));
  const c5 = sel => { const el = d5.querySelector(sel); if (!el) throw new Error('missing ' + sel); el.dispatchEvent(new w5.MouseEvent('click', { bubbles: true })); };
  const chips5 = () => [...d5.querySelectorAll('[data-act="item"]')].map(b => b.dataset.arg + (b.getAttribute('aria-pressed') === 'true' ? '+' : '-') + b.querySelector('.n').textContent);
  await sleep(60);
  ok(asked.some(a => /^playlist_cards\?.*owner=is\.null.*is_public=is\.true/.test(a)), 'asks for the official public playlist cards');
  const cards5 = [...d5.querySelectorAll('[data-act="pickpl"]')];
  ok(cards5.length === 2 && d5.body.textContent.includes('Pick a playlist') && !d5.querySelector('[data-act="next"]'), 'first visit: the playlist list comes first (the empty playlist is left out)');
  ok(cards5[0].textContent.includes('2 songs') && cards5[0].textContent.includes('Paani 2') && cards5[0].textContent.includes('The big one'), 'each playlist shows its song count, item counts and description');
  { const many = {}; for (let k = 0; k < 11; k++) many['it' + k] = 11 - k; // a playlist with 11 items lists its 8 most common, then "+3 more"
    const d8 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/', pretendToBeVisual: true, beforeParse(win) {
      win.fetch = async (url, o) => ({ ok: true, json: async () => (/playlist_cards/.test(url) ? [CARDS[0], { ...CARDS[1], items: many }] : B[JSON.parse(o.body).pid]) }); } });
    await sleep(60);
    const b8 = [...d8.window.document.querySelectorAll('[data-act="pickpl"][data-arg="love"] .badge')].map(x => x.textContent);
    ok(b8.length === 10 && b8[1].startsWith('it0 ') && b8[9] === '+3 more', 'a long item list shows the 8 most common and “+3 more”: ' + b8.slice(-2).join(', ')); }
  c5('[data-act="pickpl"][data-arg="love"]'); await sleep(40);
  ok(st5().playlist.id === 'love' && st5().chosen === true && !!d5.querySelector('[data-act="next"]'), 'picking a playlist loads it and opens the Play screen');
  ok(chips5().join(' ') === 'phool+1 maya+2', 'only the items in that playlist, with how many of its songs have each; Maya, in every song, starts on: ' + chips5().join(' '));
  ok(d5.querySelector('.plbar').textContent.includes('Love Songs') && !!d5.querySelector('[data-act="lists"]'), 'the Play screen names the playlist and offers Change');
  c5('[data-act="item"][data-arg="phool"]'); await sleep(10);
  ok(st5().tables.love.includes('maya') && !st5().tables.love.includes('phool') && !st5().tables['party-mix'], 'turning Phool off is remembered for Love Songs only (the party mix that loaded first wasn’t chosen)');
  c5('[data-act="next"]'); await sleep(20);
  ok(['l1', 'l2'].includes(st5().lastSong), 'Start plays a song from the chosen playlist');
  c5('[data-act="lists"]'); await sleep(10);
  ok(d5.querySelector('[data-act="pickpl"][data-arg="love"]').getAttribute('aria-current') === 'true' && !!d5.querySelector('[data-act="keeppl"]'), 'Change shows the list with the current playlist marked and a way back');
  c5('[data-act="pickpl"][data-arg="party-mix"]'); await sleep(40);
  ok(st5().playlist.id === 'party-mix' && chips5().join(' ') === 'paani+2 phool-1 maya+1', 'a playlist opened for the first time starts with what was on the table: ' + chips5().join(' '));
  c5('[data-act="item"][data-arg="paani"]'); await sleep(10);
  c5('[data-act="lists"]'); await sleep(10); c5('[data-act="pickpl"][data-arg="love"]'); await sleep(40);
  ok(chips5().join(' ') === 'phool-1 maya+2', 'back on Love Songs, its own table choices come back: ' + chips5().join(' '));
  online = false;
  c5('[data-act="lists"]'); await sleep(10); c5('[data-act="pickpl"][data-arg="party-mix"]'); await sleep(40);
  ok(st5().playlist.id === 'party-mix' && chips5().join(' ') === 'paani-2 phool-1 maya+1', 'offline: a playlist opened before still loads from the phone, with its table: ' + chips5().join(' '));
  c5('[data-act="lists"]'); await sleep(10);
  ok(d5.querySelectorAll('[data-act="pickpl"]').length === 2, 'offline: the playlist list still shows');
  const keep5 = w5.localStorage.getItem('jhapat.v1');
  const dom6 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/', pretendToBeVisual: true,
    beforeParse(win) { win.localStorage.setItem('jhapat.v1', keep5); win.fetch = async () => { throw new Error('offline'); }; } });
  await sleep(40);
  const d6 = dom6.window.document;
  ok(!!d6.querySelector('[data-act="next"]') && d6.querySelector('.plbar').textContent.includes('Nepali Party Mix') && JSON.parse(dom6.window.localStorage.getItem('jhapat.v1')).songs.length === 2,
    'reopened offline: straight to Play with the last playlist and its songs');

  // 17. A repeated line counts once: its word drops in before the repeat with the most room. Emojis show on the items.
  const IT7 = [{ id: 'paani', name: 'Paani', dev: 'पानी', emoji: '💧' }, { id: 'phool', name: 'Phool', dev: 'फूल', emoji: '🌸' }, { id: 'maya', name: 'Maya', dev: 'माया', emoji: '❤️' }];
  const chorus = { id: 'ch', title: 'Chorus Song', artist: 'A', status: 'auto', videos: [{ yt: 'chxxxxxxxxx', offset: 0, synced: true }],
    // a chorus sung four times back to back (4.5 s apart, repeat group 5) after a long intro, and one verse word
    tags: [['paani', 40, 5], ['paani', 44.5, 5], ['paani', 49, 5], ['paani', 53.5, 5], ['phool', 120, 30]] };
  const twice = { id: 'tw', title: 'Twice', artist: 'B', status: 'auto', videos: [{ yt: 'twxxxxxxxxx', offset: 0, synced: true }],
    tags: [['maya', 30, 2], ['maya', 90, 2]] }; // the same line twice, both with plenty of room
  const B7 = { id: 'party-mix', name: 'Nepali Party Mix', items: IT7, songs: [chorus, twice] };
  const dom7 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/', pretendToBeVisual: true,
    beforeParse(win) { win.fetch = async (url) => ({ ok: true, json: async () => (/playlist_cards/.test(url) ? [{ id: 'party-mix', name: 'Nepali Party Mix', songs: 2, items: {} }] : B7) }); } });
  await sleep(60);
  const w7 = dom7.window, d7 = w7.document, c7 = sel => d7.querySelector(sel).dispatchEvent(new w7.MouseEvent('click', { bubbles: true }));
  ok([...d7.querySelectorAll('[data-act="item"] .em')].map(e => e.textContent).join('') === '💧🌸❤️', 'items show their emoji');
  const maya7 = d7.querySelector('[data-act="item"][data-arg="maya"]'); if (maya7.getAttribute('aria-pressed') !== 'true') c7('[data-act="item"][data-arg="maya"]');
  const secs = s => { const m = s.match(/(\d+):(\d+(?:\.\d+)?)/); return +m[1] * 60 + +m[2]; };
  const seen7 = { paani: [], phool: [], maya: new Set() }; let crossed = 0;
  for (let k = 0; k < 240; k++) {
    c7('[data-act="next"]'); await sleep(0);
    const start = secs(d7.querySelector('.now .meta').textContent.split('dropped in at')[1]);
    c7('[data-act="reveal"]');
    const rv = d7.querySelector('.reveal').textContent, at = secs(rv.split(' at ')[1]), item = /Paani/.test(rv) ? 'paani' : /Phool/.test(rv) ? 'phool' : 'maya';
    if (item === 'maya') seen7.maya.add(at); else seen7[item].push(at);
    if (item === 'paani' && start < 30 - 0.01) crossed++; // a run-up longer than 10 s, or starting inside an earlier word
  }
  ok(seen7.paani.length > 20 && seen7.paani.every(t => t === 40), 'every Paani drop goes before the first chorus, the one with the long intro (' + seen7.paani.length + ' drops)');
  ok(seen7.phool.length > 20, 'the chorus counts once, so the verse word isn’t crowded out: Phool ' + seen7.phool.length + ', Paani ' + seen7.paani.length);
  ok(seen7.maya.has(30) && seen7.maya.has(90), 'a line sung twice with room before both takes turns between them');
  ok(crossed === 0 && d7.querySelector('.reveal').textContent.match(/💧|🌸|❤️/), 'run-ups stay within 7–10 s, and the revealed word has its emoji');


  // 18. Version, folded video, short item list, settings fold, playlist covers
  const VER = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'version.json'), 'utf8')).v;
  ok(d.querySelector('#ver').textContent === 'v' + VER, 'the version shows at the bottom and matches version.json: ' + d.querySelector('#ver').textContent);
  const IT8 = 'paani phool chiya paisa chithi maya rakshi mutu aankha sapana raat haat'.split(' ').map(id => ({ id, name: id[0].toUpperCase() + id.slice(1), dev: '' }));
  const B8 = { id: 'party-mix', name: 'Nepali Party Mix', items: IT8, songs: [mkSong('m1', IT8.map((it, k) => [it.id, 20 + k * 15])), mkSong('m2', [['paani', 30]])] }; // only Paani is in both songs
  const C8 = [{ id: 'party-mix', name: 'Nepali Party Mix', songs: 1, items: { paani: 1 }, thumbs: ['m1xxxxxxxxx', 'bad id!', 'AAAAAAAAAAA', 'BBBBBBBBBBB', 'CCCCCCCCCCC'] },
    { id: 'love', name: 'Love Songs', songs: 2, items: { maya: 2 } }];
  const dom8 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/', pretendToBeVisual: true, beforeParse(win) {
    win.fetch = async (url, o) => ({ ok: true, json: async () => (/version\.json/.test(url) ? { v: VER + 1 } : /playlist_cards/.test(url) ? C8 : B8) }); } });
  await sleep(60);
  const w8 = dom8.window, d8 = w8.document, c8 = sel => d8.querySelector(sel).dispatchEvent(new w8.MouseEvent('click', { bubbles: true }));
  ok(!d8.querySelector('#update').hidden && d8.querySelector('#update').textContent.includes('v' + (VER + 1)), 'a newer version on the site offers a reload');
  const fan = [...d8.querySelectorAll('[data-arg="party-mix"] .fan img')].map(i => i.getAttribute('src'));
  ok(fan.length === 3 && fan[0] === 'https://i.ytimg.com/vi/m1xxxxxxxxx/mqdefault.jpg' && fan[1].includes('/AAAAAAAAAAA/'), 'a playlist card fans out its first three song covers (a bad id is dropped)');
  ok(!d8.querySelector('[data-arg="love"]').classList.contains('has-fan'), 'a card without covers stays plain');
  ok(d8.querySelector('.stage').classList.contains('off') && !d8.body.textContent.includes('Step 1 of 2'), 'the video box stays folded and the list has no step text');
  c8('[data-act="pickpl"][data-arg="party-mix"]'); await sleep(40);
  const chips8 = () => [...d8.querySelectorAll('[data-act="item"]')].map(b => b.dataset.arg);
  ok(chips8().length === 8 && d8.querySelector('[data-act="moreitems"]').textContent === '+4 more', 'twelve items show eight, then “+4 more”: ' + chips8().join(' '));
  c8('[data-act="moreitems"]'); await sleep(10);
  ok(chips8().length === 12 && d8.querySelector('[data-act="moreitems"]').textContent === 'Fewer', '“+4 more” shows them all');
  c8('[data-act="item"][data-arg="haat"]'); c8('[data-act="item"][data-arg="haat"]'); c8('[data-act="moreitems"]'); await sleep(10);
  ok(chips8().length === 9 && chips8().includes('haat') && d8.querySelector('[data-act="moreitems"]').textContent === '+3 more', 'an item tapped while open stays in view when the list folds again');
  ok(d8.querySelector('.setbody').hidden && d8.querySelector('.sethead').textContent.includes('7–10'), 'settings are folded, with the run-up in the summary');
  c8('[data-act="settings"]'); await sleep(10);
  ok(!d8.querySelector('.setbody').hidden && !!d8.querySelector('#autoNext'), 'Settings opens');
  ok(!d8.querySelector('[data-act="pause"]') && d8.querySelector('.bigrow').classList.contains('solo'), 'before the first song, Start stands alone (no idle Pause)');
  w8.YT = { Player: function (id, o) { this.loadVideoById = () => {}; this.getPlayerState = () => -1; this.isMuted = () => false; this.getDuration = () => 0; this.getCurrentTime = () => 0;
    this.getVideoData = () => ({}); this.mute = () => {}; this.stopVideo = () => {}; setTimeout(() => o.events.onReady({}), 0); } };
  w8.onYouTubeIframeAPIReady(); await sleep(20);
  c8('[data-act="next"]'); await sleep(10);
  ok(!d8.querySelector('.stage').classList.contains('off') && !!d8.querySelector('[data-act="pause"]'), 'Start opens the video box and brings Pause');

  // 19. Items take even turns: Maya is in every song, Chithi in two, yet each gets about a third of the drops
  const IT9 = [{ id: 'maya', name: 'Maya', dev: 'माया' }, { id: 'paani', name: 'Paani', dev: 'पानी' }, { id: 'chithi', name: 'Chithi', dev: 'चिठी' }];
  const S9 = [];
  for (let k = 0; k < 14; k++) { const tg = [['maya', 30], ['maya', 95]]; if (k < 4) tg.push(['paani', 60]); if (k >= 12) tg.push(['chithi', 140]); S9.push(mkSong('e' + k, tg)); }
  const B9 = { id: 'party-mix', name: 'Nepali Party Mix', items: IT9, songs: S9 };
  const dom9 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/', pretendToBeVisual: true,
    beforeParse(win) { win.fetch = async (url) => ({ ok: true, json: async () => (/playlist_cards/.test(url) ? [{ id: 'party-mix', name: 'Nepali Party Mix', songs: 14, items: {} }] : B9) }); } });
  await sleep(60);
  const w9 = dom9.window, d9 = w9.document, c9 = sel => d9.querySelector(sel).dispatchEvent(new w9.MouseEvent('click', { bubbles: true }));
  for (const id of ['maya', 'paani', 'chithi']) if (d9.querySelector(`[data-act="item"][data-arg="${id}"]`).getAttribute('aria-pressed') !== 'true') c9(`[data-act="item"][data-arg="${id}"]`);
  const got9 = { maya: 0, paani: 0, chithi: 0 }, last9 = []; let rep9 = 0;
  for (let k = 0; k < 300; k++) {
    c9('[data-act="next"]'); await sleep(0);
    c9('[data-act="reveal"]');
    const rv = d9.querySelector('.reveal').textContent; got9[/Chithi/.test(rv) ? 'chithi' : /Paani/.test(rv) ? 'paani' : 'maya']++;
    const t9 = d9.querySelector('.now .title').textContent; if (last9.slice(-3).includes(t9)) rep9++; last9.push(t9);
  }
  ok(Object.values(got9).every(n => n >= 65 && n <= 135), 'each item on the table gets about a third of 300 drops, though Maya is in all 14 songs and Chithi in 2: ' + JSON.stringify(got9));
  ok(rep9 === 0, 'no song comes back within three drops, even when Chithi’s two songs are used up (' + rep9 + ')');
  const st9 = JSON.parse(w9.localStorage.getItem('jhapat.v1'));
  ok(new Set(st9.played).size === st9.played.length, 'a song played again moves to the end of the played list instead of being listed twice');

  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH', e); process.exit(1); });
