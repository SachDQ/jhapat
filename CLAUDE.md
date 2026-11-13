# Jhapat (झपट)

Sachin's web app for a Nepali party game. Items such as paani, phool, chiya, paisa, chithi and maya sit on a table. The player drops into a random song 7–10 s before one of those words is sung, and the crowd grabs and referees in real life. It is a music player, not a scoring app: no scores, no timers, no rules engine.

Live at https://sachdq.github.io/jhapat/ (GitHub Pages, `main` branch, repo root). Pushing to `main` deploys in about a minute.

## Layout
- `index.html`: the party player, a single file with no build step. It plays YouTube through the IFrame API in two stacked players: the front one plays, the back one loads the next drop muted. iPhone, iPad and Safari use one player, because they only give sound to a video the person has tapped. It loads the `party-mix` playlist from the database on every visit and keeps it in localStorage. The 16 songs built into `seed()` are only a fallback for phones that have never reached the database.
- `studio/index.html`: the tagging studio, for editors only. It uses supabase-js 2.45.4 (UMD) and signs in by email link. It searches LRCLIB for timed lyrics, folds repeated lines together, highlights item words, and supports Hear/Tap/nudge per word with the timing copied to every repeat. It also handles upload length checks and sync, tap-along for songs without lyrics, items and playlists.
- `db/schema.sql`: tables, row-level security, `playlist_bundle(pid)` and the `playlist_cards` view. `db/seed.sql` holds the 16 starter songs. Both were run once in the Supabase SQL editor; edit them, then re-run the changed parts there.

## Data rules
- Tag times are on the lyrics' timeline. Each upload (`videos.offset_s`) stores how far it runs behind the lyrics, so video time = lyric time + offset. Never re-tag because an upload changed; fix that upload's offset.
- `songs.status` moves draft → tagged → checked. Drafts are hidden from the public.
- Item spellings (`items.words`) match at the start of a lyric word, in Devanagari and roman letters.
- Lyrics live in the database and are fetched from LRCLIB at runtime. Don't copy lyrics into the repo, tests or docs. Test fixtures use invented lines.

## Supabase
- Project `hckzkaprxywohazohmcu` (Mumbai, free plan) in Sachin's org. REST: `https://hckzkaprxywohazohmcu.supabase.co/rest/v1/`.
- The publishable key `sb_publishable_BxH35gKGU8uwTsn-jGur9g_a_L-b98T` is public by design; RLS does the protecting. Never use or ask for the secret key, and never type Sachin's passwords.
- Anyone can read items, non-draft songs, uploads, tags and public playlists. Writes need a row in `public.editors`. To add an editor, they sign in once at /studio, then in the SQL editor run `insert into public.editors (user_id) select id from auth.users where email = '...';`.
- Auth: Site URL `https://sachdq.github.io/jhapat/studio/`; redirect allow-list `https://sachdq.github.io/jhapat/**`. Email templates can't be edited on the built-in mailer, so sign-in is by link, not code.
- The free plan pauses after about a week of low activity. `.github/workflows/keepalive.yml` pings it twice a week.

## Checks
Run `npm install` once, then `npm test` before every push. It runs `tests/player.test.js` and `tests/studio.test.js` in jsdom, with stand-ins for YouTube, Supabase and LRCLIB. They cover drop leads, preload swap, the iPhone path, database mode, tag grouping, tap/nudge, sync, items and playlists. Add a test with each change. In a real browser, check through the live site, because YouTube embeds fail on file:// and in app previews (errors 152/153).

## Working with Sachin
He prefers dense, direct answers, and plans or guides delivered as interactive artifacts rather than .md files. Commit messages end with the Claude co-author and session lines given by the harness.
