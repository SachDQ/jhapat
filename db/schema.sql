-- Jhapat database: items, songs with timed lyrics, YouTube uploads, word tags and playlists.
-- Anyone can read what the party player needs. Only accounts listed in public.editors can change anything.
-- Tag times are on the lyrics' timeline; each upload stores offset_s (video time = lyric time + offset_s).

create table if not exists public.items (
  id         text primary key check (id ~ '^[a-z0-9-]+$'),
  name       text not null,
  dev        text,                                -- the name in Devanagari
  emoji      text,                                -- shown on the item's chip, e.g. 💧
  words      text[] not null default '{}',        -- every spelling that counts, roman and Devanagari
  note       text,                                -- e.g. "use an envelope"
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.songs (
  id           text primary key check (id ~ '^[a-z0-9-]+$'),
  title        text not null,
  artist       text,
  lrclib_id    bigint,
  duration     numeric,                           -- seconds, length of the recording the lyrics were timed to
  lines        jsonb,                             -- timed lyric lines: [{"t": 35.15, "x": "..."}]
  plain_lyrics text,
  status       text not null default 'draft' check (status in ('draft', 'auto', 'tagged', 'checked')), -- auto: tagged automatically from lyrics that match the upload
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  tagged_at    timestamptz,                       -- last time a tag was timed by hand (tap, nudge); kept by a trigger on tags
  checked_at   timestamptz                        -- last time a tag was checked by ear; kept by a trigger on tags
);

create table if not exists public.videos (
  id          bigint generated always as identity primary key,
  song_id     text not null references public.songs (id) on update cascade on delete cascade,
  yt          text not null check (yt ~ '^[A-Za-z0-9_-]{11}$'),
  kind        text not null default 'official' check (kind in ('official', 'audio', 'lyric', 'live', 'other')),
  duration    numeric,
  offset_s    numeric not null default 0,         -- how far this upload runs behind the lyrics, in seconds
  synced      boolean not null default false,     -- offset confirmed (lengths match, or tapped in the studio)
  rank        int not null default 0,             -- lower plays first
  embeddable  boolean not null default true,
  checked_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (song_id, yt)
);
create index if not exists videos_song_idx on public.videos (song_id);

create table if not exists public.tags (
  id         bigint generated always as identity primary key,
  song_id    text not null references public.songs (id) on update cascade on delete cascade,
  item_id    text not null references public.items (id) on update cascade on delete cascade,
  t          numeric not null check (t >= 0),     -- seconds on the lyrics' timeline
  line       int,                                 -- index into songs.lines
  word       int,                                 -- word index within that line
  rep        int,                                 -- first line of its repeated-line group: a chorus word counts once, at its roomiest repeat
  source     text not null default 'estimate' check (source in ('estimate', 'tap', 'nudge', 'word')),
  checked    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists tags_song_idx on public.tags (song_id);

create table if not exists public.playlists (
  id          text primary key default substr(md5(random()::text), 1, 10) check (id ~ '^[a-z0-9-]+$'),
  name        text not null,
  description text,
  owner       uuid references auth.users (id) on delete cascade,   -- null for official playlists
  is_public   boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.playlist_songs (
  playlist_id text not null references public.playlists (id) on update cascade on delete cascade,
  song_id     text not null references public.songs (id) on update cascade on delete cascade,
  position    int not null default 0,
  primary key (playlist_id, song_id)
);
create index if not exists playlist_songs_song_idx on public.playlist_songs (song_id);

create table if not exists public.editors (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

-- upgrades for a database made before these columns existed (safe to re-run)
alter table public.items add column if not exists emoji text;
alter table public.tags  add column if not exists rep int;
alter table public.songs drop constraint if exists songs_status_check;
alter table public.songs add constraint songs_status_check check (status in ('draft', 'auto', 'tagged', 'checked'));
alter table public.songs add column if not exists tagged_at timestamptz;   -- added 14 Nov 2026 (v29)
alter table public.songs add column if not exists checked_at timestamptz;

-- keep updated_at current
create or replace function public.touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists songs_touch on public.songs;
create trigger songs_touch before update on public.songs for each row execute function public.touch();
drop trigger if exists playlists_touch on public.playlists;
create trigger playlists_touch before update on public.playlists for each row execute function public.touch();

-- a song's tagged_at and checked_at, from what happens to its tags (estimates made automatically don't count)
create or replace function public.tags_dated_ins() returns trigger language plpgsql set search_path = '' as $$
begin
  update public.songs s set tagged_at = now() where s.id in (select n.song_id from new_rows n where n.source <> 'estimate');
  update public.songs s set checked_at = now() where s.id in (select n.song_id from new_rows n where n.checked);
  return null;
end $$;
create or replace function public.tags_dated_upd() returns trigger language plpgsql set search_path = '' as $$
begin
  update public.songs s set tagged_at = now() where s.id in (select n.song_id from new_rows n join old_rows o on o.id = n.id
    where n.source <> 'estimate' and (n.t is distinct from o.t or n.source is distinct from o.source));
  update public.songs s set checked_at = now() where s.id in (select n.song_id from new_rows n join old_rows o on o.id = n.id
    where n.checked and not o.checked);
  return null;
end $$;
drop trigger if exists tags_dated_ins on public.tags;
create trigger tags_dated_ins after insert on public.tags referencing new table as new_rows
  for each statement execute function public.tags_dated_ins();
drop trigger if exists tags_dated_upd on public.tags;
create trigger tags_dated_upd after update on public.tags referencing old table as old_rows new table as new_rows
  for each statement execute function public.tags_dated_upd();
-- songs tagged or checked before the dates existed: the newest such tag's creation time (only fills empty dates, safe to re-run)
update public.songs s set tagged_at = x.at from (select song_id, max(created_at) as at from public.tags where source <> 'estimate' group by song_id) x
  where x.song_id = s.id and s.tagged_at is null;
update public.songs s set checked_at = x.at from (select song_id, max(created_at) as at from public.tags where checked group by song_id) x
  where x.song_id = s.id and s.checked_at is null;

-- true when the signed-in account may edit
create or replace function public.is_editor() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.editors e where e.user_id = auth.uid());
$$;

-- row level security
alter table public.items          enable row level security;
alter table public.songs          enable row level security;
alter table public.videos         enable row level security;
alter table public.tags           enable row level security;
alter table public.playlists      enable row level security;
alter table public.playlist_songs enable row level security;
alter table public.editors        enable row level security;

drop policy if exists "read items" on public.items;
create policy "read items" on public.items for select using (true);
drop policy if exists "edit items" on public.items;
create policy "edit items" on public.items for all to authenticated using (public.is_editor()) with check (public.is_editor());

drop policy if exists "read songs" on public.songs;
create policy "read songs" on public.songs for select using (status <> 'draft' or public.is_editor());
drop policy if exists "edit songs" on public.songs;
create policy "edit songs" on public.songs for all to authenticated using (public.is_editor()) with check (public.is_editor());

drop policy if exists "read videos" on public.videos;
create policy "read videos" on public.videos for select using (true);
drop policy if exists "edit videos" on public.videos;
create policy "edit videos" on public.videos for all to authenticated using (public.is_editor()) with check (public.is_editor());

drop policy if exists "read tags" on public.tags;
create policy "read tags" on public.tags for select using (true);
drop policy if exists "edit tags" on public.tags;
create policy "edit tags" on public.tags for all to authenticated using (public.is_editor()) with check (public.is_editor());

drop policy if exists "read playlists" on public.playlists;
create policy "read playlists" on public.playlists for select
  using (is_public or owner = auth.uid() or public.is_editor());
drop policy if exists "edit playlists" on public.playlists;
create policy "edit playlists" on public.playlists for all to authenticated using (public.is_editor()) with check (public.is_editor());

drop policy if exists "read playlist songs" on public.playlist_songs;
create policy "read playlist songs" on public.playlist_songs for select using (exists (
  select 1 from public.playlists p where p.id = playlist_id and (p.is_public or p.owner = auth.uid() or public.is_editor())));
drop policy if exists "edit playlist songs" on public.playlist_songs;
create policy "edit playlist songs" on public.playlist_songs for all to authenticated using (public.is_editor()) with check (public.is_editor());

drop policy if exists "see own editor row" on public.editors;
create policy "see own editor row" on public.editors for select to authenticated using (user_id = auth.uid());
-- editors are added from the SQL editor only; there is no insert policy on purpose

-- what the party player needs for one playlist, in one call: POST /rest/v1/rpc/playlist_bundle {"pid": "..."}
create or replace function public.playlist_bundle(pid text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'description', p.description,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'dev', i.dev, 'note', i.note, 'emoji', i.emoji) order by i.sort, i.id), '[]'::jsonb)
              from public.items i),
    'songs', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', s.id, 'title', s.title, 'artist', s.artist, 'status', s.status,
                'videos', (select coalesce(jsonb_agg(jsonb_build_object('yt', v.yt, 'offset', v.offset_s, 'synced', v.synced) order by v.rank, v.id), '[]'::jsonb)
                           from public.videos v where v.song_id = s.id and v.embeddable),
                'tags', (select coalesce(jsonb_agg(jsonb_build_array(t.item_id, t.t, t.rep) order by t.t), '[]'::jsonb) -- [item, lyric time, repeat group]
                         from public.tags t where t.song_id = s.id)
              ) order by ps.position, s.title), '[]'::jsonb)
              from public.playlist_songs ps join public.songs s on s.id = ps.song_id
              where ps.playlist_id = p.id and s.status <> 'draft'))
  from public.playlists p where p.id = pid;
$$;

-- playlist cards for the picker: song count, how many songs mention each item, and the first four songs' uploads (for covers)
create or replace view public.playlist_cards with (security_invoker = true) as
select p.id, p.name, p.description, p.sort, p.owner, p.is_public,
  (select count(*) from public.playlist_songs ps join public.songs s on s.id = ps.song_id
     where ps.playlist_id = p.id and s.status <> 'draft') as songs,
  (select coalesce(jsonb_object_agg(x.item_id, x.n), '{}'::jsonb) from (
     select t.item_id, count(distinct t.song_id) as n
     from public.playlist_songs ps join public.songs s on s.id = ps.song_id and s.status <> 'draft'
     join public.tags t on t.song_id = ps.song_id
     where ps.playlist_id = p.id group by t.item_id) x) as items,
  (select coalesce(jsonb_agg(x.yt order by x.position), '[]'::jsonb) from (
     select ps.position, v.yt
     from public.playlist_songs ps join public.songs s on s.id = ps.song_id and s.status <> 'draft'
     join lateral (select v.yt from public.videos v where v.song_id = s.id and v.embeddable order by v.rank, v.id limit 1) v on true
     where ps.playlist_id = p.id order by ps.position limit 4) x) as thumbs
from public.playlists p;

-- everything the party player needs, in one call (v30, 14 Nov 2026): every public song once, with its uploads and tags, and each
-- official playlist as a list of its songs. GET /rest/v1/rpc/catalog. The phone keeps it, so All songs and every playlist open
-- straight away and work without signal. playlist_bundle and playlist_cards stay for pages cached before v30.
create or replace function public.catalog() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'dev', i.dev, 'note', i.note, 'emoji', i.emoji) order by i.sort, i.id), '[]'::jsonb)
              from public.items i),
    'songs', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', s.id, 'title', s.title, 'artist', s.artist,
                'videos', (select coalesce(jsonb_agg(jsonb_build_object('yt', v.yt, 'offset', v.offset_s, 'synced', v.synced) order by v.rank, v.id), '[]'::jsonb)
                           from public.videos v where v.song_id = s.id and v.embeddable),
                'tags', (select coalesce(jsonb_agg(jsonb_build_array(t.item_id, t.t, t.rep) order by t.t), '[]'::jsonb) -- [item, lyric time, repeat group]
                         from public.tags t where t.song_id = s.id)
              ) order by s.title, s.id), '[]'::jsonb)
              from public.songs s where s.status <> 'draft'),
    'playlists', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description,
                'songs', (select coalesce(jsonb_agg(ps.song_id order by ps.position, ps.song_id), '[]'::jsonb)
                          from public.playlist_songs ps join public.songs s on s.id = ps.song_id and s.status <> 'draft'
                          where ps.playlist_id = p.id)
              ) order by p.sort, p.name), '[]'::jsonb)
              from public.playlists p where p.owner is null and p.is_public));
$$;

-- songs asked for from people's YouTube playlists (v31) and drops someone said were off (v32), 14 Nov 2026.
-- Anyone adds through request_songs() and report_drop(), which check what they're given; only editors read and close them.
create table if not exists public.requests (
  yt       text primary key check (yt ~ '^[A-Za-z0-9_-]{11}$'),
  title    text,                                  -- the video's title on YouTube, as the phone saw it
  channel  text,
  asks     int not null default 1,                -- each phone asks once per video
  first_at timestamptz not null default now(),
  last_at  timestamptz not null default now(),
  done     text check (done in ('added', 'skipped')), -- null while open
  done_at  timestamptz
);
create table if not exists public.reports (
  id         bigint generated always as identity primary key,
  song_id    text not null references public.songs (id) on update cascade on delete cascade,
  yt         text check (yt ~ '^[A-Za-z0-9_-]{11}$'), -- the upload that played
  item_id    text,
  t          numeric,                             -- the word's time on the lyrics' timeline
  lead       numeric,                             -- the run-up it got, in seconds
  kind       text not null check (kind in ('soon', 'late', 'word', 'unsung', 'video', 'other')),
  note       text,
  ver        int,                                 -- the player's version
  created_at timestamptz not null default now(),
  fixed_at   timestamptz
);
create index if not exists reports_song_idx on public.reports (song_id);
alter table public.requests enable row level security;
alter table public.reports  enable row level security;
drop policy if exists "editors read requests" on public.requests;
create policy "editors read requests" on public.requests for select to authenticated using (public.is_editor());
drop policy if exists "editors edit requests" on public.requests;
create policy "editors edit requests" on public.requests for all to authenticated using (public.is_editor()) with check (public.is_editor());
drop policy if exists "editors read reports" on public.reports;
create policy "editors read reports" on public.reports for select to authenticated using (public.is_editor());
drop policy if exists "editors edit reports" on public.reports;
create policy "editors edit reports" on public.reports for all to authenticated using (public.is_editor()) with check (public.is_editor());

-- POST /rest/v1/rpc/request_songs {"vids": [{"yt": "...", "title": "...", "channel": "..."}]}: at most 200; uploads already in
-- Jhapat are left out; asking again counts again. Returns how many were counted.
create or replace function public.request_songs(vids jsonb) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare n int;
begin
  if jsonb_typeof(vids) is distinct from 'array' or jsonb_array_length(vids) > 200 then raise exception 'send a list of at most 200 videos'; end if;
  insert into public.requests as r (yt, title, channel)
    select distinct on (v->>'yt') v->>'yt', left(nullif(btrim(v->>'title'), ''), 200), left(nullif(btrim(v->>'channel'), ''), 100)
    from jsonb_array_elements(vids) v
    where jsonb_typeof(v) = 'object' and (v->>'yt') ~ '^[A-Za-z0-9_-]{11}$'
      and not exists (select 1 from public.videos x where x.yt = v->>'yt')
  on conflict (yt) do update set asks = r.asks + 1, last_at = now(),
    title = coalesce(excluded.title, r.title), channel = coalesce(excluded.channel, r.channel);
  get diagnostics n = row_count;
  return n;
end $$;

-- POST /rest/v1/rpc/report_drop {"r": {"song": "...", "yt": "...", "item": "...", "t": 83.2, "lead": 8.1, "kind": "late", "note": "...", "ver": 32}}
create or replace function public.report_drop(r jsonb) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare rid bigint;
begin
  if jsonb_typeof(r) is distinct from 'object' then raise exception 'send one report'; end if;
  if not exists (select 1 from public.songs s where s.id = r->>'song' and s.status <> 'draft') then raise exception 'no such song'; end if;
  insert into public.reports (song_id, yt, item_id, t, lead, kind, note, ver)
  values (r->>'song',
    case when (r->>'yt') ~ '^[A-Za-z0-9_-]{11}$' then r->>'yt' end,
    left(r->>'item', 40),
    case when jsonb_typeof(r->'t') = 'number' then round((r->>'t')::numeric, 2) end,
    case when jsonb_typeof(r->'lead') = 'number' then round((r->>'lead')::numeric, 2) end,
    r->>'kind',
    left(nullif(btrim(r->>'note'), ''), 500),
    case when jsonb_typeof(r->'ver') = 'number' then (r->>'ver')::numeric::int end)
  returning id into rid;
  return rid;
end $$;
revoke execute on function public.request_songs(jsonb), public.report_drop(jsonb) from public;

grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.playlist_bundle(text), public.catalog(), public.is_editor() to anon, authenticated;
grant execute on function public.request_songs(jsonb), public.report_drop(jsonb) to anon, authenticated;

-- ---------- v39, 15 Nov 2026 ----------
-- A stamp that changes whenever anything the catalog holds changes (statement triggers on its six tables), so a phone that
-- already has the catalog checks GET /rest/v1/rpc/catalog_stamp (a few bytes) instead of downloading 137 KB again. An hourly
-- GitHub Action (.github/workflows/catalog.yml) keeps a copy of catalog() with its stamp on the repo's catalog branch, which
-- first visits read from raw.githubusercontent.com; a phone whose stamp differs from that copy's asks catalog() itself.
create table if not exists public.meta (
  k  text primary key,
  v  text not null,
  at timestamptz not null default now()
);
alter table public.meta enable row level security;
drop policy if exists "read meta" on public.meta;
create policy "read meta" on public.meta for select using (true);
insert into public.meta (k, v) values ('catalog', md5(random()::text)) on conflict (k) do nothing;

create or replace function public.catalog_bump() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.meta set v = md5(random()::text || clock_timestamp()::text), at = now() where k = 'catalog';
  return null;
end $$;
do $$ declare t text; begin
  foreach t in array array['items', 'songs', 'videos', 'tags', 'playlists', 'playlist_songs'] loop
    execute format('drop trigger if exists catalog_bump on public.%I', t);
    execute format('create trigger catalog_bump after insert or update or delete or truncate on public.%I for each statement execute function public.catalog_bump()', t);
  end loop;
end $$;

create or replace function public.catalog_stamp() returns text
language sql stable security invoker set search_path = '' as $$
  select v from public.meta where k = 'catalog';
$$;

-- catalog() as above, plus its stamp (read in the same snapshot, so the two always belong together)
create or replace function public.catalog() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'stamp', (select m.v from public.meta m where m.k = 'catalog'),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'dev', i.dev, 'note', i.note, 'emoji', i.emoji) order by i.sort, i.id), '[]'::jsonb)
              from public.items i),
    'songs', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', s.id, 'title', s.title, 'artist', s.artist,
                'videos', (select coalesce(jsonb_agg(jsonb_build_object('yt', v.yt, 'offset', v.offset_s, 'synced', v.synced) order by v.rank, v.id), '[]'::jsonb)
                           from public.videos v where v.song_id = s.id and v.embeddable),
                'tags', (select coalesce(jsonb_agg(jsonb_build_array(t.item_id, t.t, t.rep) order by t.t), '[]'::jsonb) -- [item, lyric time, repeat group]
                         from public.tags t where t.song_id = s.id)
              ) order by s.title, s.id), '[]'::jsonb)
              from public.songs s where s.status <> 'draft'),
    'playlists', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description,
                'songs', (select coalesce(jsonb_agg(ps.song_id order by ps.position, ps.song_id), '[]'::jsonb)
                          from public.playlist_songs ps join public.songs s on s.id = ps.song_id and s.status <> 'draft'
                          where ps.playlist_id = p.id)
              ) order by p.sort, p.name), '[]'::jsonb)
              from public.playlists p where p.owner is null and p.is_public));
$$;

-- Anonymous counts of how Jhapat is used (Studio › Stats). No accounts, no IP addresses, no ID for a phone: a phone sends
-- events such as visit (once a day, with its time zone), new (its first visit, with ?ref= from a shared link or QR code),
-- start and party (the first and fifth drop of a night, with the playlist), drops and song (what played), share, ytlist,
-- hide and install. Anyone adds through tally(), which takes only those events and short keys and caps how many keys a day
-- can gain; only editors read the table. Song counts are kept by week.
create table if not exists public.stats (
  day date not null,
  ev  text not null,
  k   text not null default '',
  n   bigint not null default 0,
  primary key (day, ev, k)
);
alter table public.stats enable row level security;
drop policy if exists "editors read stats" on public.stats;
create policy "editors read stats" on public.stats for select to authenticated using (public.is_editor());

-- POST /rest/v1/rpc/tally {"e": [["visit", "Asia/Kathmandu"], ["drops", "party-mix", 7], ["song", "kaha-hola-ghar"]]}
create or replace function public.tally(e jsonb) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare x jsonb; v_ev text; v_k text; v_n int; v_day date; cnt int := 0;
begin
  if jsonb_typeof(e) is distinct from 'array' or jsonb_array_length(e) > 40 then raise exception 'send at most 40 events'; end if;
  for x in select value from jsonb_array_elements(e) loop
    if jsonb_typeof(x) is distinct from 'array' then continue; end if;
    v_ev := x->>0; v_k := coalesce(x->>1, '');
    v_n := case when jsonb_typeof(x->2) = 'number' then least(greatest((x->>2)::numeric, 1), 50)::int else 1 end;
    if v_ev is null or v_ev not in ('visit', 'new', 'start', 'party', 'drops', 'song', 'share', 'ytlist', 'hide', 'install') then continue; end if;
    if v_k !~ '^[A-Za-z0-9_+./:-]{0,64}$' then v_k := '?'; end if;
    v_day := case when v_ev = 'song' then date_trunc('week', now() at time zone 'utc')::date else (now() at time zone 'utc')::date end;
    if not exists (select 1 from public.stats s where s.day = v_day and s.ev = v_ev and s.k = v_k)
       and (select count(*) from public.stats s where s.day = v_day and s.ev = v_ev) >= (case when v_ev = 'song' then 3000 else 300 end) then
      v_k := '?'; -- made-up keys can't fill the table
    end if;
    insert into public.stats as s (day, ev, k, n) values (v_day, v_ev, v_k, v_n)
      on conflict (day, ev, k) do update set n = s.n + excluded.n;
    cnt := cnt + 1;
  end loop;
  return cnt;
end $$;
revoke execute on function public.tally(jsonb) from public;

grant select on public.meta to anon, authenticated;
grant select on public.stats to authenticated;
grant execute on function public.catalog_stamp(), public.catalog() to anon, authenticated;
grant execute on function public.tally(jsonb) to anon, authenticated;

-- Suju's TikTok handle is @suzupah (the video's own page says so); the playlist said @sujupah.
update public.playlists set description = replace(description, '@sujupah', '@suzupah'), updated_at = now()
  where id = 'tiktok-og' and description like '%@sujupah%';

-- ---------- v40, 15 Nov 2026: your own playlists ----------
-- A Spotify playlist or album, read by the database from Spotify's public embed page (the first 100 tracks), since a browser can't.
-- POST /rest/v1/rpc/spotify_list {"sid": "<22 letters and digits>", "kind": "playlist"} → {"name": "...", "tracks": [{"t", "a", "ms"}]}
create or replace function public.spotify_list(sid text, kind text default 'playlist') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare res record; body text; e jsonb;
begin
  if kind not in ('playlist', 'album') or sid !~ '^[A-Za-z0-9]{22}$' then raise exception 'not a Spotify playlist or album'; end if;
  select r.status, r.content into res from extensions.http_get('https://open.spotify.com/embed/' || kind || '/' || sid) r;
  if res.status is distinct from 200 then raise exception 'Spotify answered %', res.status; end if;
  body := substring(res.content from '<script id="__NEXT_DATA__" type="application/json">(.*?)</script>');
  if body is null then raise exception 'no track list on that page'; end if;
  e := body::jsonb #> '{props,pageProps,state,data,entity}';
  return jsonb_build_object('name', coalesce(e->>'name', e->>'title'),
    'tracks', coalesce((select jsonb_agg(jsonb_build_object('t', x->>'title', 'a', x->>'subtitle', 'ms', x->'duration'))
                        from jsonb_array_elements(coalesce(e->'trackList', '[]'::jsonb)) x), '[]'::jsonb));
end $$;

-- Songs people's playlists are waiting for (from YouTube, Spotify or a typed list), sorted by what the phone found on LRCLIB:
-- auto (timed Nepali lyrics: Add many can take it, given an upload), timing (untimed lyrics: Time the lines) or tagging (no lyrics).
-- Each phone asks once per song; the same song asked again counts again. Only editors read them (Studio › Requests).
create table if not exists public.wishes (
  k         text primary key,                   -- lrc:<LRCLIB id>, yt:<video> or q:<title|artist>
  title     text not null,
  artist    text,
  kind      text check (kind in ('auto', 'timing', 'tagging')),
  lrclib_id bigint,
  len       numeric,                            -- the LRCLIB version's length in seconds
  yt        text check (yt ~ '^[A-Za-z0-9_-]{11}$'), -- the upload in their YouTube playlist, if it came from one
  src       text check (src in ('yt', 'sp', 'text')),
  asks      int not null default 1,
  first_at  timestamptz not null default now(),
  last_at   timestamptz not null default now(),
  done      text check (done in ('added', 'skipped')),
  done_at   timestamptz
);
alter table public.wishes enable row level security;
drop policy if exists "editors read wishes" on public.wishes;
create policy "editors read wishes" on public.wishes for select to authenticated using (public.is_editor());
drop policy if exists "editors edit wishes" on public.wishes;
create policy "editors edit wishes" on public.wishes for all to authenticated using (public.is_editor()) with check (public.is_editor());

-- POST /rest/v1/rpc/wish_songs {"w": [{"t": "Title", "a": "Artist", "kind": "auto", "lrc": 123, "len": 201.5, "yt": "...", "src": "sp"}]}
create or replace function public.wish_songs(w jsonb) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare n int;
begin
  if jsonb_typeof(w) is distinct from 'array' or jsonb_array_length(w) > 200 then raise exception 'send a list of at most 200 songs'; end if;
  insert into public.wishes as x (k, title, artist, kind, lrclib_id, len, yt, src)
  select distinct on (k) k, t, a, kind, lrc, len, yt, src from (
    select case when (v->>'lrc') ~ '^[0-9]{1,12}$' then 'lrc:' || (v->>'lrc')
                when (v->>'yt') ~ '^[A-Za-z0-9_-]{11}$' then 'yt:' || (v->>'yt')
                else 'q:' || left(lower(btrim(v->>'t')) || '|' || lower(btrim(coalesce(v->>'a', ''))), 200) end as k,
      left(btrim(v->>'t'), 200) as t, left(nullif(btrim(v->>'a'), ''), 200) as a,
      case when v->>'kind' in ('auto', 'timing', 'tagging') then v->>'kind' end as kind,
      case when (v->>'lrc') ~ '^[0-9]{1,12}$' then (v->>'lrc')::bigint end as lrc,
      case when jsonb_typeof(v->'len') = 'number' then round((v->>'len')::numeric, 1) end as len,
      case when (v->>'yt') ~ '^[A-Za-z0-9_-]{11}$' then v->>'yt' end as yt,
      case when v->>'src' in ('yt', 'sp', 'text') then v->>'src' end as src
    from jsonb_array_elements(w) v
    where jsonb_typeof(v) = 'object' and nullif(btrim(v->>'t'), '') is not null) s
  where not exists (select 1 from public.songs so where so.lrclib_id = s.lrc)   -- already in Jhapat (or a draft on its way)
    and not exists (select 1 from public.videos vi where vi.yt = s.yt)
  on conflict (k) do update set asks = x.asks + 1, last_at = now(), kind = coalesce(excluded.kind, x.kind),
    lrclib_id = coalesce(excluded.lrclib_id, x.lrclib_id), len = coalesce(excluded.len, x.len), yt = coalesce(x.yt, excluded.yt);
  get diagnostics n = row_count;
  return n;
end $$;

-- A typed list someone shared: kept so its link (#list=<id>) opens it on any phone. Only the songs' names and artists.
create table if not exists public.lists (
  id         text primary key default substr(md5(random()::text || clock_timestamp()::text), 1, 10),
  name       text not null,
  items      jsonb not null,                    -- [{"t": "Title", "a": "Artist"}], at most 300
  created_at timestamptz not null default now(),
  opened_at  timestamptz,
  opens      int not null default 0
);
alter table public.lists enable row level security;
drop policy if exists "editors read lists" on public.lists;
create policy "editors read lists" on public.lists for select to authenticated using (public.is_editor());

-- POST /rest/v1/rpc/save_list {"l": {"name": "Wedding night", "items": [{"t": "...", "a": "..."}]}} → its id
create or replace function public.save_list(l jsonb) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare lid text; its jsonb;
begin
  if jsonb_typeof(l) is distinct from 'object' or jsonb_typeof(l->'items') is distinct from 'array'
     or jsonb_array_length(l->'items') = 0 or jsonb_array_length(l->'items') > 300 then raise exception 'send a list of 1 to 300 songs'; end if;
  if (select count(*) from public.lists where created_at > now() - interval '1 hour') >= 300 then raise exception 'too many lists this hour; try again later'; end if;
  select jsonb_agg(jsonb_build_object('t', left(btrim(v->>'t'), 200), 'a', left(btrim(coalesce(v->>'a', '')), 200)))
    into its from jsonb_array_elements(l->'items') v where jsonb_typeof(v) = 'object' and nullif(btrim(v->>'t'), '') is not null;
  if its is null then raise exception 'no songs in that list'; end if;
  insert into public.lists (name, items) values (left(coalesce(nullif(btrim(l->>'name'), ''), 'My list'), 80), its) returning id into lid;
  return lid;
end $$;
-- POST /rest/v1/rpc/get_list {"lid": "..."} → {"id", "name", "items"}, or null
create or replace function public.get_list(lid text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare r record;
begin
  update public.lists set opens = opens + 1, opened_at = now() where id = lid returning name, items into r;
  if not found then return null; end if;
  return jsonb_build_object('id', lid, 'name', r.name, 'items', r.items);
end $$;

-- tally() as in v39, taking "list" too (a playlist made on a phone, by source, or opened from a link)
create or replace function public.tally(e jsonb) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare x jsonb; v_ev text; v_k text; v_n int; v_day date; cnt int := 0;
begin
  if jsonb_typeof(e) is distinct from 'array' or jsonb_array_length(e) > 40 then raise exception 'send at most 40 events'; end if;
  for x in select value from jsonb_array_elements(e) loop
    if jsonb_typeof(x) is distinct from 'array' then continue; end if;
    v_ev := x->>0; v_k := coalesce(x->>1, '');
    v_n := case when jsonb_typeof(x->2) = 'number' then least(greatest((x->>2)::numeric, 1), 50)::int else 1 end;
    if v_ev is null or v_ev not in ('visit', 'new', 'start', 'party', 'drops', 'song', 'share', 'ytlist', 'list', 'hide', 'install') then continue; end if;
    if v_k !~ '^[A-Za-z0-9_+./:-]{0,64}$' then v_k := '?'; end if;
    v_day := case when v_ev = 'song' then date_trunc('week', now() at time zone 'utc')::date else (now() at time zone 'utc')::date end;
    if not exists (select 1 from public.stats s where s.day = v_day and s.ev = v_ev and s.k = v_k)
       and (select count(*) from public.stats s where s.day = v_day and s.ev = v_ev) >= (case when v_ev = 'song' then 3000 else 300 end) then
      v_k := '?';
    end if;
    insert into public.stats as s (day, ev, k, n) values (v_day, v_ev, v_k, v_n)
      on conflict (day, ev, k) do update set n = s.n + excluded.n;
    cnt := cnt + 1;
  end loop;
  return cnt;
end $$;

revoke execute on function public.spotify_list(text, text), public.wish_songs(jsonb), public.save_list(jsonb), public.get_list(text), public.tally(jsonb) from public;
grant execute on function public.spotify_list(text, text), public.wish_songs(jsonb), public.save_list(jsonb), public.get_list(text), public.tally(jsonb) to anon, authenticated;
grant select on public.wishes, public.lists to authenticated;
grant update on public.wishes to authenticated;

-- ---------- v42, 15 Nov 2026: big-screen mode ----------
-- A TV (jhapat.live with 📺 TV on) and the phones that drive it talk through Supabase Realtime broadcast on the channel
-- jhapat-tv-<four-letter code>: messages pass straight through and nothing is stored, so no table is needed (public channels,
-- the publishable key). tally() as in v40, taking "tv" too: k = start when big-screen mode is turned on, phone when a phone joins.
create or replace function public.tally(e jsonb) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare x jsonb; v_ev text; v_k text; v_n int; v_day date; cnt int := 0;
begin
  if jsonb_typeof(e) is distinct from 'array' or jsonb_array_length(e) > 40 then raise exception 'send at most 40 events'; end if;
  for x in select value from jsonb_array_elements(e) loop
    if jsonb_typeof(x) is distinct from 'array' then continue; end if;
    v_ev := x->>0; v_k := coalesce(x->>1, '');
    v_n := case when jsonb_typeof(x->2) = 'number' then least(greatest((x->>2)::numeric, 1), 50)::int else 1 end;
    if v_ev is null or v_ev not in ('visit', 'new', 'start', 'party', 'drops', 'song', 'share', 'ytlist', 'list', 'hide', 'install', 'tv') then continue; end if;
    if v_k !~ '^[A-Za-z0-9_+./:-]{0,64}$' then v_k := '?'; end if;
    v_day := case when v_ev = 'song' then date_trunc('week', now() at time zone 'utc')::date else (now() at time zone 'utc')::date end;
    if not exists (select 1 from public.stats s where s.day = v_day and s.ev = v_ev and s.k = v_k)
       and (select count(*) from public.stats s where s.day = v_day and s.ev = v_ev) >= (case when v_ev = 'song' then 3000 else 300 end) then
      v_k := '?';
    end if;
    insert into public.stats as s (day, ev, k, n) values (v_day, v_ev, v_k, v_n)
      on conflict (day, ev, k) do update set n = s.n + excluded.n;
    cnt := cnt + 1;
  end loop;
  return cnt;
end $$;
revoke execute on function public.tally(jsonb) from public;
grant execute on function public.tally(jsonb) to anon, authenticated;
