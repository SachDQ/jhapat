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
      eq(c, v) { st.filters.push(r => r[c] === v); return api; },
      in(c, vs) { st.filters.push(r => vs.includes(r[c])); return api; },
      single() { st.single = true; return api; },
      range(from, to) { st.range = [from, to]; db.ranges = (db.ranges || 0) + 1; return api; },
      insert(rows) { st.op = 'insert'; st.rows = Array.isArray(rows) ? rows : [rows]; return api; },
      update(p) { st.op = 'update'; st.patch = p; return api; },
      delete() { st.op = 'delete'; return api; },
      then(res, rej) { return (db.delay ? new Promise(r => setTimeout(r, db.delay)) : Promise.resolve()).then(run).then(res, rej); },
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
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/studio/', pretendToBeVisual: true,
    beforeParse(win) {
      win.__fakeSb = fakeSb(db, opts);
      win.scrollTo = () => {}; win.HTMLElement.prototype.scrollIntoView = function () {};
      win.CSS = win.CSS || {}; win.CSS.escape = s => String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
      win.__lrcPace = { gap: 0, wait: 5 };
      win.fetch = async url => { if (/lrclib/.test(url)) { db.lrcCalls = (db.lrcCalls || 0) + 1; (db.lrcUrls = db.lrcUrls || []).push(url); }
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

  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH', e); process.exit(1); });
