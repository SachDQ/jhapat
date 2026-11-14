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
  // every drop point takes its turn now, short ones (4.5–7 s) too: these packed seed songs give about 82% full run-ups, the real songs 92–96%
  ok(long / n >= 0.78, `most drops get the full 7–10s run-up: ${long}/${n}`);
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

  // The database's catalog() from playlists in their old bundle shape: every song once, each playlist as a list of its songs
  const catOf = (...bs) => { const songs = new Map(); bs.forEach(b => b.songs.forEach(x => songs.set(x.id, x)));
    return { items: bs[0].items, songs: [...songs.values()], playlists: bs.map(b => ({ id: b.id, name: b.name, description: b.description || null, songs: b.songs.map(x => x.id) })) }; };

  // 15. Songs from the database's catalog replace the built-in list, keep the table choices, and use each upload's offset.
  //     A phone with no room to store the catalog keeps its songs in the save, as before v30.
  const bundle = { id: 'party-mix', name: 'Nepali Party Mix', items: [{ id: 'paani', name: 'Paani', dev: 'पानी' }, { id: 'maya', name: 'Maya', dev: 'माया' }, { id: 'rumal', name: 'Rumal', dev: 'रुमाल' }],
    songs: [{ id: 'kaha', title: 'Kaha Hola Ghar', artist: 'Karma Band', status: 'tagged', videos: [{ yt: 'jU7L4KDAT6w', offset: 0, synced: true }, { yt: 'CCCCCCCCCCC', offset: 2.5, synced: true }], tags: [['paani', 96.5], ['maya', 70.1]] },
            { id: 'novid', title: 'No Upload', artist: '', status: 'tagged', videos: [], tags: [['paani', 20]] }] };
  const saved = JSON.parse(w.localStorage.getItem('jhapat.v1')); saved.items.find(i => i.id === 'maya').on = true;
  let fetched = null;
  const dom4 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/', pretendToBeVisual: true,
    beforeParse(win) { win.localStorage.setItem('jhapat.v1', JSON.stringify(saved));
      const set = win.Storage.prototype.setItem; win.Storage.prototype.setItem = function (k, v) { if (k === 'jhapat.cat') throw new Error('quota'); return set.call(this, k, v); };
      win.fetch = async (url, o) => { if (/\/rest\/v1\//.test(url)) fetched = { url, o }; return { ok: true, json: async () => catOf(bundle) }; }; } });
  await sleep(50);
  const D4 = JSON.parse(dom4.window.localStorage.getItem('jhapat.v1')), d4 = dom4.window.document;
  ok(fetched && /rpc\/catalog$/.test(fetched.url) && !fetched.o.body && fetched.o.headers.apikey.startsWith('sb_publishable_'), 'asks the database for its catalog, in one call with the public key');
  ok(D4.source === 'db' && D4.songs.length === 1 && D4.songs[0].id === 'kaha' && !dom4.window.localStorage.getItem('jhapat.cat'),
    'database songs replace the built-in list (songs without an upload are skipped); with no room for the catalog they stay in the save');
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
  const CAT5 = { items: IT, songs: B['party-mix'].songs.concat(B.love.songs), playlists: [{ id: 'party-mix', name: 'Nepali Party Mix', description: 'The big one', songs: ['p1', 'p2'] },
    { id: 'love', name: 'Love Songs', description: null, songs: ['l1', 'l2'] }, { id: 'empty', name: 'Empty', description: null, songs: [] }] };
  let online = true; const asked = [];
  const net = async (url, o) => { asked.push(url.replace(/^.*\/rest\/v1\//, '') + (o && o.body ? ' ' + o.body : ''));
    if (!online) throw new Error('offline');
    return { ok: true, json: async () => (/rpc\/catalog$/.test(url) ? CAT5 : null) }; };
  const dom5 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/', pretendToBeVisual: true, beforeParse(win) { win.fetch = net; } });
  const w5 = dom5.window, d5 = w5.document, st5 = () => JSON.parse(w5.localStorage.getItem('jhapat.v1'));
  const c5 = sel => { const el = d5.querySelector(sel); if (!el) throw new Error('missing ' + sel); el.dispatchEvent(new w5.MouseEvent('click', { bubbles: true })); };
  const chips5 = () => [...d5.querySelectorAll('[data-act="item"]')].map(b => b.dataset.arg + (b.getAttribute('aria-pressed') === 'true' ? '+' : '-') + b.querySelector('.n').textContent);
  await sleep(60);
  ok(asked.filter(a => !/version\.json/.test(a)).join(' ') === 'rpc/catalog', 'one call brings every playlist: ' + asked.join(', '));
  const cards5 = [...d5.querySelectorAll('[data-act="pickpl"]')];
  ok(cards5.map(c => c.dataset.arg).join(' ') === 'all party-mix love' && d5.body.textContent.includes('Pick a playlist') && !d5.querySelector('[data-act="next"]'),
    'first visit: the playlist list comes first, with All songs on top (the empty playlist is left out)');
  ok(cards5[1].textContent.includes('2 songs') && cards5[1].textContent.includes('Paani 2') && cards5[1].textContent.includes('The big one'), 'each playlist shows its song count, item counts and description');
  ok(cards5[0].textContent.includes('All songs') && cards5[0].textContent.includes('4 songs') && cards5[0].textContent.includes('Maya 3'), 'All songs counts every song once: ' + cards5[0].textContent);
  const fan5 = [...cards5[0].querySelectorAll('.fan img')].map(i => i.getAttribute('src'));
  ok(fan5.length === 2 && fan5[0].includes('/p1xxxxxxxxx/') && fan5[1].includes('/l1xxxxxxxxx/'), 'its covers are each playlist’s first song');
  { const its = []; for (let k = 0; k < 11; k++) its.push({ id: 'it' + k, name: 'it' + k, dev: '' }); // a playlist with 11 items lists its 8 most common, then "+3 more"
    const sg = []; for (let j = 0; j < 11; j++) sg.push(mkSong('q' + j, its.slice(0, 11 - j).map((it, k) => [it.id, 20 + k * 15]))); // it0 is in 11 songs, it1 in 10 … it10 in 1
    const C = { items: its, songs: sg.concat(mkSong('z0', [['it0', 30]])), playlists: [{ id: 'party-mix', name: 'P', songs: ['z0'] }, { id: 'love', name: 'Love Songs', songs: sg.map(x => x.id) }] };
    const d8 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/', pretendToBeVisual: true, beforeParse(win) {
      win.fetch = async () => ({ ok: true, json: async () => C }); } });
    await sleep(60);
    const b8 = [...d8.window.document.querySelectorAll('[data-act="pickpl"][data-arg="love"] .badge')].map(x => x.textContent);
    ok(b8.length === 10 && b8[1] === 'it0 11' && b8[9] === '+3 more', 'a long item list shows the 8 most common and “+3 more”: ' + [b8[1], b8[9]].join(', ')); }
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
  ok(d5.querySelectorAll('[data-act="pickpl"]').length === 3, 'offline: the playlist list still shows');
  c5('[data-act="pickpl"][data-arg="all"]'); await sleep(20);
  ok(st5().playlist.id === 'all' && /All songs\s*4 songs/.test(d5.querySelector('.plbar').textContent) && chips5().join(' ') === 'paani-2 phool-2 maya+3',
    'offline too, All songs opens with every song and every item they have: ' + chips5().join(' '));
  const keep5 = w5.localStorage.getItem('jhapat.v1'), cat5 = w5.localStorage.getItem('jhapat.cat');
  ok(JSON.parse(keep5).songs.length === 0 && JSON.parse(cat5).songs.length === 4 && !JSON.parse(keep5).bundles, 'songs are left out of the save: the stored catalog has them');
  const dom6 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/', pretendToBeVisual: true,
    beforeParse(win) { win.localStorage.setItem('jhapat.v1', keep5); win.localStorage.setItem('jhapat.cat', cat5); win.fetch = async () => { throw new Error('offline'); }; } });
  await sleep(40);
  const d6 = dom6.window.document;
  ok(!!d6.querySelector('[data-act="next"]') && /All songs\s*4 songs/.test(d6.querySelector('.plbar').textContent),
    'reopened offline: straight to Play with the last playlist, its songs rebuilt from the stored catalog');

  // 17. A repeated line counts once: its word drops in at the first repeat with room for the run-up. Emojis show on the items.
  const IT7 = [{ id: 'paani', name: 'Paani', dev: 'पानी', emoji: '💧' }, { id: 'phool', name: 'Phool', dev: 'फूल', emoji: '🌸' }, { id: 'maya', name: 'Maya', dev: 'माया', emoji: '❤️' }];
  const chorus = { id: 'ch', title: 'Chorus Song', artist: 'A', status: 'auto', videos: [{ yt: 'chxxxxxxxxx', offset: 0, synced: true }],
    // a chorus sung four times back to back (4.5 s apart, repeat group 5) after a long intro, and one verse word
    tags: [['paani', 40, 5], ['paani', 44.5, 5], ['paani', 49, 5], ['paani', 53.5, 5], ['phool', 120, 30]] };
  const twice = { id: 'tw', title: 'Twice', artist: 'B', status: 'auto', videos: [{ yt: 'twxxxxxxxxx', offset: 0, synced: true }],
    tags: [['maya', 30, 2], ['maya', 90, 2]] }; // the same line twice, both with plenty of room
  const B7 = { id: 'party-mix', name: 'Nepali Party Mix', items: IT7, songs: [chorus, twice] };
  const dom7 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/', pretendToBeVisual: true,
    beforeParse(win) { win.fetch = async () => ({ ok: true, json: async () => catOf(B7) }); } });
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
  ok(seen7.maya.has(30) && !seen7.maya.has(90), 'a line sung twice, with room before both, drops in at the first, so the rest of the song can play on');
  ok(crossed === 0 && d7.querySelector('.reveal').textContent.match(/💧|🌸|❤️/), 'run-ups stay within 7–10 s, and the revealed word has its emoji');


  // 18. Version, folded video, short item list, settings fold, playlist covers
  const VER = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'version.json'), 'utf8')).v;
  ok(d.querySelector('#ver').textContent === 'v' + VER, 'the version shows at the bottom and matches version.json: ' + d.querySelector('#ver').textContent);
  const IT8 = 'paani phool chiya paisa chithi maya rakshi mutu aankha sapana raat haat'.split(' ').map(id => ({ id, name: id[0].toUpperCase() + id.slice(1), dev: '' }));
  const B8 = { id: 'party-mix', name: 'Nepali Party Mix', items: IT8, songs: [mkSong('m1', IT8.map((it, k) => [it.id, 20 + k * 15])), mkSong('m2', [['paani', 30]]), mkSong('m3', [['paani', 30]]), mkSong('m4', [['paani', 30]])] };
  const L8 = { id: 'love', name: 'Love Songs', items: IT8, songs: [mkSong('m2', [['paani', 30]])] }; // songs in both: no All songs card, since it would add nothing
  const dom8 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/', pretendToBeVisual: true, beforeParse(win) {
    win.fetch = async (url) => ({ ok: true, json: async () => (/version\.json/.test(url) ? { v: VER + 1 } : catOf(B8, L8)) }); } });
  await sleep(60);
  const w8 = dom8.window, d8 = w8.document, c8 = sel => d8.querySelector(sel).dispatchEvent(new w8.MouseEvent('click', { bubbles: true }));
  ok(!d8.querySelector('#update').hidden && d8.querySelector('#update').textContent.includes('v' + (VER + 1)), 'a newer version on the site offers a reload');
  const fan = [...d8.querySelectorAll('[data-arg="party-mix"] .fan img')].map(i => i.getAttribute('src'));
  ok(fan.length === 3 && fan[0] === 'https://i.ytimg.com/vi/m1xxxxxxxxx/mqdefault.jpg' && fan[2].includes('/m3xxxxxxxxx/'), 'a playlist card fans out its first three song covers');
  ok(d8.querySelectorAll('[data-arg="love"] .fan img').length === 1 && !d8.querySelector('[data-arg="all"]'), 'a one-song playlist shows one cover, and All songs stays away when it would add no songs');
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

  // 19. Item balance: Maya is in all 14 songs, Paani in 4, Chithi in 2
  const IT9 = [{ id: 'maya', name: 'Maya', dev: 'माया' }, { id: 'paani', name: 'Paani', dev: 'पानी' }, { id: 'chithi', name: 'Chithi', dev: 'चिठी' }];
  const S9 = [];
  for (let k = 0; k < 14; k++) { const tg = [['maya', 30], ['maya', 95]]; if (k < 4) tg.push(['paani', 60]); if (k >= 12) tg.push(['chithi', 140]); S9.push(mkSong('e' + k, tg)); }
  const B9 = { id: 'party-mix', name: 'Nepali Party Mix', items: IT9, songs: S9 };
  async function run9(clicks, drops) { // clicks: presses of Item balance + (or − when negative) from the default 5
    const dom9 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/', pretendToBeVisual: true,
      beforeParse(win) { win.fetch = async () => ({ ok: true, json: async () => catOf(B9) }); } });
    await sleep(60);
    const w9 = dom9.window, d9 = w9.document, c9 = sel => d9.querySelector(sel).dispatchEvent(new w9.MouseEvent('click', { bubbles: true }));
    for (const id of ['maya', 'paani', 'chithi']) if (d9.querySelector(`[data-act="item"][data-arg="${id}"]`).getAttribute('aria-pressed') !== 'true') c9(`[data-act="item"][data-arg="${id}"]`);
    c9('[data-act="settings"]');
    for (let k = 0; k < Math.abs(clicks); k++) c9(`[data-act="balance"][data-arg="${clicks > 0 ? '+' : '-'}"]`);
    const shown = d9.querySelector('#balance').textContent, odds = (d9.querySelector('.odds') || {}).textContent || '';
    const got = { maya: 0, paani: 0, chithi: 0 }, last = []; let rep = 0;
    for (let k = 0; k < drops; k++) {
      c9('[data-act="next"]'); await sleep(0);
      c9('[data-act="reveal"]');
      const rv = d9.querySelector('.reveal').textContent; got[/Chithi/.test(rv) ? 'chithi' : /Paani/.test(rv) ? 'paani' : 'maya']++;
      const t = d9.querySelector('.now .title').textContent; if (last.slice(-7).includes(t)) rep++; last.push(t);
    }
    return { shown, odds, got, rep, st: JSON.parse(w9.localStorage.getItem('jhapat.v1')), summary: d9.querySelector('.sethead').textContent };
  }
  const mid = await run9(0, 300), even = await run9(5, 300), songsOnly = await run9(-5, 300);
  ok(mid.shown === '5' && mid.summary.includes('Balance 5') && /^Next drop: Maya 52% · Paani 27% · Chithi 22%$/.test(mid.odds),
    'Item balance starts at 5, shows in the summary, and gives the next drop’s odds: ' + mid.odds);
  ok(mid.got.maya > mid.got.paani && mid.got.paani > mid.got.chithi && mid.got.chithi >= 15 && mid.got.maya <= 240,
    'at 5, Maya (in every song) gets the most, but Paani and Chithi still get their turns: ' + JSON.stringify(mid.got));
  ok(even.shown === '10' && even.st.settings.balance === 10 && /Maya 33% · Paani 33% · Chithi 33%/.test(even.odds) && even.got.chithi > songsOnly.got.chithi && even.got.paani > songsOnly.got.paani,
    'at 10 every item has the same odds; at 0 the drops follow the songs: ' + JSON.stringify(even.got) + ' vs ' + JSON.stringify(songsOnly.got));
  ok(songsOnly.shown === '0' && /Maya 70% · Paani 20% · Chithi 10%/.test(songsOnly.odds), 'at 0 the odds follow the songs: ' + songsOnly.odds);
  ok(mid.rep + even.rep + songsOnly.rep === 0, 'no song comes back within 7 drops (half of these 14 songs), even at 10 with Chithi’s two songs (' + [mid.rep, even.rep, songsOnly.rep] + ')');
  ok(new Set(even.st.played).size === even.st.played.length, 'a song played again moves to the end of the played list instead of being listed twice');

  // 20. Drop points: a word sung right behind another table word is never a drop; a word with less room gets a shorter run-up
  const IT10 = [{ id: 'maya', name: 'Maya', dev: 'माया' }, { id: 'phool', name: 'Phool', dev: 'फूल' }];
  const A10 = mkSong('a10', [['maya', 20], ['phool', 34], ['maya', 36], ['maya', 80]]);  // the second Maya comes 2 s after Phool
  const B10 = mkSong('b10', [['phool', 10], ['maya', 16]]);                             // Maya 6 s after Phool: a short run-up
  const C10 = mkSong('c10', [['phool', 12], ['maya', 14.5]]);                           // Maya too close behind Phool: never a Maya drop
  const D10 = mkSong('d10', [['maya', 3]]);                                              // Maya 3 s into the song: too soon for any run-up
  const B10x = { id: 'party-mix', name: 'Nepali Party Mix', items: IT10, songs: [A10, B10, C10, D10] };
  const dom10 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/', pretendToBeVisual: true,
    beforeParse(win) { win.fetch = async () => ({ ok: true, json: async () => catOf(B10x) }); } });
  await sleep(60);
  const w10 = dom10.window, d10 = w10.document, c10 = sel => d10.querySelector(sel).dispatchEvent(new w10.MouseEvent('click', { bubbles: true }));
  for (const id of ['maya', 'phool']) if (d10.querySelector(`[data-act="item"][data-arg="${id}"]`).getAttribute('aria-pressed') !== 'true') c10(`[data-act="item"][data-arg="${id}"]`);
  const chip10 = id => d10.querySelector(`[data-act="item"][data-arg="${id}"]`);
  ok(chip10('maya').querySelector('.n').textContent === '3' && chip10('maya').title === '3 songs, 5 drop points' && chip10('phool').title === '3 songs, 3 drop points',
    'the chips count songs where the item has a drop point (not the song that sings Maya 3 s in), and say how many drop points: ' + chip10('maya').title);
  ok(/^3 songs match/.test(d10.querySelector('.pool').textContent), 'the pool counts the songs the game can drop into with this table: ' + d10.querySelector('.pool').textContent);
  const seen10 = new Set(), order10 = []; let crossed10 = 0, shortOk = true;
  for (let k = 0; k < 120; k++) {
    c10('[data-act="next"]'); await sleep(0);
    const title = d10.querySelector('.now .title').textContent, start = secs(d10.querySelector('.now .meta').textContent.split('dropped in at')[1]);
    c10('[data-act="reveal"]');
    const rv = d10.querySelector('.reveal').textContent, at = secs(rv.split(' at ')[1]), item = /Maya/.test(rv) ? 'maya' : 'phool';
    seen10.add(title.slice(0, 1) + ':' + item + '@' + at);
    const song = [A10, B10, C10, D10].find(x => x.title === title), before = song.tags.filter(t => t[1] < at - 0.01).map(t => t[1]);
    if (song === A10 && item === 'maya') order10.push(at);
    if (before.length && start < Math.max(...before) + 1.2 - 0.05) crossed10++;
    if (song === B10 && item === 'maya' && !(at - start >= 4.5 - 0.05 && at - start < 7)) shortOk = false;
  }
  const keys10 = [...seen10].sort();
  ok(!keys10.some(k => /:maya@(36|14\.5|3)$/.test(k)), 'a Maya sung right behind Phool is never a drop (not 0:36 in one song, not 0:14.5 in another), nor one 3 s into a song: ' + keys10.join(' '));
  ok(keys10.some(k => /:maya@20$/.test(k)) && keys10.some(k => /:maya@80$/.test(k)) && keys10.some(k => /:phool@34$/.test(k)), 'every line with room is a drop point: Maya at 0:20 and at 1:20, Phool at 0:34');
  ok(order10.length >= 4 && order10[0] === 20 && order10.every((t, i) => !i || t !== order10[i - 1]),
    'each time the song comes back for Maya it drops in at its next drop point, the earliest first: ' + order10.join(', '));
  ok(keys10.some(k => /:maya@16$/.test(k)) && shortOk, 'a Maya 6 s behind Phool still drops, with a shorter run-up that starts after Phool');
  ok(crossed10 === 0, 'no run-up starts before an earlier table word has finished (' + crossed10 + ')');

  // 21. A phone that saved its settings before Item balance existed gets balance 5, not "undefined"
  const OLD = { v: 1, seedV: 4, source: 'db', chosen: 'party-mix', songs: [], items: [], played: [], lastSong: null,
    settings: { minLead: 7, maxLead: 10, autoNext: true, lag: 0.3, preload: true, small: false } };
  const dom11 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/', pretendToBeVisual: true,
    beforeParse(win) { win.localStorage.setItem('jhapat.v1', JSON.stringify(OLD));
      win.fetch = async () => ({ ok: true, json: async () => catOf(B9) }); } });
  await sleep(80);
  const st11 = JSON.parse(dom11.window.localStorage.getItem('jhapat.v1')).settings, sum11 = (dom11.window.document.querySelector('.sethead .sum') || {}).textContent || '';
  ok(st11.balance === 5 && /Balance 5/.test(sum11) && st11.minLead === 7, 'settings saved before Item balance existed load with balance 5: ' + sum11);

  // 22. A phone coming from v29: its copy of each playlist goes once the catalog is in, and a playlist taken out of the studio
  //     (Maya Round) hands over to the party mix, its remembered table forgotten
  const V29 = { v: 1, seedV: 4, source: 'db', chosen: true, playlist: { id: 'maya-round', name: 'Maya Round' }, played: ['e1'], lastSong: 'e1',
    songs: [{ id: 'e1', title: 'Old copy', artist: '', vi: 0, videos: ['e1xxxxxxxxx'], offsets: [0], synced: [true], offset: 0, sync: 'ok', tags: [{ item: 'maya', t: 30, g: 1, src: 'db' }] }],
    items: [{ id: 'maya', name: 'Maya', on: true }], bundles: { 'maya-round': B9 }, cards: [{ id: 'maya-round', name: 'Maya Round', songs: 14 }],
    tables: { 'maya-round': ['maya'], 'party-mix': ['maya', 'paani'] }, settings: { minLead: 7, maxLead: 10, balance: 5, autoNext: true, lag: 0.3, preload: true, small: false } };
  const dom12 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/', pretendToBeVisual: true,
    beforeParse(win) { win.localStorage.setItem('jhapat.v1', JSON.stringify(V29)); win.fetch = async () => ({ ok: true, json: async () => catOf(B9) }); } });
  await sleep(80);
  const st12 = JSON.parse(dom12.window.localStorage.getItem('jhapat.v1')), d12 = dom12.window.document;
  ok(!st12.bundles && !st12.cards && st12.songs.length === 0 && JSON.parse(dom12.window.localStorage.getItem('jhapat.cat')).songs.length === 14,
    'from v29: the copies of each playlist go, and songs live in the stored catalog');
  ok(st12.playlist.id === 'party-mix' && !st12.tables['maya-round'] && st12.tables['party-mix'].join() === 'maya,paani' && /14 songs/.test(d12.querySelector('.plbar').textContent),
    'a playlist taken out of the studio hands over to the party mix, with its own table');
  ok(st12.played.join() === 'e1', 'songs already played stay played');

  // 23. A YouTube playlist: read by YouTube's player, matched by upload and then by name, asked for, shared, and rebuilt from a link
  const IT23 = [{ id: 'maya', name: 'Maya', dev: 'माया' }, { id: 'paani', name: 'Paani', dev: 'पानी' }];
  const mk23 = (id, title, artist, yt) => ({ id, title, artist, videos: [{ yt, offset: 0, synced: true }], tags: [['maya', 30, 1], ['paani', 70, 2]] });
  const cat23 = { items: IT23, playlists: [{ id: 'party-mix', name: 'Nepali Party Mix', songs: ['sasto', 'kaha', 'timi', 'other'] }],
    songs: [mk23('sasto', 'Sasto Mutu', 'Sajjan Raj Vaidya', 'SASTOxxxxxx'), mk23('kaha', 'Kaha Hola Ghar', 'Karma Band', 'KAHAxxxxxxx'), mk23('timi', 'Timi Ra Ma', 'Dixita Karki', 'TIMIxxxxxxx'), mk23('other', 'Other', 'X', 'OTHERxxxxxx')] };
  const PL23 = { PLtest1234567: ['SASTOxxxxxx', 'v2xxxxxxxxx', 'v3xxxxxxxxx', 'v4xxxxxxxxx', 'v5xxxxxxxxx', 'v2xxxxxxxxx'] }; // v2 twice
  const OE23 = { v2xxxxxxxxx: { title: 'Kaha Hola Ghar Bara - Karma Band Official Music Video', author_name: 'Karma Band' }, // another upload of a Jhapat song
    v3xxxxxxxxx: { title: 'Timi ra ma', author_name: 'Salin Magar' },     // the same title as a Jhapat song, by someone else
    v5xxxxxxxxx: { title: 'Naya Geet', author_name: 'Someone - Topic' } }; // not in Jhapat; v4 won't play outside YouTube (401)
  const posts23 = []; let copied23 = null;
  const net23 = async (url, o) => {
    if (/oembed/.test(url)) { const u = decodeURIComponent(url.split('url=')[1]), v = (u.match(/v=([\w-]{11})/) || [])[1];
      if (/playlist\?list=/.test(u)) return { ok: true, json: async () => ({ title: 'Dashain Party', author_name: 'Me' }) };
      return OE23[v] ? { ok: true, json: async () => OE23[v] } : { ok: false, status: 401, json: async () => ({}) }; }
    if (/rpc\/request_songs/.test(url)) { posts23.push(JSON.parse(o.body)); return { ok: true, json: async () => JSON.parse(o.body).vids.length }; }
    if (/rpc\/catalog/.test(url)) return { ok: true, json: async () => JSON.parse(JSON.stringify(cat23)) };
    return { ok: true, json: async () => ({}) }; };
  const setup23 = win => { win.fetch = net23; win.scrollTo = () => {};
    Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: async t => { copied23 = t; } } });
    win.YT = { Player: function (id, o) { const me = this; me.pl = null;
      me.cuePlaylist = x => { me.pl = PL23[x.list] || null; setTimeout(() => (me.pl ? o.events.onStateChange({ data: 5, target: me }) : o.events.onError({ data: 100, target: me })), 5); };
      me.getPlaylist = () => me.pl; me.destroy = () => {};
      ['loadVideoById', 'cueVideoById', 'mute', 'unMute', 'pauseVideo', 'playVideo', 'stopVideo', 'seekTo'].forEach(k => { me[k] = () => {}; });
      me.getPlayerState = () => -1; me.isMuted = () => false; me.getDuration = () => 0; me.getCurrentTime = () => 0; me.getVideoData = () => ({});
      setTimeout(() => o.events.onReady({ target: me }), 0); } }; };
  const dom23 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/', pretendToBeVisual: true, beforeParse: setup23 });
  await sleep(60);
  const w23 = dom23.window, d23 = w23.document, st23 = () => JSON.parse(w23.localStorage.getItem('jhapat.v1'));
  const c23 = sel => { const el = d23.querySelector(sel); if (!el) throw new Error('missing ' + sel); el.dispatchEvent(new w23.MouseEvent('click', { bubbles: true })); };
  const send23 = async link => { d23.querySelector('#ytLink').value = link; d23.querySelector('#ytForm').dispatchEvent(new w23.Event('submit', { bubbles: true, cancelable: true })); await sleep(250); };
  c23('[data-act="lists"]'); await sleep(10);
  ok(!!d23.querySelector('#ytForm') && /Use a YouTube playlist/.test(d23.body.textContent), 'with one playlist, Change still opens the list, which offers Use a YouTube playlist');
  await send23('https://example.com/watch?v=abc');
  ok(/isn’t a YouTube playlist link/.test(d23.querySelector('#toast').textContent) && !st23().mine, 'a link that isn’t a YouTube playlist is refused');
  await send23('https://youtube.com/playlist?list=PLtest1234567&si=xyz');
  const m23 = (st23().mine || [])[0] || {};
  ok(m23.id === 'yt-PLtest1234567' && m23.name === 'Dashain Party' && (m23.songs || []).join() === 'sasto,kaha' && JSON.stringify(m23.n) === '{"upload":1,"name":1,"gone":1}',
    'its songs match by upload (Sasto Mutu), then by name and artist (another upload of Kaha Hola Ghar); a duplicate counts once: ' + JSON.stringify(m23.n));
  ok((m23.missing || []).map(x => x.yt + ':' + x.title).join() === 'v3xxxxxxxxx:Timi ra ma,v5xxxxxxxxx:Naya Geet', 'the same title by another artist isn’t taken for a Jhapat song; those two wait to be asked for');
  const card23 = d23.querySelector('[data-act="pickpl"][data-arg="yt-PLtest1234567"]'), sum23 = (d23.querySelector('.minesum') || {}).textContent;
  ok(card23 && /Dashain Party/.test(card23.textContent) && /2 songs/.test(card23.textContent) && sum23 === '1 ready · 1 matched by name · 2 not in Jhapat yet · 1 won’t play outside YouTube',
    'its card sits under From YouTube with what matched: ' + sum23);
  ok(d23.querySelectorAll('.miss li').length === 2 && /Naya Geet/.test(d23.querySelector('.miss').textContent), 'the videos not in Jhapat yet are listed with their covers');
  c23('[data-act="ytask"]'); await sleep(30);
  ok(posts23.length === 1 && posts23[0].vids.map(v => v.yt + '|' + v.title + '|' + v.channel).join() === 'v3xxxxxxxxx|Timi ra ma|Salin Magar,v5xxxxxxxxx|Naya Geet|Someone - Topic',
    'Ask sends the missing videos with their titles to request_songs');
  ok(st23().asked.join() === 'v3xxxxxxxxx,v5xxxxxxxxx' && !d23.querySelector('[data-act="ytask"]') && /Asked for 2/.test(d23.body.textContent), 'and this phone remembers it asked, so it can’t ask twice');
  c23('[data-act="ytshare"]'); await sleep(10);
  ok(copied23 === 'https://sachdq.github.io/jhapat/#yt=PLtest1234567', 'Share copies a link that rebuilds it: ' + copied23);
  c23('[data-act="pickpl"][data-arg="yt-PLtest1234567"]'); await sleep(20);
  ok(/Dashain Party\s*2 songs/.test(d23.querySelector('.plbar').textContent), 'picking it plays only its songs: ' + d23.querySelector('.plbar').textContent);
  c23('[data-act="next"]'); await sleep(10);
  ok(['sasto', 'kaha'].includes(st23().lastSong), 'Start plays one of them, from Jhapat’s timed upload');
  // the asked-for song arrives in Jhapat: the next visit's catalog adds it to the playlist, with no need to read YouTube again
  cat23.songs.push(mk23('naya', 'Naya Geet', 'Someone', 'v5xxxxxxxxx'));
  const keep23 = w23.localStorage.getItem('jhapat.v1'), kcat23 = w23.localStorage.getItem('jhapat.cat');
  const dom24 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/', pretendToBeVisual: true,
    beforeParse(win) { setup23(win); win.localStorage.setItem('jhapat.v1', keep23); win.localStorage.setItem('jhapat.cat', kcat23); } });
  await sleep(80);
  const m24 = JSON.parse(dom24.window.localStorage.getItem('jhapat.v1')).mine[0];
  ok(m24.songs.join() === 'sasto,kaha,naya' && m24.missing.length === 1 && /Dashain Party\s*3 songs/.test(dom24.window.document.querySelector('.plbar').textContent),
    'a song asked for joins the playlist by itself once it’s in Jhapat');
  // a shared link on a phone that has never seen it: read from YouTube and opened
  const dom25 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/#yt=PLtest1234567', pretendToBeVisual: true, beforeParse: setup23 });
  await sleep(300);
  const d25 = dom25.window.document;
  ok(/Dashain Party\s*3 songs/.test((d25.querySelector('.plbar') || {}).textContent || '') && !!d25.querySelector('[data-act="next"]') && dom25.window.location.hash === '',
    'a shared link reads the playlist from YouTube, opens it straight away and tidies the address');
  c23('[data-act="lists"]'); await sleep(10); c23('[data-act="ytdel"]'); await sleep(10);
  ok(!st23().mine.length && st23().playlist.id === 'party-mix', 'Remove takes it off the phone and goes back to the party mix');

  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH', e); process.exit(1); });
