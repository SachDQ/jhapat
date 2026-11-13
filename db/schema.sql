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
  updated_at   timestamptz not null default now()
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

-- keep updated_at current
create or replace function public.touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists songs_touch on public.songs;
create trigger songs_touch before update on public.songs for each row execute function public.touch();
drop trigger if exists playlists_touch on public.playlists;
create trigger playlists_touch before update on public.playlists for each row execute function public.touch();

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

grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.playlist_bundle(text), public.is_editor() to anon, authenticated;
