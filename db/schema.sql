-- Jhapat database: items, songs with timed lyrics, YouTube uploads, word tags and playlists.
-- Anyone can read what the party player needs. Only accounts listed in public.editors can change anything.
-- Tag times are on the lyrics' timeline; each upload stores offset_s (video time = lyric time + offset_s).

create table if not exists public.items (
  id         text primary key check (id ~ '^[a-z0-9-]+$'),
  name       text not null,
  dev        text,                                -- the name in Devanagari
  emoji      text,                                -- shown on the item's chip, e.g. 💧
  words      text[] not null default '{}',        -- every spelling that counts, roman and Devanagari
  note       text,                                -- the prop to put out, e.g. "an envelope"
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

-- ---------- v45, 16 Nov 2026: the table's order ----------
-- ease: how easy an item's prop is to find at home, 1 (has to be made, or few homes have it) to 5 (every home, at hand).
-- The player ranks a playlist's items by both: the square root of its share of the top item's songs (songs with a drop point
-- for it), times ease / 5. The top five go on for a phone's first table. sort is the same rank over all songs, for the
-- studio's tiles and the Tips page. Props were rewritten so no two items share one and nothing is glass, hot or precious.
alter table public.items add column if not exists ease smallint not null default 3 check (ease between 1 and 5);
update public.items i set ease = v.ease, note = v.note, sort = v.sort
from (values
  ('maya', 3, 'a heart: a card, a sticker or one drawn on paper', 0),
  ('sapana', 5, 'a pillow', 1),
  ('aankha', 4, 'sunglasses or glasses', 2),
  ('phool', 4, 'a flower, real or plastic', 3),
  ('ghar', 5, 'a key', 4),
  ('khushi', 4, 'a sweet or a chocolate', 5),
  ('raat', 4, 'a torch', 6),
  ('mutu', 3, 'a red apple', 7),
  ('paani', 5, 'a bottle of water, cap on', 8),
  ('bato', 4, 'a shoe or a chappal', 9),
  ('sansar', 3, 'a ball', 10),
  ('samaya', 4, 'a watch', 11),
  ('jun', 4, 'a round biscuit', 12),
  ('geet', 4, 'earphones or headphones', 13),
  ('aansu', 4, 'a tissue', 14),
  ('haat', 3, 'a glove', 15),
  ('ohth', 4, 'a lipstick or lip balm', 16),
  ('kesh', 5, 'a comb', 17),
  ('hawa', 3, 'a hand fan', 18),
  ('paisa', 5, 'a coin or a note', 19),
  ('ghaam', 3, 'a lemon, or anything yellow', 20),
  ('jhari', 4, 'an umbrella, folded', 21),
  ('aago', 4, 'a matchbox', 22),
  ('aakash', 2, 'a balloon or a kite', 23),
  ('chithi', 4, 'an envelope', 24),
  ('photo', 3, 'a printed photo', 25),
  ('naam', 2, 'a name written on a card', 26),
  ('rumal', 4, 'a handkerchief', 27),
  ('badal', 2, 'cotton wool', 28),
  ('tara', 2, 'a star sticker or a paper star', 29),
  ('phone', 4, 'an old phone or the TV remote', 30),
  ('chiya', 5, 'an empty tea cup', 31),
  ('chari', 2, 'a shuttlecock or a feather', 32),
  ('batti', 4, 'a candle, unlit', 33),
  ('chura', 3, 'a bangle', 34),
  ('topi', 4, 'a topi or any cap', 35),
  ('rakshi', 2, 'an empty can', 36),
  ('aunthi', 3, 'a ring', 37)
) as v(id, ease, note, sort)
where i.id = v.id;
-- प्रेमपत्र (a love letter) is a letter: Chithi lists it, and Maya's प्रेम no longer catches it whatever the order.
update public.items set words = array_append(words, '-प्रेमपत्र') where id = 'maya' and not ('-प्रेमपत्र' = any(words));

-- catalog() as in v39, with each item's ease
create or replace function public.catalog() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'stamp', (select m.v from public.meta m where m.k = 'catalog'),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'dev', i.dev, 'note', i.note, 'emoji', i.emoji, 'ease', i.ease) order by i.sort, i.id), '[]'::jsonb)
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
grant execute on function public.catalog() to anon, authenticated;

-- ---------- v47 (16 Nov): starter items, and two playlists at the bottom ----------
-- Sachin's picks lead every table, in this order, and a new phone's first table turns them on: Phool, Paani, Samaya, Maya,
-- Sapana and Aansu. The player puts them first wherever a playlist has songs for them, then ranks the rest by songs × ease (v45).
alter table public.items add column if not exists starter smallint check (starter between 1 and 99); -- null: not a starter
update public.items set starter = null where starter is not null and id not in ('phool', 'paani', 'samaya', 'maya', 'sapana', 'aansu');
update public.items i set starter = v.k from (values ('phool', 1), ('paani', 2), ('samaya', 3), ('maya', 4), ('sapana', 5), ('aansu', 6)) as v(id, k)
where i.id = v.id and i.starter is distinct from v.k;
-- items.sort (the studio's tiles, the Tips page): the starters first, then the v45 rank
with r as (select id, (row_number() over (order by starter nulls last, sort, id) - 1)::int as k from public.items)
update public.items i set sort = r.k from r where i.id = r.id and i.sort is distinct from r.k;
-- A playlist sorted 100 or more sits under All songs, at the bottom of the list (Make your own and the phone's own come after).
update public.playlists set sort = 100 where id = 'dohori' and sort <> 100;
update public.playlists set sort = 101 where id = 'tiktok-og' and sort <> 101;

-- catalog() as in v45, with each item's starter and each playlist's sort
create or replace function public.catalog() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'stamp', (select m.v from public.meta m where m.k = 'catalog'),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'dev', i.dev, 'note', i.note, 'emoji', i.emoji, 'ease', i.ease, 'starter', i.starter) order by i.sort, i.id), '[]'::jsonb)
              from public.items i),
    'songs', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', s.id, 'title', s.title, 'artist', s.artist,
                'videos', (select coalesce(jsonb_agg(jsonb_build_object('yt', v.yt, 'offset', v.offset_s, 'synced', v.synced) order by v.rank, v.id), '[]'::jsonb)
                           from public.videos v where v.song_id = s.id and v.embeddable),
                'tags', (select coalesce(jsonb_agg(jsonb_build_array(t.item_id, t.t, t.rep) order by t.t), '[]'::jsonb) -- [item, lyric time, repeat group]
                         from public.tags t where t.song_id = s.id)
              ) order by s.title, s.id), '[]'::jsonb)
              from public.songs s where s.status <> 'draft'),
    'playlists', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description, 'sort', p.sort,
                'songs', (select coalesce(jsonb_agg(ps.song_id order by ps.position, ps.song_id), '[]'::jsonb)
                          from public.playlist_songs ps join public.songs s on s.id = ps.song_id and s.status <> 'draft'
                          where ps.playlist_id = p.id)
              ) order by p.sort, p.name), '[]'::jsonb)
              from public.playlists p where p.owner is null and p.is_public));
$$;
grant execute on function public.catalog() to anon, authenticated;

-- ---------- v48 (16 Nov): the first table is five of Sachin's picks; the top of the list stays his six ----------
-- Sachin: "have paani, maya, phool, bato, samaya be the default selected so people can easily start". A new phone's first table
-- turns on items.default_on (Paani, Maya, Phool, Bato, Samaya), and those lead every table. items.pin (v47's starter, renamed)
-- keeps his six at the top of the list in their order (Phool, Paani, Samaya, Maya, Sapana, Aansu), so Sapana and Aansu come right
-- after the five.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'items' and column_name = 'starter')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'items' and column_name = 'pin') then
    alter table public.items rename column starter to pin;
  end if;
end $$;
alter table public.items add column if not exists default_on boolean not null default false;
update public.items set default_on = (id in ('paani', 'maya', 'phool', 'bato', 'samaya'))
where default_on is distinct from (id in ('paani', 'maya', 'phool', 'bato', 'samaya'));
-- items.sort (the studio's tiles, the Tips page): the first table (pinned ones by pin, then by the v45 rank), the other pinned, the rest
with r as (select id, (row_number() over (order by (case when default_on then 0 when pin is not null then 1 else 2 end), coalesce(pin, 999), sort, id) - 1)::int as k
           from public.items)
update public.items i set sort = r.k from r where i.id = r.id and i.sort is distinct from r.k;

-- catalog() as in v47, with each item's pin and default_on (in place of starter)
create or replace function public.catalog() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'stamp', (select m.v from public.meta m where m.k = 'catalog'),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'dev', i.dev, 'note', i.note, 'emoji', i.emoji, 'ease', i.ease, 'pin', i.pin, 'default_on', i.default_on) order by i.sort, i.id), '[]'::jsonb)
              from public.items i),
    'songs', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', s.id, 'title', s.title, 'artist', s.artist,
                'videos', (select coalesce(jsonb_agg(jsonb_build_object('yt', v.yt, 'offset', v.offset_s, 'synced', v.synced) order by v.rank, v.id), '[]'::jsonb)
                           from public.videos v where v.song_id = s.id and v.embeddable),
                'tags', (select coalesce(jsonb_agg(jsonb_build_array(t.item_id, t.t, t.rep) order by t.t), '[]'::jsonb) -- [item, lyric time, repeat group]
                         from public.tags t where t.song_id = s.id)
              ) order by s.title, s.id), '[]'::jsonb)
              from public.songs s where s.status <> 'draft'),
    'playlists', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description, 'sort', p.sort,
                'songs', (select coalesce(jsonb_agg(ps.song_id order by ps.position, ps.song_id), '[]'::jsonb)
                          from public.playlist_songs ps join public.songs s on s.id = ps.song_id and s.status <> 'draft'
                          where ps.playlist_id = p.id)
              ) order by p.sort, p.name), '[]'::jsonb)
              from public.playlists p where p.owner is null and p.is_public));
$$;
grant execute on function public.catalog() to anon, authenticated;

-- ---------- v50 (17 Nov 2026): live counts by the minute, more anonymous details, and Telegram alerts ----------
-- Sachin: "add a live last-hour view… as many details as we could track… what should we be live notified for on Telegram".
-- Still anonymous: no account, no ID for a phone, nothing typed. New events from the player (short keys):
--   ping  once a minute while Jhapat is open and on screen (k: play while a song plays, else idle): phones open now, minutes played
--   from  where a page open came from (tiktok, instagram, facebook, messenger, whatsapp, google, youtube, qr, share, direct, other…)
--   dev   once a day: the kind of phone and browser (iphone-safari, android-chrome, iphone-tiktok…)
--   lang  once a day: the phone's language (ne, en, hi…)
--   ret   once a day, for a phone that has been before: days since its last visit (1d, 2-7d, 8-30d, 31d+)
--   act   a tap on a feature (show, replay, pause, switch, pick, howto, letsgo, report, settings, more, stay, reset, fullscreen, sound-on, sound-off, tips)
--   item  an item turned on by a tap (its id)
--   night a night reaching 10, 25, 50 or 100 drops
--   err   something that went wrong on the phone (yt-<code>, catalog)
--   speed how long until the songs were ready (0-1s, 1-2s, 2-4s, 4-8s, 8s+)
--   tz    the phone's time zone with each batch, for the alerts only (never stored)
-- stats_min keeps the same counts by the minute for 8 days (Studio › Stats › Live, and the alerts); stats keeps the days.
create table if not exists public.stats_min (
  at timestamptz not null, -- the minute
  ev text not null,
  k  text not null default '',
  n  bigint not null default 0,
  primary key (at, ev, k)
);
alter table public.stats_min enable row level security;
drop policy if exists "editors read stats_min" on public.stats_min;
create policy "editors read stats_min" on public.stats_min for select to authenticated using (public.is_editor());
revoke all on public.stats_min from anon;
grant select on public.stats_min to authenticated;

-- Telegram alerts live in their own schema, which the website's API can't reach. The bot's token is in Supabase Vault as
-- jhapat_tg_token (Sachin pastes it himself); alerts.tg keeps the chat, which alerts.link() finds once he has pressed Start in the bot.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create schema if not exists alerts;
revoke all on schema alerts from public, anon, authenticated;
create table if not exists alerts.tg (
  id        int primary key default 1 check (id = 1),
  chat_id   bigint,
  who       text,
  tz        text not null default 'Australia/Melbourne', -- Sachin's day, for "today" in the alerts
  muted     boolean not null default false,
  linked_at timestamptz
);
insert into alerts.tg (id) values (1) on conflict do nothing;
create table if not exists alerts.log ( -- what was sent: for "once ever", "once an hour" and the 40-an-hour cap
  id   bigint generated always as identity primary key,
  at   timestamptz not null default now(),
  kind text not null,
  key  text,
  msg  text
);
create index if not exists alerts_log_kind_idx on alerts.log (kind, key);
create index if not exists alerts_log_at_idx on alerts.log (at);
create table if not exists alerts.health ( -- the check of jhapat.live every 10 minutes
  id         int primary key default 1 check (id = 1),
  req        bigint, -- the last request (pg_net)
  fails      int not null default 0,
  down_since timestamptz
);
insert into alerts.health (id) values (1) on conflict do nothing;

create or replace function alerts.esc(t text) returns text language sql immutable set search_path = '' as $$
  select replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') $$;
create or replace function alerts.day0() returns timestamptz language sql stable set search_path = '' as $$
  select date_trunc('day', now() at time zone t.tz) at time zone t.tz from alerts.tg t where t.id = 1 $$;
-- Words for the keys: where from, which phone, which playlist
create or replace function alerts.label(p_ev text, p_k text) returns text language sql stable set search_path = '' as $$
  select alerts.esc(case
    when p_k is null then null
    when p_ev = 'from' then coalesce(jsonb_build_object('direct', 'typed the address', 'tiktok', 'TikTok', 'instagram', 'Instagram', 'facebook', 'Facebook',
      'messenger', 'Messenger', 'whatsapp', 'WhatsApp', 'viber', 'Viber', 'google', 'Google', 'search', 'a search', 'youtube', 'YouTube', 'x', 'X',
      'reddit', 'Reddit', 'qr', 'the QR code', 'share', 'a shared link', 'other', 'another site') ->> p_k, p_k)
    when p_ev = 'dev' then coalesce(jsonb_build_object('iphone', 'iPhone', 'ipad', 'iPad', 'android', 'Android', 'mac', 'Mac', 'windows', 'Windows',
      'chromebook', 'Chromebook', 'linux', 'Linux', 'tv', 'TV') ->> split_part(p_k, '-', 1), split_part(p_k, '-', 1)) || ', ' ||
      coalesce(jsonb_build_object('safari', 'Safari', 'chrome', 'Chrome', 'firefox', 'Firefox', 'edge', 'Edge', 'samsung', 'Samsung Internet', 'opera', 'Opera',
      'brave', 'Brave', 'ddg', 'DuckDuckGo', 'tiktok', 'in TikTok', 'instagram', 'in Instagram', 'facebook', 'in Facebook', 'messenger', 'in Messenger')
      ->> split_part(p_k, '-', 2), split_part(p_k, '-', 2))
    when p_ev = 'pl' then case p_k when 'all' then 'All songs' when 'yt' then 'their own playlist' when 'seed' then 'the built-in songs'
      else coalesce((select p.name from public.playlists p where p.id = p_k), p_k) end
    else p_k end) $$;

-- Sends one message. A key sends it once ever for its kind; at most 40 an hour (the digest aside), so a flood waits for the digest.
create or replace function alerts.send(p_msg text, p_kind text default 'note', p_key text default null) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_tok text; v_chat bigint;
begin
  select t.chat_id into v_chat from alerts.tg t where t.id = 1 and not t.muted;
  if v_chat is null then return false; end if;
  if p_key is not null and exists (select 1 from alerts.log l where l.kind = p_kind and l.key = p_key) then return false; end if;
  if p_kind <> 'digest' and (select count(*) from alerts.log l where l.at > now() - interval '1 hour') >= 40 then return false; end if;
  select s.decrypted_secret into v_tok from vault.decrypted_secrets s where s.name = 'jhapat_tg_token';
  if v_tok is null then return false; end if;
  perform net.http_post(url := 'https://api.telegram.org/bot' || v_tok || '/sendMessage',
    body := jsonb_build_object('chat_id', v_chat, 'text', p_msg, 'parse_mode', 'HTML', 'disable_web_page_preview', true));
  insert into alerts.log (kind, key, msg) values (p_kind, p_key, left(p_msg, 1000));
  return true;
end $$;

-- After each batch of counts from a phone: new phones, a rush, a first place, parties, long nights, big screen, home screen,
-- own playlists, phones that can't load the songs, and milestones. Quick to skip when there's nothing to say.
create or replace function alerts.on_tally(seen jsonb, p_tz text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v jsonb; v_ev text; v_k text; v_n int; d0 timestamptz; c bigint; m int; v_from text; v_dev text; v_pl text; tzl text;
begin
  if not exists (select 1 from jsonb_array_elements(seen) x where x->>0 in ('new', 'visit', 'party', 'night', 'tv', 'install', 'list', 'err')) then return; end if;
  if not exists (select 1 from alerts.tg t where t.id = 1 and t.chat_id is not null and not t.muted) then return; end if;
  d0 := alerts.day0();
  select x->>1 into v_from from jsonb_array_elements(seen) x where x->>0 = 'from' limit 1;
  select x->>1 into v_dev from jsonb_array_elements(seen) x where x->>0 = 'dev' limit 1;
  select x->>1 into v_pl from jsonb_array_elements(seen) x where x->>0 = 'drops' limit 1;
  tzl := case when coalesce(p_tz, '') = '' then '' else ' · 🕐 ' || alerts.esc(p_tz) end;
  for v in select value from jsonb_array_elements(seen) loop
    v_ev := v->>0; v_k := coalesce(v->>1, ''); v_n := coalesce((v->>2)::int, 1);
    if v_ev = 'new' then
      select coalesce(sum(s.n), 0) into c from public.stats_min s where s.ev = 'new' and s.at >= d0;
      if c <= 20 or c in (25, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000) or (c > 1000 and c % 500 = 0) then
        perform alerts.send('🆕 New phone · ' || case when c > 1 then c || ' today' else 'first today' end || coalesce(' · ' || alerts.label('dev', v_dev), '')
          || coalesce(' · from ' || alerts.label('from', coalesce(nullif(v_k, ''), v_from)), '') || tzl, 'new');
      end if;
      select coalesce(sum(s.n), 0) into c from public.stats_min s where s.ev = 'new' and s.at > now() - interval '15 minutes';
      if c >= 8 and not exists (select 1 from alerts.log l where l.kind = 'rush' and l.at > now() - interval '1 hour') then
        perform alerts.send('🚀 <b>Rush:</b> ' || c || ' new phones in the last 15 minutes' || coalesce(', mostly from ' || (select alerts.label('from', s.k) from public.stats_min s
          where s.ev = 'from' and s.at > now() - interval '15 minutes' group by s.k order by sum(s.n) desc limit 1), ''), 'rush');
      end if;
      select coalesce(sum(s.n), 0) into c from public.stats s where s.ev = 'new';
      m := (select max(x) from unnest(array[50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000]) x where x <= c);
      if m is not null then perform alerts.send('🎉 <b>' || to_char(m, 'FM999,999') || ' phones</b> have opened Jhapat', 'milestone', 'new:' || m); end if;
    elsif v_ev = 'visit' and v_k not in ('', '?') then
      select coalesce(sum(s.n), 0) into c from public.stats s where s.ev = 'visit' and s.k = v_k;
      if c <= v_n then perform alerts.send('🌏 First phone ever from ' || alerts.esc(v_k), 'place', v_k); end if;
    elsif v_ev = 'party' then
      select coalesce(sum(s.n), 0) into c from public.stats_min s where s.ev = 'party' and s.at >= d0;
      if c <= 30 or c % 10 = 0 then perform alerts.send('🔥 Party on! ' || alerts.label('pl', v_k) || ' hit 5 drops · ' || c || ' part' || case when c = 1 then 'y' else 'ies' end || ' today' || tzl, 'party'); end if;
      select coalesce(sum(s.n), 0) into c from public.stats s where s.ev = 'party';
      m := (select max(x) from unnest(array[10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]) x where x <= c);
      if m is not null then perform alerts.send('🏆 <b>' || to_char(m, 'FM999,999') || ' parties</b> played on Jhapat', 'milestone', 'party:' || m); end if;
    elsif v_ev = 'night' and v_k in ('25', '50', '100') then
      perform alerts.send('🐯 A party just reached ' || v_k || ' drops' || coalesce(' on ' || alerts.label('pl', v_pl), '') || tzl, 'night');
    elsif v_ev = 'tv' and v_k = 'start' then
      perform alerts.send('📺 Someone turned on big-screen mode' || tzl, 'tv');
    elsif v_ev = 'install' then
      perform alerts.send('📲 Jhapat was added to a home screen' || coalesce(' · ' || alerts.label('dev', v_dev), '') || tzl, 'install');
    elsif v_ev = 'list' and v_k in ('yt', 'sp', 'text') then
      perform alerts.send('🎵 Someone made their own playlist from ' || case v_k when 'yt' then 'YouTube' when 'sp' then 'Spotify' else 'a typed list' end || tzl, 'list');
    elsif v_ev = 'err' and v_k = 'catalog' then
      select coalesce(sum(s.n), 0) into c from public.stats_min s where s.ev = 'err' and s.k = 'catalog' and s.at > now() - interval '15 minutes';
      if c >= 3 and not exists (select 1 from alerts.log l where l.kind = 'err' and l.at > now() - interval '1 hour') then
        perform alerts.send('⚠️ ' || c || ' phones couldn’t load the songs in the last 15 minutes. Is Supabase up?', 'err');
      end if;
    end if;
  end loop;
end $$;

-- A report from the player: people's own right away; an upload that won't play once a day per upload.
create or replace function alerts.on_report() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_title text; v_artist text;
begin
  select s.title, s.artist into v_title, v_artist from public.songs s where s.id = new.song_id;
  if new.kind = 'video' or coalesce(new.note, '') like '%(sent by the player)' then
    perform alerts.send('🎬 An upload won’t play: <b>' || alerts.esc(coalesce(v_title, new.song_id)) || '</b>' || coalesce(' · ' || alerts.esc(v_artist), '')
      || coalesce(' · youtu.be/' || new.yt, '') || chr(10) || 'The player skips it. https://jhapat.live/studio/#reports',
      'upload', coalesce(new.yt, new.song_id) || ':' || to_char(now(), 'YYYY-MM-DD'));
  else
    perform alerts.send('🚩 <b>Report:</b> ' || case new.kind when 'soon' then 'word came too soon' when 'late' then 'word came late' when 'word' then 'wrong word'
      when 'unsung' then 'word not sung' else 'something else' end || ' · <b>' || alerts.esc(coalesce(v_title, new.song_id)) || '</b>' || coalesce(' · ' || alerts.esc(v_artist), '')
      || coalesce(' · ' || alerts.esc(new.item_id), '') || coalesce(' at ' || to_char(make_interval(secs => new.t::double precision), 'FMMI:SS'), '')
      || coalesce(chr(10) || '“' || alerts.esc(left(new.note, 300)) || '”', '') || chr(10) || 'https://jhapat.live/studio/#reports', 'report');
  end if;
  return null;
exception when others then return null; -- an alert never stops a report
end $$;
drop trigger if exists reports_alert on public.reports;
create trigger reports_alert after insert on public.reports for each row execute function alerts.on_report();

-- Every morning (22:00 UTC: 9 am in Melbourne in summer, 8 am in winter): the last 24 hours.
create or replace function alerts.digest() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare a timestamptz := now() - interval '24 hours'; msg text; ph bigint; nw bigint; st bigint; pa bigint; dr bigint; mi bigint; sh bigint; tvs bigint; ins bigint; li bigint; line text;
begin
  select coalesce(sum(s.n) filter (where s.ev = 'visit'), 0), coalesce(sum(s.n) filter (where s.ev = 'new'), 0), coalesce(sum(s.n) filter (where s.ev = 'start'), 0),
         coalesce(sum(s.n) filter (where s.ev = 'party'), 0), coalesce(sum(s.n) filter (where s.ev = 'drops'), 0), coalesce(sum(s.n) filter (where s.ev = 'ping' and s.k = 'play'), 0),
         coalesce(sum(s.n) filter (where s.ev = 'share' and s.k <> 'qr'), 0), coalesce(sum(s.n) filter (where s.ev = 'tv' and s.k = 'start'), 0),
         coalesce(sum(s.n) filter (where s.ev = 'install'), 0), coalesce(sum(s.n) filter (where s.ev = 'list'), 0)
    into ph, nw, st, pa, dr, mi, sh, tvs, ins, li from public.stats_min s where s.at >= a;
  if ph + nw + dr = 0 then
    msg := '☀️ <b>Jhapat, the last 24 hours:</b> quiet, no phones opened it.';
  else
    msg := '☀️ <b>Jhapat, the last 24 hours</b>' || chr(10) || '📱 ' || ph || ' phones, ' || nw || ' new' || chr(10)
      || '🎶 ' || st || ' nights started, ' || pa || ' parties, ' || dr || ' drops, ' || mi || ' minutes of music' || chr(10);
    select string_agg(alerts.label('from', q.k) || ' ' || q.n, ', ' order by q.n desc) into line from (select s.k, sum(s.n) n from public.stats_min s where s.at >= a and s.ev = 'from' group by s.k order by 2 desc limit 4) q;
    if line is not null then msg := msg || '🧭 Came from: ' || line || chr(10); end if;
    select string_agg(alerts.esc(q.k) || ' ' || q.n, ', ' order by q.n desc) into line from (select s.k, sum(s.n) n from public.stats_min s where s.at >= a and s.ev = 'visit' and s.k <> '' group by s.k order by 2 desc limit 4) q;
    if line is not null then msg := msg || '🌏 Where: ' || line || chr(10); end if;
    select string_agg(alerts.label('dev', q.k) || ' ' || q.n, ', ' order by q.n desc) into line from (select s.k, sum(s.n) n from public.stats_min s where s.at >= a and s.ev = 'dev' group by s.k order by 2 desc limit 3) q;
    if line is not null then msg := msg || '📲 On: ' || line || chr(10); end if;
    select string_agg(alerts.label('pl', q.k) || ' ' || q.n, ', ' order by q.n desc) into line from (select s.k, sum(s.n) n from public.stats_min s where s.at >= a and s.ev = 'drops' group by s.k order by 2 desc limit 3) q;
    if line is not null then msg := msg || '🎵 Drops by playlist: ' || line || chr(10); end if;
    if sh + tvs + ins + li > 0 then msg := msg || '✨ ' || sh || ' shares, ' || tvs || ' big screens, ' || ins || ' home screens, ' || li || ' own playlists' || chr(10); end if;
  end if;
  select count(*) into ph from public.reports r where r.fixed_at is null;
  if ph > 0 then msg := msg || chr(10) || '🚩 ' || ph || ' report' || case when ph = 1 then '' else 's' end || ' waiting'; end if;
  select count(*) into ph from public.wishes w where w.done is null and w.last_at >= a;
  if ph > 0 then msg := msg || chr(10) || '🙋 ' || ph || ' song' || case when ph = 1 then '' else 's' end || ' asked for'; end if;
  perform alerts.send(msg || chr(10) || 'https://jhapat.live/studio/#stats', 'digest', 'digest:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'));
end $$;

-- Every 10 minutes: is jhapat.live answering? Two misses in a row send an alert, and another when it's back. And the database's
-- free 500 MB: a warning past 400 MB, once a week.
create or replace function alerts.health() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare h record; v_code int; v_out boolean; v_err text; sz bigint;
begin
  select * into h from alerts.health where id = 1;
  if h.req is not null then
    select r.status_code, r.timed_out, r.error_msg into v_code, v_out, v_err from net._http_response r where r.id = h.req;
    if found then
      if v_code = 200 then
        if h.fails >= 2 then perform alerts.send('✅ jhapat.live is back up (down about ' || ceil(extract(epoch from now() - h.down_since) / 60) || ' minutes)', 'site'); end if;
        update alerts.health set fails = 0, down_since = null where id = 1;
      else
        update alerts.health set fails = fails + 1, down_since = coalesce(down_since, now()) where id = 1;
        if h.fails + 1 = 2 then perform alerts.send('🔴 jhapat.live isn’t loading (' || coalesce(v_code::text, case when v_out then 'timed out' else coalesce(v_err, 'no answer') end)
          || '). It’s checked every 10 minutes.', 'site'); end if;
      end if;
    end if;
  end if;
  update alerts.health set req = net.http_get(url := 'https://jhapat.live/version.json?check=' || floor(extract(epoch from now()))::bigint, timeout_milliseconds := 10000) where id = 1;
  sz := pg_database_size(current_database());
  if sz > 400 * 1048576 then perform alerts.send('💾 The database is at ' || round(sz / 1048576.0) || ' MB of the free 500 MB.', 'disk', to_char(now(), 'IYYY-IW')); end if;
end $$;

create or replace function alerts.clean() returns void language sql security definer set search_path = '' as $$
  delete from public.stats_min where at < now() - interval '8 days';
  delete from alerts.log where at < now() - interval '60 days' and kind not in ('milestone', 'place');
$$;

-- Run once Sachin has pressed Start in his bot: finds his chat in the bot's updates, keeps it, and says hello.
create or replace function alerts.link() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_tok text; v_status int; v_body text; m jsonb;
begin
  select s.decrypted_secret into v_tok from vault.decrypted_secrets s where s.name = 'jhapat_tg_token';
  if v_tok is null then return 'No token yet: paste it with vault.create_secret first'; end if;
  select r.status, r.content into v_status, v_body from extensions.http_get('https://api.telegram.org/bot' || v_tok || '/getUpdates') r;
  if v_status <> 200 then return 'Telegram answered ' || v_status || ': check the token'; end if;
  select u->'message' into m from jsonb_array_elements(v_body::jsonb->'result') u
    where u ? 'message' and u->'message'->'chat'->>'type' = 'private' order by (u->>'update_id')::bigint desc limit 1;
  if m is null then return 'No message yet: open the bot in Telegram, press Start, then run this again'; end if;
  update alerts.tg set chat_id = (m->'chat'->>'id')::bigint, who = m->'chat'->>'first_name', linked_at = now(), muted = false where id = 1;
  perform alerts.send('✅ <b>Jhapat alerts are on.</b>' || chr(10) || 'Right away: new phones (each of the first 20 a day, then milestones), a rush of 8+ new phones in 15 minutes, '
    || 'the first phone ever from a new place, every party (5 drops), parties reaching 25/50/100 drops, big screen, home-screen installs, own playlists, '
    || 'reports from players, uploads that won’t play, phones that can’t load the songs, jhapat.live down or back, the database filling up, and milestones.'
    || chr(10) || 'Every morning: the last 24 hours.', 'hello');
  return 'Linked to ' || coalesce(m->'chat'->>'first_name', 'the chat');
end $$;

revoke all on all tables in schema alerts from public, anon, authenticated;
revoke execute on all functions in schema alerts from public, anon, authenticated;
select cron.schedule('jhapat-health', '*/10 * * * *', 'select alerts.health()');
select cron.schedule('jhapat-digest', '0 22 * * *', 'select alerts.digest()');
select cron.schedule('jhapat-clean', '17 3 * * *', 'select alerts.clean()');

-- tally() as in v42, taking the new events, keeping a by-the-minute copy (songs aside), and telling the alerts.
create or replace function public.tally(e jsonb) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare x jsonb; v_ev text; v_k text; v_n int; v_day date; v_min timestamptz := date_trunc('minute', now()); cnt int := 0; v_tz text := ''; v_seen jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(e) is distinct from 'array' or jsonb_array_length(e) > 40 then raise exception 'send at most 40 events'; end if;
  for x in select value from jsonb_array_elements(e) loop
    if jsonb_typeof(x) is distinct from 'array' then continue; end if;
    v_ev := x->>0; v_k := coalesce(x->>1, '');
    if v_ev = 'tz' then v_tz := case when v_k ~ '^[A-Za-z0-9_+./:-]{0,64}$' then v_k else '' end; continue; end if; -- for the alerts, not stored
    v_n := case when jsonb_typeof(x->2) = 'number' then least(greatest((x->>2)::numeric, 1), 50)::int else 1 end;
    if v_ev is null or v_ev not in ('visit', 'new', 'start', 'party', 'drops', 'song', 'share', 'ytlist', 'list', 'hide', 'install', 'tv',
      'ping', 'from', 'dev', 'lang', 'ret', 'act', 'item', 'night', 'err', 'speed') then continue; end if;
    if v_k !~ '^[A-Za-z0-9_+./:-]{0,64}$' then v_k := '?'; end if;
    v_day := case when v_ev = 'song' then date_trunc('week', now() at time zone 'utc')::date else (now() at time zone 'utc')::date end;
    if not exists (select 1 from public.stats s where s.day = v_day and s.ev = v_ev and s.k = v_k)
       and (select count(*) from public.stats s where s.day = v_day and s.ev = v_ev) >= (case when v_ev = 'song' then 3000 else 300 end) then
      v_k := '?';
    end if;
    insert into public.stats as s (day, ev, k, n) values (v_day, v_ev, v_k, v_n)
      on conflict (day, ev, k) do update set n = s.n + excluded.n;
    if v_ev <> 'song' then
      insert into public.stats_min as s (at, ev, k, n) values (v_min, v_ev, v_k, v_n)
        on conflict (at, ev, k) do update set n = s.n + excluded.n;
    end if;
    v_seen := v_seen || jsonb_build_array(jsonb_build_array(v_ev, v_k, v_n));
    cnt := cnt + 1;
  end loop;
  begin perform alerts.on_tally(v_seen, v_tz); exception when others then null; end; -- an alert never stops a count
  return cnt;
end $$;
revoke execute on function public.tally(jsonb) from public;
grant execute on function public.tally(jsonb) to anon, authenticated;
