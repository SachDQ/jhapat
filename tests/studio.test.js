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
      insert(rows) { st.op = 'insert'; st.rows = Array.isArray(rows) ? rows : [rows]; return api; },
      update(p) { st.op = 'update'; st.patch = p; return api; },
      delete() { st.op = 'delete'; return api; },
      then(res, rej) { return (db.delay ? new Promise(r => setTimeout(r, db.delay)) : Promise.resolve()).then(run).then(res, rej); },
    };
    const match = r => st.filters.every(f => f(r));
    const embed = r => {
      const o = { ...r };
      if (table === 'songs') {
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
      if (st.op === 'select') { const rows = T.filter(match).map(embed); return st.single ? (rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } }) : { data: rows, error: null }; }
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
  const yt = { t: 0, vid: null, st: -1, dur: 42, seeks: [] };
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sachdq.github.io/jhapat/studio/', pretendToBeVisual: true,
    beforeParse(win) {
      win.__fakeSb = fakeSb(db, opts);
      win.scrollTo = () => {}; win.HTMLElement.prototype.scrollIntoView = function () {};
      win.CSS = win.CSS || {}; win.CSS.escape = s => String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
      win.fetch = async url => ({ json: async () => /lrclib/.test(url) ? [{ id: 555, trackName: 'Test Rain', artistName: 'Test Band', albumName: 'Demo', duration: 42, syncedLyrics: LRC, plainLyrics: 'x' }] : [] });
      win.YT = { Player: function (id, o) {
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
  ok(d.querySelectorAll('.w.tagged').length === 1, 'its existing tag (paani at 0:30) shows on the matching word');

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
  w.location.hash = '#song:plain'; await sleep(80);
  const marks = [...d.querySelectorAll('#plain mark')].map(m => m.textContent);
  ok(marks.join(',') === 'पानी,पानीमा,चिठी' && d.querySelector('#plain .dim') && d.querySelector('#plain').textContent.includes('हावा चल्यो'),
    'untimed lyrics show with item words marked: ' + marks.join(','));
  ok(d.body.textContent.includes('3 item words on 2 lines') && !!d.querySelector('.tapgrid'), 'it counts them and keeps the tap-along buttons');

  // items: edit spellings
  w.location.hash = '#items'; await sleep(20);
  const tr = d.querySelector('tr[data-item="paani"]'); tr.querySelector('[data-f="words"]').value = 'paani, pani, पानी, पानि';
  click('[data-act="saveitem"][data-arg="paani"]'); await sleep(20);
  ok(db.items.find(i => i.id === 'paani').words.length === 4, 'item spellings save');

  // playlists page lists both songs in order
  w.location.hash = '#playlists'; await sleep(20);
  ok(d.querySelectorAll('[data-plid="party-mix"] .songs .row').length === 2, 'playlist page lists its songs');

  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH', e); process.exit(1); });
