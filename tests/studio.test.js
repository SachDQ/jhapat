// Studio smoke test: jsdom + an in-memory stand-in for Supabase + a fake YouTube player + a fake LRCLIB.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'studio', 'index.html'), 'utf8');
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeDb() {
  return {
    items: [
      { id: 'paani', name: 'Paani', dev: 'पानी', words: ['paani', 'pani', 'पानी'], note: null, sort: 0 },
      { id: 'chithi', name: 'Chithi', dev: 'चिठी', words: ['chithi', 'चिठी'], note: null, sort: 1 },
    ],
    songs: [{ id: 'old', title: 'Old Song', artist: 'Someone', status: 'tagged', lrclib_id: null, duration: 200, notes: null, lines: null }],
    videos: [{ id: 1, song_id: 'old', yt: 'AAAAAAAAAAA', kind: 'official', duration: 200, offset_s: 0, synced: true, embeddable: true, rank: 0 }],
    tags: [{ id: 1, song_id: 'old', item_id: 'paani', t: 30, line: null, word: null, source: 'estimate', checked: false }],
    playlists: [{ id: 'party-mix', name: 'Nepali Party Mix', description: null, sort: 0, is_public: true, owner: null }],
    playlist_songs: [{ playlist_id: 'party-mix', song_id: 'old', position: 0 }],
    requests: [], reports: [], stats: [], stats_min: [], wishes: [],
    seq: 100, log: [],
  };
}
function fakeSb(db, opts) {
  const listeners = [];
  const session = opts.signedIn ? { user: { id: 'u1', email: 'me@example.com' } } : null;
  function from(table) {
    const st = { op: 'select', filters: [], single: false, sel: '*' };
    const api = {
      select(c) { if (st.op === 'select') st.sel = c || '*'; else st.ret = true; return api; },
      order() { return api; },
      limit() { return api; },
      eq(c, v) { st.filters.push(r => r[c] === v); return api; },
      gte(c, v) { st.filters.push(r => r[c] >= v); return api; },
      in(c, vs) { st.filters.push(r => vs.includes(r[c])); return api; },
      single() { st.single = true; return api; },
      range(from, to) { st.range = [from, to]; db.ranges = (db.ranges || 0) + 1; return api; },
      insert(rows) { st.op = 'insert'; st.rows = Array.isArray(rows) ? rows : [rows]; return api; },
      update(p) { st.op = 'update'; st.patch = p; return api; },
      delete() { st.op = 'delete'; return api; },
      then(res, rej) { if (db.dropNext && db.dropNext(table, st)) { db.dropNext = null; return Promise.resolve({ data: null, error: { message: 'TypeError: Failed to fetch' } }).then(res, rej); }
        return (db.delay ? new Promise(r => setTimeout(r, db.delay)) : Promise.resolve()).then(run).then(res, rej); },
    };
    const match = r => st.filters.every(f => f(r));
    const embed = r => {
      const o = { ...r };
      if (table === 'songs') {
        if (/line0:lines->0/.test(st.sel)) { o.line0 = Array.isArray(r.lines) && r.lines.length ? r.lines[0] : null; delete o.lines; }
        if (/videos\(/.test(st.sel)) o.videos = db.videos.filter(v => v.song_id === r.id).map(v => ({ ...v }));
        if (/tags\(count\)/.test(st.sel)) o.tags = [{ count: db.tags.filter(t => t.song_id === r.id).length }];
        else if (/tags\(/.test(st.sel)) o.tags = db.tags.filter(t => t.song_id === r.id).map(t => ({ ...t }));
      }
      if (table === 'playlists' && /playlist_songs/.test(st.sel)) o.playlist_songs = db.playlist_songs.filter(x => x.playlist_id === r.id).map(x => ({ ...x }));
      return o;
    };
    function run() {
      db.log.push(table + ':' + st.op);
      const T = db[table];
      if (st.op === 'select') { let rows = T.filter(match).map(embed); if (st.range) rows = rows.slice(st.range[0], Math.min(st.range[1] + 1, st.range[0] + (db.maxRows || 1000))); return st.single ? (rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } }) : { data: rows, error: null }; }
      if (st.op === 'insert') {
        const added = st.rows.map(r => { const x = { ...r }; if (['tags', 'videos'].includes(table)) x.id = ++db.seq;
          if (table === 'videos') Object.assign(x, { offset_s: 0, synced: false, embeddable: true, duration: null }, r, { id: x.id });
          if (table === 'tags') Object.assign(x, { line: null, word: null, checked: false }, r, { id: x.id });
          T.push(x); return { ...x }; });
        return { data: st.single ? added[0] : added, error: null };
      }
      if (st.op === 'update') { T.filter(match).forEach(r => Object.assign(r, st.patch)); return { data: null, error: null }; }
      if (st.op === 'delete') { db[table] = T.filter(r => !match(r)); return { data: null, error: null }; }
    }
    return api;
  }
  return {
    from,
    rpc: async name => ({ data: name === 'is_editor' ? !!opts.editor : null, error: null }),
    auth: {
      onAuthStateChange(cb) { listeners.push(cb); setTimeout(() => cb('INITIAL_SESSION', session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => ({ data: { session } }),
      signInWithOtp: async a => { db.otp = a; return { error: null }; },
      signOut: async () => ({ error: null }),
    },
  };
}
// invented test lyrics (not from any song): a verse with चिठी, a chorus line with पानी three times
const LRC = ['[00:10.00] यो चिठी आज लेख्छु', '[00:14.00] आकाशमा बादल', '[00:18.00] पानी पर्यो आज', '[00:22.00] हावा चल्यो', '[00:26.00] पानी पर्यो आज', '[00:30.00] ', '[00:34.00] पानी पर्यो आज', '[00:38.00] अन्तिम हरफ'].join('\n');
function makeDom(db, opts) {
  const yt = { t: 0, vid: null, st: -1, dur: 42, seeks: [], lens: { DDDDDDDDDDD: 42, EEEEEEEEEEE: 99 } };
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: opts.url || 'https://sachdq.github.io/jhapat/studio/', pretendToBeVisual: true,
    beforeParse(win) {
      win.__fakeSb = fakeSb(db, opts);
      win.scrollTo = () => {}; win.HTMLElement.prototype.scrollIntoView = function () {};
      win.CSS = win.CSS || {}; win.CSS.escape = s => String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
      win.__lrcPace = { gap: 0, wait: 5 };
      win.fetch = async url => { if (/lrclib/.test(url)) { db.lrcCalls = (db.lrcCalls || 0) + 1; (db.lrcUrls = db.lrcUrls || []).push(url); }
        if (/youtube\.com\/oembed/.test(url)) { const v = (decodeURIComponent(url).match(/v=([\w-]{11})/) || [])[1], code = (db.oembed || {})[v] || 200; return { ok: code === 200, status: code, json: async () => ({ title: 'x' }) }; }
        const busy = /lrclib/.test(url) && (db.lrcDown || (/Long Cut/.test(decodeURIComponent(url)) && !db.busyOnce && (db.busyOnce = true)));
        if (busy) return { ok: false, status: 429, json: async () => ({ statusCode: 429, name: 'RateLimitExceeded' }) };
        return realFetch(url); };
      const realFetch = async url => /version\.json/.test(url) ? { ok: true, json: async () => ({ v: db.ver || 0 }) }
        : /api\/get\/\d+/.test(url) ? { ok: true, status: 200, json: async () => ({ id: +url.match(/api\/get\/(\d+)/)[1], trackName: 'Exact One', artistName: 'Band E', albumName: 'Demo', duration: 42, syncedLyrics: LRC, plainLyrics: 'x' }) }
        : ({ json: async () => !/lrclib/.test(url) || /Nothing/.test(decodeURIComponent(url)) ? []
        : [{ id: 555, trackName: 'Test Rain', artistName: 'Test Band', albumName: 'Demo', duration: 42, syncedLyrics: LRC, plainLyrics: 'x' }] });
      win.YT = { Player: function (id, o) {
        if (id === 'measure') { // the importer's off-screen player
          let vid = null; this.loadVideoById = a => { vid = a.videoId; }; this.getDuration = () => yt.lens[vid] || 0; this.getVideoData = () => ({ video_id: vid });
          this.mute = () => {}; this.stopVideo = () => {}; setTimeout(() => o.events.onReady({}), 0); return;
        }
        this.cueVideoById = a => { yt.vid = a.videoId; yt.st = 5; };
        this.loadVideoById = a => { yt.vid = a.videoId; yt.st = 1; };
        this.getVideoData = () => ({ video_id: yt.vid }); this.getCurrentTime = () => yt.t; this.getDuration = () => yt.dur;
        this.getPlayerState = () => yt.st; this.playVideo = () => { yt.st = 1; }; this.pauseVideo = () => { yt.st = 2; }; this.stopVideo = () => { yt.st = 5; };
        this.seekTo = s => { yt.t = s; yt.seeks.push(s); }; this.setPlaybackRate = () => {};
        setTimeout(() => o.events.onReady({}), 0);
      } };
    } });
  return { dom, w: dom.window, d: dom.window.document, yt };
}

(async () => {
  // signed out → sign-in form, and the link points back at the studio
  { const db = makeDb(); const { w, d } = makeDom(db, { signedIn: false });
    await sleep(50);
    ok(!!d.querySelector('#signin'), 'signed out: shows the sign-in form');
    d.querySelector('#email').value = 'me@example.com';
    d.querySelector('#signin').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await sleep(20);
    ok(db.otp && db.otp.email === 'me@example.com' && db.otp.options.emailRedirectTo === 'https://sachdq.github.io/jhapat/studio/', 'sends a sign-in link back to the studio');
    ok(d.body.textContent.includes('Link sent'), 'says the link was sent'); }

  // signed in but not on the editor list
  { const db = makeDb(), opts = { signedIn: true, editor: false }; const { w, d } = makeDom(db, opts);
    await sleep(50);
    ok(d.body.textContent.includes('Not an editor yet') && d.body.textContent.includes('u1'), 'non-editor sees their account ID and no tools');
    ok(d.querySelector('#nav').hidden, 'no studio navigation for non-editors');
    const recheck = () => d.querySelector('[data-act="recheck"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    recheck(); await sleep(30);
    ok(d.body.textContent.includes('Not an editor yet') && d.querySelector('#toast').textContent.includes('Still not'), 'Check again: still not an editor says so');
    opts.editor = true; recheck(); await sleep(50); // added to public.editors in the SQL editor meanwhile
    ok(!d.querySelector('#nav').hidden && d.querySelectorAll('.songrow').length === 1, 'Check again: once added, the studio opens without a reload'); }

  // editor
  const db = makeDb(); const { w, d, yt } = makeDom(db, { signedIn: true, editor: true });
  const click = sel => { const el = d.querySelector(sel); if (!el) throw new Error('missing ' + sel); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
  const submit = sel => d.querySelector(sel).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(50);
  ok(d.querySelectorAll('.songrow').length === 1 && d.body.textContent.includes('No lyrics'), 'song list shows the old song flagged No lyrics');
  const VER = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'version.json'), 'utf8')).v;
  ok(!!d.querySelector('.floor .sun') && !!d.querySelector('.dhaka') && !!d.querySelector('.lights') && /color-scheme:dark/.test(html), 'the studio wears the night look: party lights, the Dhaka band and the grid floor');
  ok(!d.querySelector('.garland') && !/garland|marigold/i.test(html), 'and no marigold garland: Nepali culture, nothing religious');
  ok(d.querySelector('#ver').textContent === 'v' + VER && d.querySelector('#update').hidden, 'the version shows next to the logo and matches version.json: v' + VER);
  { const db2 = makeDb(); db2.ver = VER + 1; const { d: d2 } = makeDom(db2, { signedIn: true, editor: true }); await sleep(50);
    ok(!d2.querySelector('#update').hidden && d2.querySelector('#update').textContent.includes('v' + (VER + 1)), 'a newer version on the site offers a reload'); }
  ok(d.querySelector('.songrow .thumb img').getAttribute('src') === 'https://i.ytimg.com/vi/AAAAAAAAAAA/mqdefault.jpg' && d.querySelector('.songrow .its').textContent.includes('Paani1'),
    'a song row shows its upload’s cover and its items with counts');

  // add a song from LRCLIB
  w.location.hash = '#add'; await sleep(20);
  d.querySelector('#addQ').value = 'test rain'; submit('#addSearch'); await sleep(30);
  ok(d.querySelectorAll('.res').length === 1, 'LRCLIB search lists the result');
  click('[data-act="create"][data-arg="555"]'); await sleep(80);
  const song = db.songs.find(s => s.id === 'test-rain');
  ok(song && song.lines.length === 8 && song.lrclib_id === 555 && song.duration === 42, 'creates the song with its 8 timed lines');
  ok(w.location.hash === '#song:test-rain' && !!d.querySelector('.lines'), 'opens it in the editor with the lyric list');
  const words = [...d.querySelectorAll('.w')].map(b => b.textContent);
  ok(words.join(',') === 'चिठी,पानी', 'item words light up once each (repeats folded): ' + words.join(','));
  ok(d.querySelector('.rep') && d.querySelector('.rep').textContent === '×3', 'the repeated line shows ×3');
  const onlyLit = on => { const el = d.querySelector('#onlyLit'); el.checked = on; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  onlyLit(true); await sleep(5);
  ok(d.querySelectorAll('.ln').length === 2 && d.body.textContent.includes('3 lines without item words hidden') && JSON.parse(w.localStorage.getItem('jhapat.studio')).onlyLit === true,
    'Only lines with item words hides the other lines, and is remembered: ' + d.querySelectorAll('.ln').length);
  onlyLit(false); await sleep(5);
  ok(d.querySelectorAll('.ln').length === 5, 'and back to every line');

  // add an upload; same length as the lyrics → marked synced
  d.querySelector('#vidLink').value = 'https://youtu.be/BBBBBBBBBBB'; submit('#addVid'); await sleep(30);
  w.onYouTubeIframeAPIReady(); await sleep(2700);
  const vid = db.videos.find(v => v.song_id === 'test-rain');
  ok(vid && vid.yt === 'BBBBBBBBBBB' && yt.vid === 'BBBBBBBBBBB', 'upload added and loaded');
  ok(vid.synced === true && vid.duration === 42, 'same length as the lyrics → marked synced');

  // tag the chorus word → three tags, estimated from line timing
  const pw = [...d.querySelectorAll('.w')].find(b => b.textContent === 'पानी');
  pw.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await sleep(30);
  let tags = db.tags.filter(t => t.song_id === 'test-rain');
  ok(tags.length === 3 && tags.every(t => t.item_id === 'paani' && t.source === 'estimate'), 'one click tags पानी in all three repeats');
  ok(JSON.stringify(tags.map(t => t.t).sort((a, b) => a - b)) === '[18,26,34]', 'estimates sit at each repeat’s start (word 0): ' + tags.map(t => t.t));
  ok(db.songs.find(s => s.id === 'test-rain').status === 'tagged', 'song moves from draft to tagged');
  ok(!!d.querySelector('.selbar') && d.querySelector('.selbar').textContent.includes('copies to all 3 repeats'), 'selected-word bar says it copies to the repeats');

  // hear, then tap as it's sung: 0.6 s into the line plus the 0.25 s reaction delay
  click('[data-act="hear"][data-arg="2"]');
  ok(Math.abs(yt.seeks.slice(-1)[0] - 15) < 0.01, 'Hear plays from 3 s before the line');
  yt.t = 16.75; click('[data-act="tapnow"]'); await sleep(30); // during Hear's run-up, while the line before is still playing
  tags = db.tags.filter(t => t.song_id === 'test-rain').sort((a, b) => a.t - b.t);
  ok(JSON.stringify(tags.map(t => t.t)) === '[18,26,34]' && tags.every(t => t.source === 'estimate') && d.querySelector('#toast').textContent.includes('Nothing changed'),
    'a tap before the line starts is refused instead of shifting every repeat: ' + tags.map(t => t.t));
  yt.t = 31.0; click('[data-act="tapnow"]'); await sleep(30); // the instrumental gap after the second repeat
  ok(db.tags.filter(t => t.song_id === 'test-rain').every(t => t.source === 'estimate'), 'a tap well after a repeat ends is refused too');
  yt.t = 18.85; click('[data-act="tapnow"]'); await sleep(30);
  tags = db.tags.filter(t => t.song_id === 'test-rain').sort((a, b) => a.t - b.t);
  ok(JSON.stringify(tags.map(t => t.t)) === '[18.6,26.6,34.6]' && tags.every(t => t.source === 'tap'), 'tap times the word and copies the same position to every repeat: ' + tags.map(t => t.t));
  click('[data-act="nudge"][data-arg="0.1"]'); await sleep(30);
  tags = db.tags.filter(t => t.song_id === 'test-rain').sort((a, b) => a.t - b.t);
  ok(JSON.stringify(tags.map(t => t.t)) === '[18.7,26.7,34.7]', 'nudge moves all three: ' + tags.map(t => t.t));

  // keyboard: down arrow moves to the next lit line
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); await sleep(10);
  ok(d.querySelector('.selbar') === null || d.querySelector('.w.picked'), 'arrow keys move the pick between lit lines');

  // tag चिठी then remove it from the bar
  const cw = [...d.querySelectorAll('.w')].find(b => b.textContent === 'चिठी');
  cw.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await sleep(30);
  ok(db.tags.some(t => t.song_id === 'test-rain' && t.item_id === 'chithi'), 'tags चिठी');
  click('[data-act="untag"]'); await sleep(30);
  ok(!db.tags.some(t => t.song_id === 'test-rain' && t.item_id === 'chithi'), 'Remove tag deletes it');

  // sync an upload on the first line
  click('[data-act="sync"][data-arg="0"]'); await sleep(1700);
  ok(d.querySelector('[data-act="synctap"]'), 'sync asks for a tap when the line starts');
  yt.t = 11.75; click('[data-act="synctap"]'); await sleep(30);
  ok(Math.abs(db.videos.find(v => v.yt === 'BBBBBBBBBBB').offset_s - 1.5) < 0.001, 'sync sets the offset: line at 10.00, tapped at 11.75 → +1.50 s');

  // playlist membership, status
  const box = d.querySelector('[data-pl="party-mix"]'); box.checked = true; box.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(30);
  ok(db.playlist_songs.some(x => x.song_id === 'test-rain' && x.position === 1), 'adds the song to the playlist');
  ok(d.querySelector('#sidePanel [data-arg="songpl"]').getAttribute('aria-expanded') === 'false' && d.querySelector('#sidePanel [data-arg="songpl"] .fs').textContent === 'In Nepali Party Mix',
    'the Playlists card is folded and says where the song is');
  ok(d.querySelector('#sidePanel [data-arg="uploads"]').getAttribute('aria-expanded') === 'false' && d.querySelector('#sidePanel [data-arg="uploads"] .fs').textContent === '1 · synced',
    'with its upload synced, Uploads folds itself away');
  click('#sidePanel [data-arg="uploads"]'); await sleep(5);
  ok(!d.querySelector('#sidePanel [data-arg="uploads"] + .foldbody').hidden && JSON.parse(w.localStorage.getItem('jhapat.studio')).fold.uploads === false, 'opening it is remembered');
  click('[data-act="status"][data-arg="checked"]'); await sleep(30);
  ok(db.songs.find(s => s.id === 'test-rain').status === 'checked', 'Mark checked saves');

  // old song: attach lyrics → its estimate tag lands on a line
  db.delay = 60; w.location.hash = '#song:old'; await sleep(20); // a slow connection: the next song is still opening
  ok(d.querySelector('#sidePanel').innerHTML === '' && !d.querySelector('[data-pl]') && d.querySelector('#view').textContent.includes('Opening'),
    'while the next song opens, the last song’s panel is gone (its playlist boxes can’t act on the wrong song)');
  await sleep(150); db.delay = 0;
  ok(d.querySelector('[data-pl="party-mix"]') && d.querySelector('[data-pl="party-mix"]').checked && d.querySelector('h1').textContent === 'Old Song', 'then the new song’s own panel shows');
  ok(!!d.querySelector('#lrcForm'), 'a song without lyrics offers the LRCLIB search');
  submit('#lrcForm'); await sleep(30); click('[data-act="uselrc"][data-arg="555"]'); await sleep(60);
  ok(db.songs.find(s => s.id === 'old').lines.length === 8 && !!d.querySelector('.lines'), 'lyrics attach to an existing song');
  ok(d.querySelectorAll('.w.auto').length === 1 && d.querySelectorAll('.w.tagged').length === 0, 'its existing tag (paani at 0:30) shows on the matching word, marked as estimated');
  const t1 = db.tags.find(t => t.id === 1);
  ok(t1.line === 4 && t1.word === 0 && t1.rep === 2, 'attaching lyrics records that tag’s line, word and repeat group (first line of the chorus): ' + [t1.line, t1.word, t1.rep]);
  ok(d.querySelector('.newbar') && d.querySelector('.newbar').textContent.includes('3 item words not tagged yet') && d.querySelectorAll('.w:not(.auto):not(.tagged)').length === 1,
    'untagged item words are marked as new (dashed); the bar counts every repeat');
  click('[data-act="autotag"]'); await sleep(40);
  const oldTags = db.tags.filter(t => t.song_id === 'old').sort((a, b) => a.t - b.t);
  ok(oldTags.length === 4 && oldTags.filter(t => t.id !== 1).every(t => t.source === 'estimate' && t.rep === (t.item_id === 'paani' ? 2 : 0)) && t1.t === 30,
    'Auto-tag adds the 3 missing words with their repeat groups and leaves the existing tag alone: ' + oldTags.map(t => t.item_id + '@' + t.t + '/' + t.rep).join(' '));
  ok(!d.querySelector('.newbar') && db.songs.find(s => s.id === 'old').status === 'tagged', 'nothing left to tag; a tagged song stays tagged');

  // Drop points: each item's first clean mention, with nothing else on the table and with everything on it; a chorus once
  const dpWords = [...d.querySelectorAll('.lines .w.dp')];
  ok(dpWords.length === 2 && dpWords.map(b => b.textContent).join(',') === 'चिठी,पानी' && dpWords.every(b => /drops in here/.test(b.title)),
    'the lyrics mark the drop points (चिठी, and the chorus’s पानी once): ' + dpWords.map(b => b.textContent).join(','));
  // Check tags: one stop per drop point, each heard from 3 s before
  const ch = db.tags.find(t => t.song_id === 'old' && t.item_id === 'chithi'), ch0 = ch.t;
  const pa0 = db.tags.filter(t => t.song_id === 'old' && t.item_id === 'paani').sort((a, b) => a.t - b.t)[0].t;
  click('[data-act="chkstart"]'); await sleep(20);
  ok(Math.abs(yt.seeks.slice(-1)[0] - (ch0 - 3)) < 0.01 && d.querySelector('.selbar.check').textContent.includes('1 / 2'), 'Check tags starts 3 s before the first word (चिठी at ' + ch0 + '), 1 of 2 stops');
  click('[data-act="chknudge"][data-arg="-0.1"]'); await sleep(40);
  ok(Math.abs(ch.t - (ch0 - 0.1)) < 0.001 && ch.source === 'nudge' && Math.abs(yt.seeks.slice(-1)[0] - (ch0 - 3.1)) < 0.01, 'Earlier moves it 0.1 s and plays it again from 3 s before');
  click('[data-act="chkok"]'); await sleep(40);
  ok(ch.checked === true && Math.abs(yt.seeks.slice(-1)[0] - (pa0 - 3)) < 0.01, 'Right marks it checked and moves on: the chorus plays from 3 s before its first drop point (' + pa0 + '; with चिठी on the table the game uses 0:30, the same repeat group)');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(40);
  ok(db.tags.filter(t => t.song_id === 'old' && t.item_id === 'paani').every(t => t.checked) && d.querySelector('.selbar.check').textContent.includes('All 2 drop points checked') &&
    !!d.querySelector('.selbar.check [data-act="status"][data-arg="checked"]'), 'Enter marks every repeat checked; at the end it offers Mark song checked');
  click('[data-act="chkstop"]'); await sleep(10);
  ok(!d.querySelector('.selbar.check'), 'Done leaves Check tags');

  // removing an upload asks first (on a phone, Remove sat right next to Sync)
  const hasOld = () => db.videos.some(v => v.yt === 'AAAAAAAAAAA');
  click('[data-act="rmvid"]'); await sleep(20);
  ok(hasOld() && !!d.querySelector('[data-act="rmvidyes"]') && d.querySelector('#sidePanel').textContent.includes('only upload'), 'Remove asks first, and warns when it’s the song’s only upload');
  click('[data-act="rmvidno"]'); await sleep(20);
  ok(hasOld() && !d.querySelector('[data-act="rmvidyes"]') && !!d.querySelector('[data-act="rmvid"]'), 'Keep leaves the upload alone');
  click('[data-act="rmvid"]'); await sleep(20); click('[data-act="rmvidyes"]'); await sleep(30);
  ok(!hasOld() && d.querySelector('#sidePanel').textContent.includes('No upload yet') && d.querySelector('#toast').textContent.includes('Add another'), 'confirming removes it and says to add another');

  // untimed lyrics only (invented): shown with item words marked above the tap-along buttons
  db.songs.push({ id: 'plain', title: 'Plain Song', artist: null, status: 'draft', lrclib_id: 9, duration: 42, notes: null, lines: null,
    plain_lyrics: 'पानी पर्यो आज\nहावा चल्यो\nपानीमा चिठी बग्यो' });
  db.videos.push({ id: 77, song_id: 'plain', yt: 'PPPPPPPPPPP', kind: 'official', duration: 42, offset_s: 0, synced: false, embeddable: true, rank: 0 });
  w.location.hash = '#song:plain'; await sleep(80);
  const marks = [...d.querySelectorAll('#plain mark')].map(m => m.textContent);
  ok(marks.join(',') === 'पानी,पानीमा,चिठी' && d.querySelector('#plain .dim') && d.querySelector('#plain').textContent.includes('हावा चल्यो'),
    'untimed lyrics show with item words marked: ' + marks.join(','));
  ok(d.body.textContent.includes('3 item words on 2 lines') && !!d.querySelector('.tapgrid'), 'it counts them and keeps the tap-along buttons');

  // items: tiles with how many songs use each; one opens in the editor above them
  w.location.hash = '#items'; await sleep(20);
  ok(d.querySelectorAll('.itile').length === 2 && !d.querySelector('#itemEd') && d.querySelector('[data-act="edititem"][data-arg="paani"]').textContent.includes('2 songs'),
    'items show as tiles with their song counts, and no editor open');
  click('[data-act="edititem"][data-arg="paani"]'); await sleep(10);
  d.querySelector('#itemEd [data-f="words"]').value = 'paani, pani\nपानी, पानि'; submit('#itemEd'); await sleep(20);
  ok(db.items.find(i => i.id === 'paani').words.length === 4, 'item spellings save (commas or new lines)');

  // an emoji, and a spelling that rules words out
  d.querySelector('#itemEd [data-f="emoji"]').value = '💧'; d.querySelector('#itemEd [data-f="words"]').value = 'paani, pani, पानी, -पानीमा';
  submit('#itemEd'); await sleep(20);
  ok(db.items.find(i => i.id === 'paani').emoji === '💧' && d.querySelector('.itile.on').textContent.includes('💧'), 'an item’s emoji saves and shows on its tile');
  click('[data-act="newitem"]'); await sleep(10);
  d.querySelector('#itemEd [data-f="name"]').value = 'Rumal'; d.querySelector('#itemEd [data-f="words"]').value = 'rumal, रुमाल'; submit('#itemEd'); await sleep(20);
  ok(db.items.some(i => i.id === 'rumal' && i.words.length === 2) && d.querySelectorAll('.itile').length === 3, 'New item, at the top of the page, adds one');
  const iq = d.querySelector('#itemQ'); iq.value = 'रुमाल'; iq.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(5);
  ok(d.querySelectorAll('.itile').length === 1 && d.querySelector('#itemQ') === iq, 'search finds an item by its spelling, without redrawing the search box');
  iq.value = ''; iq.dispatchEvent(new w.Event('input', { bubbles: true })); click('[data-act="closeitem"]'); await sleep(5);
  w.location.hash = '#song:plain'; await sleep(80);
  ok([...d.querySelectorAll('#plain mark')].map(m => m.textContent).join(',') === 'पानी,चिठी' && d.querySelector('.tapgrid').textContent.includes('💧 Paani'),
    '“-पानीमा” stops पानीमा counting; the emoji shows on the item');

  // timing untimed lyrics line by line: the taps become timed lines, Again repeats a line, every item word gets tagged
  const key = k => d.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
  const tapFold = d.querySelector('[data-act="fold"][data-arg="tapalong"]');
  ok(!!d.querySelector('[data-act="tstart"]') && !!tapFold && tapFold.parentNode.querySelector('.foldbody').hidden && !!tapFold.parentNode.querySelector('.tapgrid'), 'untimed lyrics offer Time the lines, with item-by-item tap-along folded away');
  click('[data-act="tstart"]'); await sleep(20);
  ok(d.querySelector('.tnext').textContent.includes('पानी पर्यो') && d.querySelector('.tnext mark') && yt.st === 1 && d.querySelector('#plain .cur'), 'Time the lines plays the upload and shows the first line, its item word marked');
  yt.t = 10.25; key('T'); await sleep(5);
  yt.t = 14.25; key('a'); await sleep(5); // the first line is sung twice but written once
  yt.t = 13; click('[data-act="tline"]'); await sleep(5);
  ok(d.querySelector('#toast').textContent.includes('before the last line'), 'a tap earlier than the last one is refused');
  key('s'); await sleep(5); // the second line isn't sung
  yt.t = 21.25; click('[data-act="tline"]'); await sleep(5); key('Backspace'); await sleep(5);
  ok(d.querySelector('.tnext').textContent.includes('चिठी') && d.querySelector('#plain .skip').textContent.includes('हावा'), 'Skip and Undo step through the lines');
  yt.t = 23.25; click('[data-act="tline"]'); await sleep(5);
  ok(d.querySelector('[data-act="tline"]').disabled && d.querySelector('.selbar').textContent.includes('All 3 lines done'), 'after the last line, Line is done and Save is next');
  click('[data-act="tsave"]'); await sleep(60);
  const ps = db.songs.find(x => x.id === 'plain'), ptags = db.tags.filter(t => t.song_id === 'plain');
  ok(ps.lines.map(l => l.t + ' ' + l.x).join(' / ') === '10 पानी पर्यो आज / 14 पानी पर्यो आज / 23 पानीमा चिठी बग्यो' && ps.duration === 42, 'the taps (less the reaction delay) become timed lines: ' + ps.lines.map(l => l.t).join(', '));
  ok(ptags.length === 3 && ptags.filter(t => t.item_id === 'paani').every(t => t.rep === 0 && t.source === 'estimate') && ptags.some(t => t.item_id === 'chithi' && t.line === 2),
    'every item word is tagged, and the line sung twice is one repeat group: ' + ptags.map(t => t.item_id + '@' + t.t + ' rep ' + t.rep).join(', '));
  ok(ps.status === 'auto' && db.videos.find(v => v.id === 77).synced === true && !!d.querySelector('.lines .ln'), 'the draft goes live as auto, its upload counts as synced, and the lyrics show as timed');

  // playlists page lists both songs in order
  w.location.hash = '#playlists'; await sleep(20);
  ok(d.querySelectorAll('[data-plid="party-mix"] .songs .row').length === 2, 'playlist page lists its songs');
  ok(d.querySelector('[data-plid="party-mix"] .foldbody').hidden && !!d.querySelector('[data-plid="party-mix"] .fan .thumb img'), 'playlists start folded, with song covers on the card');
  click('[data-plid="party-mix"] .foldhead'); await sleep(5);
  ok(!d.querySelector('[data-plid="party-mix"] .foldbody').hidden, 'clicking one opens it');
  click('[data-act="plrm"][data-arg="party-mix:old"]'); await sleep(20);
  ok(!db.playlist_songs.some(x => x.playlist_id === 'party-mix' && x.song_id === 'old') && db.songs.some(x => x.id === 'old') && !d.querySelector('[data-plid="party-mix"] .foldbody').hidden,
    '✕ takes a song out of the playlist; the song stays and the card stays open');
  const pa = d.querySelector('[data-pladd="party-mix"]'); pa.value = 'old so'; pa.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(5);
  ok(d.querySelectorAll('[data-plres="party-mix"] [data-act="pladd"]').length === 1, 'typing in Add a song lists matching songs not in it');
  click('[data-act="pladd"][data-arg="party-mix:old"]'); await sleep(20);
  ok(db.playlist_songs.some(x => x.playlist_id === 'party-mix' && x.song_id === 'old' && x.position === 2), 'Add puts it back, at the end');

  // add many songs: lengths measured, lyrics of the same length picked, auto-tagged
  w.location.hash = '#import'; await sleep(20);
  const ta = d.querySelector('#impText');
  ta.value = ['Rain Again - Band A | https://youtu.be/DDDDDDDDDDD', 'Long Cut - Band B | EEEEEEEEEEE', 'Nothing Song - Band C', 'Old Song - Someone | FFFFFFFFFFF | 3:20', 'Busy Song - Band D | GGGGGGGGGGG | 3:00'].join('\n');
  const busyFetch = w.fetch; w.fetch = async url => (/Busy Song/.test(decodeURIComponent(url)) ? { ok: false, status: 429, json: async () => ({ statusCode: 429 }) } : busyFetch(url)); // LRCLIB stays busy for this one
  ta.dispatchEvent(new w.Event('input', { bubbles: true }));
  const pl = d.querySelector('#impPl'); pl.value = 'party-mix'; pl.dispatchEvent(new w.Event('change', { bubbles: true }));
  click('[data-act="impfind"]'); await sleep(1600);
  const rowsT = [...d.querySelectorAll('.res.imp')].map(r => r.textContent);
  ok(rowsT.length === 5 && rowsT[0].includes('0:42') && rowsT[0].includes('same length') && rowsT[0].includes('goes live as auto'), 'a measured upload with lyrics of the same length will go live as auto');
  ok(rowsT[1].includes('1:39') && rowsT[1].includes('differ by 57 s') && db.busyOnce, 'one whose lengths differ comes in as a draft to sync (LRCLIB said “too many requests” once, so it waited and asked again)');
  ok(rowsT[4].includes('LRCLIB was busy') && d.querySelector('[data-act="impadd"]').textContent === 'Add 3 songs' && d.querySelector('[data-act="impfind"]').textContent === 'Find again',
    'a song LRCLIB stays busy for is marked, left out of Add (not added as a draft), and Find becomes Find again');
  ok(rowsT[2].includes('Not on LRCLIB') && rowsT[2].includes('tap-along'), 'one not on LRCLIB comes in as a draft for tap-along: ' + rowsT[2]);
  ok(rowsT[3].includes('Already in the studio'), 'one already in the studio is skipped');
  click('[data-act="impadd"]'); await sleep(200);
  const ra = db.songs.find(s => s.id === 'rain-again'), rv = db.videos.find(v => v.song_id === 'rain-again'), rt = db.tags.filter(t => t.song_id === 'rain-again');
  ok(ra && ra.status === 'auto' && ra.lrclib_id === 555 && rv.synced === true && rv.duration === 42, 'added: lyrics attached, upload synced, live as auto');
  ok(rt.length === 4 && rt.every(t => t.source === 'estimate' && t.rep != null) && rt.filter(t => t.item_id === 'paani').every(t => t.rep === 2), 'every item word tagged, the chorus as one repeat group');
  const lc = db.songs.find(s => s.id === 'long-cut'), ns = db.songs.find(s => s.id === 'nothing-song');
  ok(lc.status === 'draft' && db.videos.find(v => v.song_id === 'long-cut').synced === false && ns.status === 'draft' && !db.videos.some(v => v.song_id === 'nothing-song'), 'the others are drafts');
  ok(['rain-again', 'long-cut', 'nothing-song'].every(id => db.playlist_songs.some(x => x.playlist_id === 'party-mix' && x.song_id === id)) && db.songs.filter(s => s.id.startsWith('old')).length === 1,
    'all three join the chosen playlist; nothing is duplicated');
  ok(!db.songs.some(s => s.id === 'busy-song'), 'the song LRCLIB never answered for wasn’t added');
  w.fetch = busyFetch; const calls = db.lrcCalls;
  click('[data-act="impfind"]'); await sleep(300);
  const again = [...d.querySelectorAll('.res.imp')].map(r => r.textContent);
  ok(db.lrcCalls === calls + 1 && again[4].includes('differ by 138 s') && again[0].includes('Added as auto'), 'Find again looks up only that song; the added ones stay as they were: ' + (db.lrcCalls - calls) + ' search');

  // a line can name the exact LRCLIB version: it's fetched by id, not searched for
  w.location.hash = '#import'; await sleep(20);
  const ta2 = d.querySelector('#impText'); ta2.value = 'Exact One - Band E | https://youtu.be/HHHHHHHHHHH | 0:42 | lrclib:777'; ta2.dispatchEvent(new w.Event('input', { bubbles: true }));
  const urls = db.lrcUrls.length; click('[data-act="impfind"]'); await sleep(200);
  ok(db.lrcUrls.slice(urls).join() === 'https://lrclib.net/api/get/777' && d.querySelector('.res.imp').textContent.includes('goes live as auto'), 'lrclib:777 fetches that version by id (one request, no search)');
  click('[data-act="impadd"]'); await sleep(150);
  ok(db.songs.some(x => x.id === 'exact-one' && x.lrclib_id === 777 && x.status === 'auto'), 'and adds it as auto');

  // Auto-tag all songs (Items page): only words without a tag; existing tags stay put
  const before = db.tags.length, kept = JSON.stringify(db.tags.map(t => [t.id, t.t]));
  w.location.hash = '#items'; await sleep(20);
  click('[data-act="autoall"]'); await sleep(300);
  const newOnes = db.tags.slice(before);
  ok(newOnes.length === 1 && newOnes[0].song_id === 'test-rain' && newOnes[0].item_id === 'chithi' && newOnes[0].rep === 0 && d.querySelector('#autoAllMsg').textContent.includes('Done'),
    'Auto-tag all songs adds only the word nobody tagged (test-rain’s चिठी): ' + newOnes.map(t => t.song_id + ':' + t.item_id).join(' '));
  ok(JSON.stringify(db.tags.slice(0, before).map(t => [t.id, t.t])) === kept, 'and moves no existing tag');

  // song list: covers, filters, sort and search
  w.location.hash = '#'; await sleep(20);
  const rowsNow = () => [...d.querySelectorAll('.songrow')].map(r => r.dataset.arg).join();
  ok(d.querySelector('.songrow[data-arg="rain-again"] .thumb img').getAttribute('src') === 'https://i.ytimg.com/vi/DDDDDDDDDDD/mqdefault.jpg', 'rows show their upload’s cover');
  ok(!d.querySelector('.songrow[data-arg="nothing-song"] img') && d.querySelector('.songrow[data-arg="nothing-song"]').textContent.includes('No upload'), 'a song without an upload gets a plain tile and a No upload flag');
  click('[data-act="show"][data-arg="draft"]'); await sleep(5);
  ok(rowsNow() === 'long-cut,nothing-song' && d.querySelector('[data-act="show"][data-arg="draft"]').textContent.includes('2'), 'Drafts shows only the drafts, with a count: ' + rowsNow());
  click('[data-act="show"][data-arg="all"]'); await sleep(5);
  const so = d.querySelector('#ssort'); so.value = 'status'; so.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(5);
  ok(rowsNow() === 'long-cut,nothing-song,exact-one,rain-again,old,test-rain' && JSON.parse(w.localStorage.getItem('jhapat.studio')).sort === 'status',
    'By status puts drafts first and checked last, and is remembered: ' + rowsNow());
  const fi = d.querySelector('#filter'); fi.value = 'rain'; fi.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(5);
  ok(rowsNow() === 'rain-again,test-rain' && d.querySelector('#filter') === fi, 'search narrows the list without redrawing the search box');
  fi.value = ''; fi.dispatchEvent(new w.Event('input', { bubbles: true }));
  const sp = d.querySelector('#spl'); sp.value = '-'; sp.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(5);
  ok(!d.querySelector('.songrow') && !!d.querySelector('[data-act="clearf"]'), 'In no playlist: every song is in one here, so it says none match');
  click('[data-act="clearf"]'); await sleep(5);
  ok(d.querySelectorAll('.songrow').length === 6, 'Show every song clears the filters');

  // a long item list shows twelve, then the rest on request
  // a draft whose timed lyrics come from another recording: time the lines again on its own upload
  w.location.hash = '#song:long-cut'; await sleep(80);
  const oldEst = db.tags.filter(t => t.song_id === 'long-cut').map(t => t.id);
  ok(oldEst.length === 4 && !!d.querySelector('.newbar [data-act="tstart"]'), 'a draft with timed lyrics offers Time the lines again');
  click('.newbar [data-act="tstart"]'); await sleep(20);
  ok(d.body.textContent.includes('Lyrics, timing again') && d.querySelectorAll('#plain > div').length === 7, 'it lists the 7 sung lines (the instrumental gap left out)');
  for (let k = 0; k < 7; k++) { yt.t = 20.25 + 4 * k; click('[data-act="tline"]'); await sleep(2); }
  click('[data-act="tsave"]'); await sleep(80);
  const lc2 = db.songs.find(x => x.id === 'long-cut'), lt = db.tags.filter(t => t.song_id === 'long-cut');
  ok(lc2.lines.length === 7 && lc2.lines[0].t === 20 && lc2.lines[6].t === 44 && lt.length === 4 && !lt.some(t => oldEst.includes(t.id)) && lt.find(t => t.item_id === 'chithi').t >= 20,
    'the new times replace the old lines, and the old estimates give way to new ones: ' + lt.map(t => t.item_id + '@' + t.t).join(', '));
  ok(lc2.status === 'auto' && db.videos.find(v => v.song_id === 'long-cut').synced === true, 'the draft goes live as auto on that upload');

  { const db4 = makeDb(); db4.maxRows = 2; for (let k = 0; k < 4; k++) db4.songs.push({ id: 'p' + k, title: 'Page Song ' + k, artist: 'X', status: 'auto', lrclib_id: null, duration: 100, notes: null, lines: null });
    const { w: w4, d: d4 } = makeDom(db4, { signedIn: true, editor: true }); await sleep(80);
    ok(d4.querySelectorAll('.songrow').length === 5, 'songs load in pages, so a list longer than one page (Supabase sends 1,000 rows at most) still shows them all: ' + d4.querySelectorAll('.songrow').length); }

  { const db3 = makeDb(); for (let k = 0; k < 18; k++) db3.items.push({ id: 'x' + k, name: 'Thing ' + k, dev: '', words: ['thing' + k], note: null, sort: 2 + k });
    const { w: w3, d: d3 } = makeDom(db3, { signedIn: true, editor: true }); await sleep(50);
    w3.location.hash = '#items'; await sleep(20);
    ok(d3.querySelectorAll('.itile').length === 12 && d3.querySelector('[data-act="itemsall"]').textContent === 'Show all 20', 'twenty items show twelve, then “Show all 20”');
    d3.querySelector('[data-act="itemsall"]').dispatchEvent(new w3.MouseEvent('click', { bubbles: true })); await sleep(5);
    ok(d3.querySelectorAll('.itile').length === 20, 'Show all shows every one');
    const q3 = d3.querySelector('#itemQ'); q3.value = 'Thing 1'; q3.dispatchEvent(new w3.Event('input', { bubbles: true })); await sleep(5);
    ok(d3.querySelectorAll('.itile').length === 9, 'search looks through all of them: ' + d3.querySelectorAll('.itile').length); }

  // v45: how easy each item's prop is to find at home, and Re-order: the player's order over all public songs (drafts don't count)
  { const db7 = makeDb(); db7.items[0].ease = 4; db7.items[1].ease = 5; // paani: in one public song and four drafts; chithi: in one public song
    db7.songs.push({ id: 'c1', title: 'Chithi Song', artist: 'X', status: 'auto', lrclib_id: null, duration: 100, notes: null, lines: null });
    db7.tags.push({ id: 70, song_id: 'c1', item_id: 'chithi', t: 30, line: null, word: null, source: 'estimate', checked: false });
    for (let k = 0; k < 4; k++) { db7.songs.push({ id: 'dr' + k, title: 'Draft ' + k, artist: 'X', status: 'draft', lrclib_id: null, duration: 100, notes: null, lines: null });
      db7.tags.push({ id: 71 + k, song_id: 'dr' + k, item_id: 'paani', t: 30, line: null, word: null, source: 'estimate', checked: false }); }
    const { w: w7, d: d7 } = makeDom(db7, { signedIn: true, editor: true }); await sleep(80);
    const c7 = sel => d7.querySelector(sel).dispatchEvent(new w7.MouseEvent('click', { bubbles: true }));
    w7.location.hash = '#items'; await sleep(20);
    c7('[data-act="reorder"]'); await sleep(40);
    ok(db7.items.find(i => i.id === 'chithi').sort === 0 && db7.items.find(i => i.id === 'paani').sort === 1 && d7.querySelector('.itile').dataset.arg === 'chithi' && /Re-ordered 2 items/.test(d7.querySelector('#toast').textContent),
      'Re-order puts the easier find first when the public songs are even (drafts don’t count): ' + db7.items.map(i => i.id + ':' + i.sort).join(' '));
    c7('[data-act="edititem"][data-arg="chithi"]'); await sleep(10);
    const es = d7.querySelector('#itemEd [data-f="ease"]');
    ok(!!es && es.value === '5' && /every home/i.test(es.options[es.selectedIndex].textContent), 'the editor shows how easy its prop is to find at home: ' + (es && es.options[es.selectedIndex].textContent));
    es.value = '1'; d7.querySelector('#itemEd').dispatchEvent(new w7.Event('submit', { bubbles: true, cancelable: true })); await sleep(60);
    ok(db7.items.find(i => i.id === 'chithi').ease === 1 && db7.items.find(i => i.id === 'paani').sort === 0 && d7.querySelector('.itile').dataset.arg === 'paani',
      'a new ease saves and moves the item: Chithi, now hard to find, goes after Paani: ' + db7.items.map(i => i.id + ':' + i.sort + '/' + i.ease).join(' '));
    // v47, v48: a starter (on when a phone first opens Jhapat) leads whatever its songs and ease; pinned ones come right after
    if (!d7.querySelector('#itemEd[data-item="chithi"]')) { c7('[data-act="edititem"][data-arg="chithi"]'); await sleep(10); } // still open after the save
    const sc7 = d7.querySelector('#itemEd [data-f="default_on"]'), sp7 = d7.querySelector('#itemEd [data-f="pin"]');
    ok(!!sc7 && !sc7.checked && /Starter/.test(sc7.parentNode.textContent) && !!sp7 && sp7.value === '', 'the editor has Starter (off) and Pinned to the top (no) for this one');
    sc7.checked = true; d7.querySelector('#itemEd').dispatchEvent(new w7.Event('submit', { bubbles: true, cancelable: true })); await sleep(60);
    ok(db7.items.find(i => i.id === 'chithi').default_on === true && db7.items.find(i => i.id === 'chithi').sort === 0 && d7.querySelector('.itile').dataset.arg === 'chithi',
      'a starter saves and leads the list though its prop is hard to find: ' + db7.items.map(i => i.id + ':' + i.sort + '/' + i.default_on).join(' '));
    c7('[data-act="edititem"][data-arg="paani"]'); await sleep(10);
    d7.querySelector('#itemEd [data-f="pin"]').value = '1'; d7.querySelector('#itemEd').dispatchEvent(new w7.Event('submit', { bubbles: true, cancelable: true })); await sleep(60);
    ok(db7.items.find(i => i.id === 'paani').pin === 1 && db7.items.find(i => i.id === 'paani').sort === 1 && db7.items.find(i => i.id === 'chithi').sort === 0,
      'a pinned item comes right after the starters: ' + db7.items.map(i => i.id + ':' + i.sort + '/' + i.pin).join(' '));
    c7('[data-act="edititem"][data-arg="chithi"]'); await sleep(10);
    ok(d7.querySelector('#itemEd [data-f="default_on"]').checked, 'and the editor shows Chithi as a starter'); }

  // v41: words compare as they're read (बाटाे is बाटो, फ़ोन is फोन), and Auto-tag all takes estimates off words a spelling
  // now rules out, while a tag timed by hand stays. Invented lines.
  { const db6 = makeDb();
    db6.items[0].words = ['paani', 'पानी', '-पानीपुरी'];
    db6.items.push({ id: 'bato', name: 'Bato', dev: 'बाटो', words: ['बाटो'], note: null, sort: 2 }, { id: 'phone', name: 'Phone', dev: 'फोन', words: ['फोन'], note: null, sort: 3 });
    db6.songs.push({ id: 'nm-song', title: 'Norm Song', artist: 'Test', status: 'auto', lrclib_id: null, duration: 60, notes: null,
      lines: [[10, 'यो बाटाे लामो'], [20, 'पानीपुरी खाऊँ'], [30, 'पानीपुरी फेरि'], [40, 'पानी पर्यो फ़ोन आयो']].map(([t, x]) => ({ t, x })) });
    db6.videos.push({ id: 60, song_id: 'nm-song', yt: 'GGGGGGGGGGG', kind: 'official', duration: 60, offset_s: 0, synced: true, embeddable: true, rank: 0 });
    db6.tags.push({ id: 601, song_id: 'nm-song', item_id: 'paani', t: 20, line: 1, word: 0, rep: 1, source: 'estimate', checked: false },
      { id: 602, song_id: 'nm-song', item_id: 'paani', t: 30.2, line: 2, word: 0, rep: 2, source: 'tap', checked: true },
      { id: 603, song_id: 'nm-song', item_id: 'paani', t: 40, line: 3, word: 0, rep: 3, source: 'estimate', checked: false });
    const { w: w6, d: d6 } = makeDom(db6, { signedIn: true, editor: true }); await sleep(80);
    w6.__retryGap = 5; db6.dropNext = (table, st) => table === 'songs' && st.single; // the first song's request fails once
    w6.location.hash = '#items'; await sleep(20);
    d6.querySelector('[data-act="autoall"]').dispatchEvent(new w6.MouseEvent('click', { bubbles: true })); await sleep(200);
    const mine = db6.tags.filter(t => t.song_id === 'nm-song');
    ok(!mine.some(t => t.id === 601) && mine.some(t => t.id === 602) && mine.some(t => t.id === 603),
      'Auto-tag all takes the estimate off पानीपुरी (ruled out) and keeps the one timed by hand: ' + mine.map(t => t.id + ':' + t.item_id + '@' + t.line).join(' '));
    ok(mine.some(t => t.item_id === 'bato' && t.line === 0 && t.word === 1) && mine.some(t => t.item_id === 'phone' && t.line === 3 && t.word === 2),
      'बाटाे counts as बाटो and फ़ोन as फोन');
    ok(/1 estimate taken off words that no longer count/.test(d6.querySelector('#autoAllMsg').textContent) && !db6.dropNext && !/couldn’t be reached/.test(d6.querySelector('#autoAllMsg').textContent),
      'and says so, after trying again when a request failed: ' + d6.querySelector('#autoAllMsg').textContent); }

  // Drop points by line: every line with room gets one; the same word close behind itself doesn't; a word close behind
  // another item drops alone, and its line's roomy repeat is the drop point when that item is out too. Invented lines.
  { const db5 = makeDb();
    db5.songs.push({ id: 'dp-song', title: 'Drop Song', artist: 'Test', status: 'auto', lrclib_id: null, duration: 130, notes: null,
      created_at: '2026-11-13T10:00:00Z', updated_at: '2026-11-13T10:00:00Z', tagged_at: null, checked_at: null,
      lines: [[10, 'पानी पर्यो'], [14, 'पानी फेरि'], [40, 'बादल चिठी'], [60, 'नयाँ पानी गीत'], [80, 'चिठी आयो'], [84, 'पानी झर्यो'], [110, 'पानी झर्यो'], [120, 'अन्त']].map(([t, x]) => ({ t, x })) });
    db5.videos.push({ id: 50, song_id: 'dp-song', yt: 'FFFFFFFFFFF', kind: 'official', duration: 130, offset_s: 0, synced: true, embeddable: true, rank: 0 });
    [[10, 'paani', 0, 0, 0], [14, 'paani', 1, 0, 1], [41, 'chithi', 2, 1, 2], [61, 'paani', 3, 1, 3], [80, 'chithi', 4, 0, 4], [84, 'paani', 5, 0, 5], [110, 'paani', 6, 0, 5]]
      .forEach(([t, item_id, line, word, rep], k) => db5.tags.push({ id: 500 + k, song_id: 'dp-song', item_id, t, line, word, rep, source: 'estimate', checked: false }));
    const { w: w5, d: d5, yt: yt5 } = makeDom(db5, { signedIn: true, editor: true }); await sleep(80);
    const c5 = sel => d5.querySelector(sel).dispatchEvent(new w5.MouseEvent('click', { bubbles: true }));
    const row5 = d5.querySelector('.songrow[data-arg="dp-song"]');
    ok(!!row5 && row5.textContent.includes('6 drop points · 7 tags') && [...row5.querySelectorAll('.it b')].map(b => b.textContent).join(',') === '4,2' && /Paani: 5 words, 4 drop points/.test(row5.querySelector('.it').title),
      'the song list counts drop points, with the words in the hover text: ' + (row5 && row5.querySelector('.meta').textContent));
    w5.location.hash = '#song:dp-song'; await sleep(80);
    w5.onYouTubeIframeAPIReady(); await sleep(30); // the fake player is ready: the song's upload cues
    const dots5 = [...d5.querySelectorAll('.lines .w.dp')].map(b => b.closest('.ln').id + ':' + b.textContent).join(' ');
    ok(dots5 === 'ln0:पानी ln2:चिठी ln3:पानी ln4:चिठी ln5:पानी', 'every line with room gets a red dot (Paani on three lines), but not the Paani 4 s behind another Paani: ' + dots5);
    ok(/Paani: 5 words · 4 drop points/.test(d5.querySelector('#tagSum').textContent) && /Chithi: 2 words · 2 drop points/.test(d5.querySelector('#tagSum').textContent) &&
      d5.querySelector('#sidePanel').textContent.includes('0 of 6 drop points checked by ear'), 'the Tags card gives words and drop points per item: ' + d5.querySelector('#tagSum').textContent);
    const dates5 = () => d5.querySelector('#songDates').textContent;
    ok(dates5().includes('Added 13 Nov 2026') && dates5().includes('Tagged by hand not yet') && dates5().includes('Checked by ear not yet'), 'the song shows its dates: ' + dates5());
    const sa = d5.querySelector('#showAll'); sa.checked = true; sa.dispatchEvent(new w5.Event('change', { bubbles: true })); await sleep(10);
    const rep6 = d5.querySelector('#ln6 .w.dp'), first5 = d5.querySelector('#ln5 .w.dp');
    ok(!!rep6 && /drops in here when Chithi is out too/.test(rep6.title) && /drops in here$/.test(first5.title),
      'the Paani 4 s behind Chithi drops in alone; its line’s repeat is the drop point when Chithi is out too: ' + (rep6 && rep6.title));
    sa.checked = false; sa.dispatchEvent(new w5.Event('change', { bubbles: true })); await sleep(10);
    c5('[data-act="chkstart"]'); await sleep(20);
    ok(d5.querySelector('.selbar.check').textContent.includes('1 / 5') && Math.abs(yt5.seeks.slice(-1)[0] - 7) < 0.01, 'Check tags stops once per line with a drop point (5), the first from 3 s before 0:10');
    c5('[data-act="chkok"]'); await sleep(40);
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    ok(dates5().includes('Checked by ear ' + today) && d5.querySelector('#sidePanel').textContent.includes('1 of 6 drop points checked by ear'), 'checking one by ear dates the song: ' + dates5());
    c5('[data-act="chkstop"]'); await sleep(10);
    w5.location.hash = '#'; await sleep(20);
    const so5 = d5.querySelector('#ssort'); so5.value = 'checked'; so5.dispatchEvent(new w5.Event('change', { bubbles: true })); await sleep(5);
    ok(d5.querySelector('.songrow').dataset.arg === 'dp-song', 'Last checked by ear puts it first');
    w5.location.hash = '#items'; await sleep(20);
    ok(/2 songs · 5 drop points/.test(d5.querySelector('[data-arg="paani"].itile').textContent), 'item tiles count songs and drop points: ' + d5.querySelector('[data-arg="paani"].itile .ic').textContent); }

  // Requests: songs people asked for from their YouTube playlists, most asked first, handed to Add many, closed when added
  { const db = makeDb();
    db.requests = [
      { yt: 'RRRRRRRRRR1', title: 'Naya Geet (Official Video)', channel: 'Someone - Topic', asks: 3, last_at: '2026-11-14T10:00:00Z', done: null },
      { yt: 'RRRRRRRRRR2', title: 'Someone - Old Song (Official Video)', channel: 'Some Label', asks: 1, last_at: '2026-11-14T09:00:00Z', done: null },
      { yt: 'AAAAAAAAAAA', title: 'Old Song', channel: 'Someone', asks: 2, last_at: '2026-11-13T09:00:00Z', done: null }, // a song in the studio has this upload now
      { yt: 'RRRRRRRRRR4', title: 'Not This One', channel: 'X', asks: 5, last_at: '2026-11-12T09:00:00Z', done: 'skipped' }];
    const { w, d, yt } = makeDom(db, { signedIn: true, editor: true }); yt.lens.RRRRRRRRRR1 = 42;
    const c = sel => d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(60);
    ok(d.querySelector('#navReq').textContent === '2' && !d.querySelector('#navReq').hidden, 'the Requests tab counts the open ones');
    w.location.hash = '#requests'; await sleep(20);
    const rows = [...d.querySelectorAll('.res.req')];
    ok(rows.length === 2 && rows[0].textContent.includes('Naya Geet') && rows[0].textContent.includes('asked 3 times') && rows[0].textContent.includes('14 Nov 2026'), 'open requests, most asked first');
    ok(rows[1].textContent.includes('Maybe already in Jhapat as Old Song'), 'one whose title and artist match a song in the studio says so');
    ok(/In Jhapat\s*1/.test(d.querySelector('.segs').textContent) && /Skipped\s*1/.test(d.querySelector('.segs').textContent), 'one whose upload is in the studio now, and one skipped, sit apart');
    const cb = d.querySelector('[data-req="RRRRRRRRRR1"]'); cb.checked = true; cb.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(5);
    ok(d.querySelector('[data-act="reqadd"]').textContent === 'Add 1 to Add many', 'picking one readies Add many');
    c('[data-act="reqadd"]'); await sleep(30);
    ok(w.location.hash === '#import' && d.querySelector('#impText').value === 'Naya Geet - Someone | https://youtu.be/RRRRRRRRRR1',
      'its Add many line comes from the video’s title and channel: ' + d.querySelector('#impText').value);
    c('[data-act="impfind"]'); await sleep(400);
    c('[data-act="impadd"]'); await sleep(200);
    ok(db.songs.some(x => x.id === 'naya-geet' && x.status === 'auto') && db.requests.find(r => r.yt === 'RRRRRRRRRR1').done === 'added', 'adding the song closes its request');
    w.location.hash = '#requests'; await sleep(20);
    ok(d.querySelector('#navReq').textContent === '1' && d.querySelectorAll('.res.req').length === 1, 'and it leaves the open list');
    c('[data-act="reqskip"][data-arg="RRRRRRRRRR2"]'); await sleep(20);
    ok(db.requests.find(r => r.yt === 'RRRRRRRRRR2').done === 'skipped' && d.querySelector('#navReq').hidden && /No open requests/.test(d.body.textContent), 'Skip puts one aside'); }

  // Reports: Open plays the reported word in Check tags on the upload that played; Mark the report fixed closes it
  { const db = makeDb();
    db.reports = [
      { id: 7, song_id: 'old', yt: 'AAAAAAAAAAA', item_id: 'paani', t: 30, lead: 8.2, kind: 'late', note: null, ver: 32, created_at: '2026-11-14T10:00:00Z', fixed_at: null },
      { id: 5, song_id: 'old', yt: 'AAAAAAAAAAA', item_id: 'paani', t: 30, lead: 9, kind: 'other', note: 'too quiet', ver: 31, created_at: '2026-11-13T10:00:00Z', fixed_at: '2026-11-14T09:00:00Z' }];
    const { w, d, yt } = makeDom(db, { signedIn: true, editor: true });
    const c = sel => d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(60);
    ok(d.querySelector('#navRep').textContent === '1' && !d.querySelector('#navRep').hidden, 'the Reports tab counts the open ones');
    w.location.hash = '#reports'; await sleep(20);
    const rows = [...d.querySelectorAll('.res.rep')];
    ok(rows.length === 1 && rows[0].textContent.includes('Old Song') && rows[0].textContent.includes('Word came late · Paani at 0:30.00 · run-up 8.2 s · v32 · 14 Nov 2026'),
      'an open report names the song, what was off, the word and its time, the run-up and the version: ' + (rows[0] && rows[0].querySelector('.meta').textContent));
    c('[data-act="repopen"][data-arg="7"]'); await sleep(80);
    w.onYouTubeIframeAPIReady(); await sleep(400);
    const bar = d.querySelector('.selbar.check');
    ok(w.location.hash === '#song:old' && !!bar && /Reported: Word came late/.test(bar.textContent) && /Paani at 0:30\.00/.test(bar.textContent) && Math.abs(yt.seeks.slice(-1)[0] - 27) < 0.01,
      'Open goes to the song and plays the word from 3 s before in Check tags, saying what was reported');
    c('.selbar [data-act="repfix"]'); await sleep(20);
    ok(!!db.reports.find(r => r.id === 7).fixed_at && d.querySelector('#navRep').hidden && !/Reported:/.test(d.querySelector('.selbar.check').textContent), 'Mark the report fixed closes it and Check tags carries on');
    w.location.hash = '#reports'; await sleep(20);
    ok(/No|Nothing reported/.test(d.querySelector('#view').textContent) && /Fixed\s*2/.test(d.querySelector('.segs').textContent), 'the open list is empty and both sit under Fixed'); }

  // Uploads that stopped playing (v39): the check asks YouTube about each upload of a public song, lists the dead ones, Turn off takes them out
  { const db = makeDb();
    db.songs.push({ id: 'two', title: 'Two Uploads', artist: 'Band', status: 'auto', lrclib_id: null, duration: 200, notes: null, lines: null },
                  { id: 'hid', title: 'Hidden Draft', artist: 'X', status: 'draft', lrclib_id: null, duration: 200, notes: null, lines: null });
    db.videos.push({ id: 2, song_id: 'two', yt: 'BBBBBBBBBBB', kind: 'official', duration: 200, offset_s: 0, synced: true, embeddable: true, rank: 0 },
                   { id: 3, song_id: 'two', yt: 'CCCCCCCCCCC', kind: 'audio', duration: 200, offset_s: 0, synced: true, embeddable: true, rank: 1 },
                   { id: 4, song_id: 'hid', yt: 'DDDDDDDDDDD', kind: 'official', duration: 200, offset_s: 0, synced: true, embeddable: true, rank: 0 });
    db.oembed = { AAAAAAAAAAA: 401, BBBBBBBBBBB: 404, DDDDDDDDDDD: 401 };
    const { w, d } = makeDom(db, { signedIn: true, editor: true });
    const c = sel => d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(60); w.location.hash = '#reports'; await sleep(20);
    ok(!!d.querySelector('[data-act="upcheck"]') && /Uploads that stopped playing/.test(d.body.textContent), 'Reports offers to check every upload');
    c('[data-act="upcheck"]'); await sleep(80);
    const dead = [...d.querySelectorAll('.upcheck .res.rep')].map(r => r.textContent);
    ok(dead.length === 2 && /Old Song/.test(dead.join()) && /embedding off/.test(dead.join()) && /its only upload/.test(dead.join()) && /Private or removed/.test(dead.join()) && /it has another upload/.test(dead.join()) && !/Hidden Draft/.test(dead.join()),
      'it lists the two dead uploads of public songs, why, and whether the song has another: ' + dead.length);
    c('.upcheck [data-act="upoff"][data-arg="2"]'); await sleep(20);
    ok(db.videos.find(v => v.id === 2).embeddable === false && db.videos.find(v => v.id === 1).embeddable === true && d.querySelectorAll('.upcheck .res.rep').length === 1, 'Turn off takes one upload out of the catalog');
    c('.upcheck [data-act="upoffall"]'); await sleep(20);
    ok(db.videos.find(v => v.id === 1).embeddable === false && db.videos.find(v => v.id === 3).embeddable === true && /Turned off 2 uploads\. The other 1 upload play/.test(d.querySelector('.upcheck').textContent) && d.querySelectorAll('.upcheck .res.rep').length === 0,
      'Turn off all takes the rest out, and leaves good uploads alone'); }

  // Stats (v39): anonymous counts from the player, with the change on the days before, a bar a day, and top lists
  { const db = makeDb(), iso = k => new Date(Date.now() - k * 864e5).toISOString().slice(0, 10);
    db.stats = [
      { day: iso(0), ev: 'visit', k: 'Asia/Kathmandu', n: 6 }, { day: iso(0), ev: 'visit', k: 'Australia/Sydney', n: 4 }, { day: iso(1), ev: 'visit', k: 'Asia/Kathmandu', n: 5 },
      { day: iso(40), ev: 'visit', k: 'Asia/Kathmandu', n: 5 }, // the 30 days before
      { day: iso(0), ev: 'new', k: 'qr', n: 3 }, { day: iso(0), ev: 'new', k: '', n: 2 },
      { day: iso(0), ev: 'party', k: 'party-mix', n: 2 }, { day: iso(1), ev: 'party', k: 'all', n: 1 }, { day: iso(0), ev: 'start', k: 'party-mix', n: 3 },
      { day: iso(0), ev: 'drops', k: 'party-mix', n: 80 }, { day: iso(0), ev: 'song', k: 'old', n: 9 },
      { day: iso(0), ev: 'share', k: 'qr', n: 4 }, { day: iso(0), ev: 'share', k: 'native', n: 2 }, { day: iso(0), ev: 'hide', k: '', n: 1 },
      { day: iso(0), ev: 'tv', k: 'start', n: 2 }, { day: iso(0), ev: 'tv', k: 'phone', n: 5 }];
    const { w, d } = makeDom(db, { signedIn: true, editor: true });
    const c = sel => d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(60);
    ok(!!d.querySelector('#nav [data-arg="stats"]'), 'the studio has a Stats tab');
    w.location.hash = '#stats'; await sleep(40);
    ok(!!d.querySelector('.livehead') && d.querySelector('[data-act="statdays"][data-arg="live"]').getAttribute('aria-pressed') === 'true', 'Stats opens on Live');
    c('[data-act="statdays"][data-arg="30"]'); await sleep(40);
    const k = [...d.querySelectorAll('.kpi')].map(x => x.querySelector('.small').textContent + '=' + x.querySelector('b').textContent);
    ok(k.join(' ') === 'Phones=15 New phones=5 Nights started=3 Parties=3 Drops=80 Shares=2 Minutes of music=0', 'the numbers for the last 30 days: ' + k.join(' '));
    ok(/Days run on UTC, from/.test(d.querySelector('.statnote').textContent), 'it says when a day starts in your time');
    ok(/\+200% on the 30 days before/.test(d.querySelector('.kpi').textContent), 'with the change on the 30 days before: ' + d.querySelector('.kpi').textContent);
    ok(d.querySelectorAll('.bars .bar').length === 30 && d.querySelectorAll('.bars .bar i').length === 2, 'a bar a day, with the parties inside');
    const t = d.querySelector('.statgrid').textContent;
    ok(/Nepali Party Mix\s*2/.test(t) && /Old Song/.test(t) && /Asia\/Kathmandu\s*11/.test(t) && /Scanned the QR code\s*3/.test(t) && /Shared from the phone\s*2/.test(t) && /Hide turned on\s*1/.test(t) && /Big screen turned on\s*2/.test(t) && /Phones used as remotes\s*5/.test(t),
      'top lists: playlists, songs, time zones, how new phones arrived, sharing and features (big screen too)');
    c('[data-act="statdays"][data-arg="7"]'); await sleep(20);
    ok(d.querySelectorAll('.bars .bar').length === 7 && [...d.querySelectorAll('.kpi b')][0].textContent === '15', 'the last 7 days, too'); }

  // Live (v50): the last hour minute by minute from stats_min: phones open now (pings in the last minute), page opens with new phones,
  // the window buttons, and where people came from, which phones, taps, problems
  { const db = makeDb(), m = k => new Date(Math.floor(Date.now() / 60e3) * 60e3 - k * 60e3).toISOString();
    db.stats_min = [
      { at: m(0), ev: 'ping', k: 'play', n: 3 }, { at: m(0), ev: 'ping', k: 'idle', n: 1 }, { at: m(1), ev: 'ping', k: 'play', n: 2 },
      { at: m(2), ev: 'from', k: 'tiktok', n: 4 }, { at: m(2), ev: 'new', k: '', n: 3 }, { at: m(2), ev: 'visit', k: 'Australia/Melbourne', n: 4 },
      { at: m(3), ev: 'from', k: 'direct', n: 1 }, { at: m(3), ev: 'dev', k: 'iphone-tiktok', n: 3 }, { at: m(3), ev: 'dev', k: 'android-chrome', n: 1 },
      { at: m(5), ev: 'start', k: 'all', n: 2 }, { at: m(6), ev: 'party', k: 'all', n: 1 }, { at: m(6), ev: 'drops', k: 'all', n: 9 },
      { at: m(7), ev: 'act', k: 'show', n: 5 }, { at: m(7), ev: 'item', k: 'paani', n: 2 }, { at: m(8), ev: 'err', k: 'yt-150', n: 1 }, { at: m(8), ev: 'lang', k: 'ne', n: 2 },
      { at: m(9), ev: 'ret', k: '2-7d', n: 1 }, { at: m(9), ev: 'speed', k: '1-2s', n: 3 }, { at: m(9), ev: 'night', k: '10', n: 1 },
      { at: m(200), ev: 'from', k: 'qr', n: 6 }, { at: m(200), ev: 'new', k: 'qr', n: 6 }]; // over 3 hours ago
    const { w, d } = makeDom(db, { signedIn: true, editor: true });
    const c = sel => d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(60); w.location.hash = '#stats'; await sleep(40);
    const k = () => [...d.querySelectorAll('.kpi')].map(x => x.querySelector('.small').textContent + '=' + x.querySelector('b').textContent).join(' ');
    ok(k() === 'Open now=4 Page opens=5 New phones=3 Nights started=2 Parties=1 Drops=9 Minutes of music=5', 'the last hour: ' + k());
    ok(d.querySelectorAll('.bars .bar').length === 60 && d.querySelectorAll('.bars .bar i').length === 1, 'a bar a minute, new phones inside: ' + d.querySelectorAll('.bars .bar').length);
    const t = d.querySelector('.statgrid').textContent;
    ok(/TikTok\s*4/.test(t) && /Typed the address\s*1/.test(t) && /iPhone · inside TikTok\s*3/.test(t) && /Android · Chrome\s*1/.test(t) && /Show the word\s*5/.test(t) &&
      /Paani\s*2/.test(t) && /YouTube error 150 \(embedding off\)\s*1/.test(t) && /Nepali\s*2/.test(t) && /Within a week\s*1/.test(t) && /1–2 s\s*3/.test(t) &&
      /10\+ drops in a night\s*1/.test(t) && /Australia\/Melbourne\s*4/.test(t) && /All songs\s*9/.test(t) && !/Scanned the QR code/.test(t), 'where they came from, phones, taps, items, problems, languages, coming back, speed, long nights, places, playlists');
    c('[data-act="livewin"][data-arg="360"]'); await sleep(20);
    ok(/Page opens=11 New phones=9/.test(k()) && d.querySelectorAll('.bars .bar').length === 72 && /Scanned the QR code\s*6/.test(d.querySelector('.statgrid').textContent), '6 hours, five minutes a bar: ' + k());
    db.stats_min.push({ at: m(0), ev: 'ping', k: 'play', n: 6 }); c('[data-act="statsreload"]'); await sleep(40);
    ok(/Open now=10/.test(k()), 'Refresh reads the database again (Live also does every 20 s): ' + k()); }

  // Songs people's playlists are waiting for (v40): grouped by what they need, most asked first; Copy for Claude, Add many for the
  // ones with uploads, Added and Skip; one closes by itself once its LRCLIB version is in the studio
  { const db = makeDb();
    db.songs[0].lrclib_id = 555;
    db.wishes = [
      { k: 'lrc:777', title: 'Timi Ra Ma', artist: 'Salin Magar', kind: 'auto', lrclib_id: 777, len: 201, yt: 'TTTTTTTTTTT', src: 'yt', asks: 3, last_at: '2026-11-15T10:00:00Z', done: null },
      { k: 'lrc:888', title: 'Khai K Ho', artist: 'Unknown Artist', kind: 'auto', lrclib_id: 888, len: 199, yt: null, src: 'text', asks: 1, last_at: '2026-11-15T09:00:00Z', done: null },
      { k: 'q:naya|band', title: 'Naya Gaana', artist: 'Band X', kind: 'timing', lrclib_id: 8, len: null, yt: null, src: 'sp', asks: 2, last_at: '2026-11-15T08:00:00Z', done: null },
      { k: 'lrc:555', title: 'Old Song', artist: 'Someone', kind: 'auto', lrclib_id: 555, len: 200, yt: null, src: 'sp', asks: 5, last_at: '2026-11-15T07:00:00Z', done: null }];
    let copied = null;
    const { w, d } = makeDom(db, { signedIn: true, editor: true });
    Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async t => { copied = t; } } });
    const c = sel => d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(60); w.location.hash = '#requests'; await sleep(20);
    const rows = [...d.querySelectorAll('.wishes .res.wish')].map(r => r.querySelector('b').textContent);
    ok(rows.join() === 'Timi Ra Ma,Khai K Ho,Naya Gaana' && d.querySelector('#navReq').textContent === '3', 'waiting songs show grouped by what they need, most asked first; one already in the studio has closed: ' + rows.join());
    ok(/Can add: timed lyrics\s*2/.test(d.querySelector('.wishes').textContent) && /Needs timing by hand\s*1/.test(d.querySelector('.wishes').textContent) && /from Spotify/.test(d.querySelector('.wishes').textContent), 'with what each needs and where it came from');
    c('[data-act="wishcopy"]'); await sleep(10);
    ok(/Timi Ra Ma - Salin Magar \| https:\/\/youtu\.be\/TTTTTTTTTTT \| lrclib:777 \| 3:21/.test(copied || '') && /Khai K Ho - Unknown Artist \| lrclib:888 \| 3:19/.test(copied || '') && !/Naya Gaana/.test(copied || ''),
      'Copy for Claude copies the ones with timed lyrics as Add many lines');
    c('[data-act="wishskip"][data-arg="q:naya|band"]'); await sleep(20);
    ok(db.wishes.find(x => x.k === 'q:naya|band').done === 'skipped' && d.querySelectorAll('.wishes .res.wish').length === 2, 'Skip puts one aside');
    c('[data-act="wishadd"]'); await sleep(20);
    ok(w.location.hash === '#import' && /Timi Ra Ma - Salin Magar \| https:\/\/youtu\.be\/TTTTTTTTTTT \| lrclib:777/.test(d.querySelector('#view').textContent + (d.querySelector('textarea') || {}).value), 'the ones with uploads go to Add many'); }

  // the version check works on jhapat.live too
  { const db = makeDb(); db.ver = 999; const { d } = makeDom(db, { signedIn: false, url: 'https://jhapat.live/studio/' });
    await sleep(60);
    ok(!d.querySelector('#update').hidden, 'on jhapat.live a newer version offers a reload'); }

  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH', e); process.exit(1); });
