-- The 16 songs and 7 items that were built into the player, moved into the database.
begin;
insert into public.items (id, name, dev, words, note, sort) values
  ('paani', 'Paani', 'पानी', array['paani','pani','panima','पानी','पानि']::text[], null, 0),
  ('phool', 'Phool', 'फूल', array['phool','phul','ful','phulyo','fulyo','फूल','फुल']::text[], null, 1),
  ('chiya', 'Chiya', 'चिया', array['chiya','chiyabari','चिया']::text[], null, 2),
  ('paisa', 'Paisa', 'पैसा', array['paisa','paisaa','daam','पैसा','दाम']::text[], null, 3),
  ('chithi', 'Chithi', 'चिठी', array['chithi','chitthi','चिठी','चिठ्ठी','चिट्ठी']::text[], 'use an envelope', 4),
  ('maya', 'Maya', 'माया', array['maya','mayalu','mayako','माया']::text[], 'use a heart card', 5),
  ('rakshi', 'Rakshi', 'रक्सी', array['rakshi','raksi','रक्सी']::text[], null, 6)
on conflict (id) do update set name = excluded.name, dev = excluded.dev, words = excluded.words, note = excluded.note, sort = excluded.sort;
insert into public.songs (id, title, artist, lrclib_id, duration, status, notes) values ('funtastic', 'Funtastic (Pani Paryo)', 'Almoda Rana Uprety', 10796361, 220, 'tagged', 'Upload length differs from the timed lyrics: check sync in the studio.') on conflict (id) do nothing;
insert into public.videos (song_id, yt, kind, duration, offset_s, synced, rank) values ('funtastic', 'Tr_MTXkQLl8', 'official', 178, 0, false, 0) on conflict (song_id, yt) do nothing;
insert into public.tags (song_id, item_id, t, source) select 'funtastic', x.i, x.t, 'estimate' from (values ('paani', 57.02), ('paani', 64.56), ('paani', 123.61), ('paani', 130.98), ('paani', 182.75), ('paani', 190.2), ('paani', 197.36), ('paani', 204.71)) as x(i, t) where not exists (select 1 from public.tags where song_id = 'funtastic');
insert into public.songs (id, title, artist, lrclib_id, duration, status, notes) values ('simsime', 'Sim Sime Panima', 'Rekha Shah', 37778538, 312, 'tagged', 'Upload length differs from the timed lyrics: check sync in the studio.') on conflict (id) do nothing;
insert into public.videos (song_id, yt, kind, duration, offset_s, synced, rank) values ('simsime', '7zpqYNZFdNI', 'official', 687, 0, false, 0) on conflict (song_id, yt) do nothing;
insert into public.videos (song_id, yt, kind, duration, offset_s, synced, rank) values ('simsime', 'kfAh1zSTgPI', 'other', 293, 0, false, 1) on conflict (song_id, yt) do nothing;
insert into public.tags (song_id, item_id, t, source) select 'simsime', x.i, x.t, 'estimate' from (values ('paani', 40.2), ('paani', 54.79), ('paani', 62.09), ('paani', 96.51), ('paani', 111.21), ('paani', 118.52), ('paani', 160.11), ('paani', 174.83), ('paani', 182.09), ('paani', 214), ('paani', 228.67), ('paani', 235.98), ('paani', 267.87), ('paani', 282.53), ('paani', 289.88), ('paani', 297.29), ('paani', 304.68)) as x(i, t) where not exists (select 1 from public.tags where song_id = 'simsime');
insert into public.songs (id, title, artist, lrclib_id, duration, status, notes) values ('baanma', 'Baan Ma Fulyo Phool', 'Aagantuk Kharel', null, null, 'tagged', 'Upload length differs from the timed lyrics: check sync in the studio.') on conflict (id) do nothing;
insert into public.videos (song_id, yt, kind, duration, offset_s, synced, rank) values ('baanma', '6vDLaYhGFSY', 'official', 228, 0, false, 0) on conflict (song_id, yt) do nothing;
insert into public.tags (song_id, item_id, t, source) select 'baanma', x.i, x.t, 'estimate' from (values ('phool', 41.42), ('phool', 43.74), ('phool', 49.67), ('phool', 70.21), ('phool', 72.47), ('phool', 78.49), ('phool', 134.84), ('phool', 137.35), ('phool', 143.37), ('phool', 179.43), ('phool', 205.66), ('phool', 211.73), ('phool', 217.75), ('maya', 32.34), ('maya', 38.39), ('maya', 44.87), ('maya', 50.91), ('maya', 66.36), ('maya', 73.8), ('maya', 79.75), ('maya', 102.23), ('maya', 125.96), ('maya', 131.8), ('maya', 138.62), ('maya', 144.46), ('maya', 162.05), ('maya', 162.98), ('maya', 206.94), ('maya', 212.88), ('maya', 218.88)) as x(i, t) where not exists (select 1 from public.tags where song_id = 'baanma');
insert into public.songs (id, title, artist, lrclib_id, duration, status, notes) values ('phoolko', 'Phoolko Aankhama', 'Ani Choying Drolma', null, null, 'tagged', 'Upload length differs from the timed lyrics: check sync in the studio.') on conflict (id) do nothing;
insert into public.videos (song_id, yt, kind, duration, offset_s, synced, rank) values ('phoolko', 'bJNLrJ7MUzM', 'official', 305, 0, false, 0) on conflict (song_id, yt) do nothing;
insert into public.tags (song_id, item_id, t, source) select 'phoolko', x.i, x.t, 'estimate' from (values ('phool', 29.74), ('phool', 43.43), ('phool', 71.07), ('phool', 153.2), ('phool', 228.57), ('phool', 242.34), ('phool', 269.85)) as x(i, t) where not exists (select 1 from public.tags where song_id = 'phoolko');
insert into public.songs (id, title, artist, lrclib_id, duration, status, notes) values ('chiyabari', 'Chiya Barima Ho', 'Deepa Jha', null, null, 'draft', null) on conflict (id) do nothing;
insert into public.videos (song_id, yt, kind, duration, offset_s, synced, rank) values ('chiyabari', '1mdiDuh-bUI', 'official', null, 0, false, 0) on conflict (song_id, yt) do nothing;
insert into public.videos (song_id, yt, kind, duration, offset_s, synced, rank) values ('chiyabari', 'PhLFbAhtDpY', 'other', null, 0, false, 1) on conflict (song_id, yt) do nothing;
insert into public.songs (id, title, artist, lrclib_id, duration, status, notes) values ('paisaa', 'Paisaa', 'Kushal Grumpy', null, null, 'tagged', null) on conflict (id) do nothing;
insert into public.videos (song_id, yt, kind, duration, offset_s, synced, rank) values ('paisaa', 'luMzKL1LJ2o', 'official', 182, 0, true, 0) on conflict (song_id, yt) do nothing;
insert into public.tags (song_id, item_id, t, source) select 'paisaa', x.i, x.t, 'estimate' from (values ('paisa', 20.08), ('paisa', 22.59), ('paisa', 25.2), ('paisa', 27.81), ('paisa', 30.12), ('paisa', 32.72), ('paisa', 35.2), ('paisa', 37.8), ('paisa', 40.36), ('paisa', 45.54), ('paisa', 50.37), ('paisa', 52.91), ('paisa', 55.32), ('paisa', 57.94), ('paisa', 68.08), ('paisa', 71), ('paisa', 73.52), ('paisa', 80.62), ('paisa', 83.16), ('paisa', 85.87), ('paisa', 88.25), ('paisa', 93.5), ('paisa', 109.29), ('paisa', 111.1), ('paisa', 113.65), ('paisa', 116.01), ('paisa', 118.77), ('paisa', 129.98), ('paisa', 149.47), ('paisa', 151.45), ('paisa', 153.85), ('paisa', 156.55), ('paisa', 158.95), ('paisa', 161.68), ('paisa', 164.12), ('paisa', 166.72), ('paisa', 169.13)) as x(i, t) where not exists (select 1 from public.tags where song_id = 'paisaa');
insert into public.songs (id, title, artist, lrclib_id, duration, status, notes) values ('gurasai', 'Gurasai Fulyo', '1974 AD', null, null, 'draft', null) on conflict (id) do nothing;
insert into public.videos (song_id, yt, kind, duration, offset_s, synced, rank) values ('gurasai', 'NlBItVRVad0', 'official', null, 0, false, 0) on conflict (song_id, yt) do nothing;
insert into public.videos (song_id, yt, kind, duration, offset_s, synced, rank) values ('gurasai', '5WyX9LMFf5I', 'other', null, 0, false, 1) on conflict (song_id, yt) do nothing;
insert into public.songs (id, title, artist, lrclib_id, duration, status, notes) values ('kaha', 'Kaha Hola Ghar', 'Karma Band', 6862349, 218, 'tagged', null) on conflict (id) do nothing;
insert into public.videos (song_id, yt, kind, duration, offset_s, synced, rank) values ('kaha', 'jU7L4KDAT6w', 'audio', 218, 0, true, 0) on conflict (song_id, yt) do nothing;
insert into public.tags (song_id, item_id, t, source) select 'kaha', x.i, x.t, 'estimate' from (values ('chithi', 30.83), ('chithi', 35.15), ('maya', 67.73), ('maya', 71.95), ('paani', 96.17), ('paani', 104.68), ('maya', 110.23), ('maya', 114.87), ('paani', 118), ('phool', 170.58), ('phool', 179.07)) as x(i, t) where not exists (select 1 from public.tags where song_id = 'kaha');
insert into public.songs (id, title, artist, lrclib_id, duration, status, notes) values ('fulthunge', 'Fulthunge Rani', 'Sujan Chapagain', null, 358, 'tagged', null) on conflict (id) do nothing;
insert into public.videos (song_id, yt, kind, duration, offset_s, synced, rank) values ('fulthunge', 'e7m8j0UzFdM', 'official', 358, 0, true, 0) on conflict (song_id, yt) do nothing;
insert into public.tags (song_id, item_id, t, source) select 'fulthunge', x.i, x.t, 'estimate' from (values ('phool', 32.09), ('phool', 34.75), ('phool', 37.16), ('phool', 39.82), ('phool', 42.26), ('phool', 44.8), ('phool', 47.03), ('phool', 49.69), ('phool', 58.45), ('phool', 68.12), ('phool', 69.3), ('phool', 71.52), ('phool', 74.18), ('phool', 76.98), ('phool', 79.59), ('phool', 83.25), ('phool', 84.75), ('phool', 88.15), ('phool', 89.51), ('phool', 270.32), ('phool', 278.42), ('phool', 279.94), ('phool', 283.45), ('phool', 284.87)) as x(i, t) where not exists (select 1 from public.tags where song_id = 'fulthunge');
insert into public.songs (id, title, artist, lrclib_id, duration, status, notes) values ('gojima', 'Gojima Daam Chhaina', 'Rajanraj Siwakoti, Melina Rai, Grishma Siwakoti', null, null, 'tagged', 'Upload length differs from the timed lyrics: check sync in the studio.') on conflict (id) do nothing;
insert into public.videos (song_id, yt, kind, duration, offset_s, synced, rank) values ('gojima', 'AhkUyEfowaU', 'official', null, 0, false, 0) on conflict (song_id, yt) do nothing;
insert into public.videos (song_id, yt, kind, duration, offset_s, synced, rank) values ('gojima', 'Te-7vz1E3Hs', 'other', null, 0, false, 1) on conflict (song_id, yt) do nothing;
insert into public.tags (song_id, item_id, t, source) select 'gojima', x.i, x.t, 'estimate' from (values ('paisa', 26.94), ('paisa', 29.11), ('paisa', 31.78), ('paisa', 34.32), ('paisa', 38.77), ('paisa', 42.98), ('chithi', 43.62), ('chithi', 48.34), ('paisa', 55.74), ('paisa', 60.73), ('paisa', 62.25), ('paisa', 64.95), ('paisa', 66.64), ('paisa', 69.32), ('paisa', 137.11), ('paisa', 139.7), ('paisa', 144.12), ('paisa', 148.24), ('paisa', 167.79), ('paisa', 170.49), ('paisa', 211.33), ('paisa', 213.93), ('paisa', 218.54), ('paisa', 222.87), ('paisa', 224.4), ('paisa', 227.1)) as x(i, t) where not exists (select 1 from public.tags where song_id = 'gojima');
insert into public.songs (id, title, artist, lrclib_id, duration, status, notes) values ('junaheri', 'Jun Na Heri', 'Wangden Sherpa, Sushant Ghimire', null, 241, 'tagged', 'Upload length differs from the timed lyrics: check sync in the studio.') on conflict (id) do nothing;
insert into public.videos (song_id, yt, kind, duration, offset_s, synced, rank) values ('junaheri', 'UfU0TUgJk9g', 'lyric', 226, 0, false, 0) on conflict (song_id, yt) do nothing;
insert into public.tags (song_id, item_id, t, source) select 'junaheri', x.i, x.t, 'estimate' from (values ('phool', 24.44), ('phool', 31), ('phool', 64.12), ('phool', 72.04), ('maya', 89.3), ('phool', 120.61), ('phool', 159.96), ('chithi', 194.11), ('phool', 211.14), ('phool', 218.73), ('maya', 228.01), ('maya', 231.89), ('maya', 240.37)) as x(i, t) where not exists (select 1 from public.tags where song_id = 'junaheri');
insert into public.songs (id, title, artist, lrclib_id, duration, status, notes) values ('simsimepaani', 'Simsime Paani', 'VTEN', null, 194, 'tagged', null) on conflict (id) do nothing;
insert into public.videos (song_id, yt, kind, duration, offset_s, synced, rank) values ('simsimepaani', 'N9vC4dXzBMA', 'official', 194, 0, true, 0) on conflict (song_id, yt) do nothing;
insert into public.tags (song_id, item_id, t, source) select 'simsimepaani', x.i, x.t, 'estimate' from (values ('paani', 25.05), ('paani', 108.13)) as x(i, t) where not exists (select 1 from public.tags where song_id = 'simsimepaani');
insert into public.songs (id, title, artist, lrclib_id, duration, status, notes) values ('surke', 'Surke Thaili', 'Rajanraj Siwakoti, Anju Panta, Raju Bishowkarma', null, 225, 'tagged', null) on conflict (id) do nothing;
insert into public.videos (song_id, yt, kind, duration, offset_s, synced, rank) values ('surke', 'nLxhhR5hL0Q', 'official', 225, 0, true, 0) on conflict (song_id, yt) do nothing;
insert into public.tags (song_id, item_id, t, source) select 'surke', x.i, x.t, 'estimate' from (values ('paani', 97.88)) as x(i, t) where not exists (select 1 from public.tags where song_id = 'surke');
insert into public.songs (id, title, artist, lrclib_id, duration, status, notes) values ('mayaraicha', 'Maya Raicha Ra', 'Kali Prasad Baskota, Sadeekshya Kattel', null, 192, 'tagged', null) on conflict (id) do nothing;
insert into public.videos (song_id, yt, kind, duration, offset_s, synced, rank) values ('mayaraicha', 'WO0Bwf8SLp8', 'official', 192, 0, true, 0) on conflict (song_id, yt) do nothing;
insert into public.tags (song_id, item_id, t, source) select 'mayaraicha', x.i, x.t, 'estimate' from (values ('maya', 19.92), ('maya', 28.36), ('maya', 37.31), ('maya', 45.08), ('maya', 53.52), ('maya', 62.5), ('maya', 70.3), ('maya', 138.22), ('maya', 146.15), ('maya', 155.09), ('maya', 162.96)) as x(i, t) where not exists (select 1 from public.tags where song_id = 'mayaraicha');
insert into public.songs (id, title, artist, lrclib_id, duration, status, notes) values ('bistarai', 'Bistarai', 'Rohit John Chettri', null, 229, 'tagged', null) on conflict (id) do nothing;
insert into public.videos (song_id, yt, kind, duration, offset_s, synced, rank) values ('bistarai', '44tjJP7cI74', 'official', 229, 0, true, 0) on conflict (song_id, yt) do nothing;
insert into public.tags (song_id, item_id, t, source) select 'bistarai', x.i, x.t, 'estimate' from (values ('maya', 27.53), ('maya', 50.83), ('maya', 55.79), ('maya', 78.95), ('maya', 102.53), ('maya', 107.49)) as x(i, t) where not exists (select 1 from public.tags where song_id = 'bistarai');
insert into public.songs (id, title, artist, lrclib_id, duration, status, notes) values ('axechiya', 'Chiya Barima', 'The Axe Band', null, 275, 'tagged', 'Extra, not from the Spotify playlist.') on conflict (id) do nothing;
insert into public.videos (song_id, yt, kind, duration, offset_s, synced, rank) values ('axechiya', 'QKqakx_a6bI', 'official', 275, 0, true, 0) on conflict (song_id, yt) do nothing;
insert into public.tags (song_id, item_id, t, source) select 'axechiya', x.i, x.t, 'estimate' from (values ('chiya', 82.02), ('chiya', 148.81), ('chiya', 215.95), ('chiya', 255.12), ('chiya', 264.6)) as x(i, t) where not exists (select 1 from public.tags where song_id = 'axechiya');
insert into public.playlists (id, name, description, sort) values ('party-mix', 'Nepali Party Mix', 'The starter list: 16 songs from Sachin''s Nepali playlist.', 0) on conflict (id) do nothing;
insert into public.playlist_songs (playlist_id, song_id, position) values
  ('party-mix', 'funtastic', 0),
  ('party-mix', 'simsime', 1),
  ('party-mix', 'baanma', 2),
  ('party-mix', 'phoolko', 3),
  ('party-mix', 'chiyabari', 4),
  ('party-mix', 'paisaa', 5),
  ('party-mix', 'gurasai', 6),
  ('party-mix', 'kaha', 7),
  ('party-mix', 'fulthunge', 8),
  ('party-mix', 'gojima', 9),
  ('party-mix', 'junaheri', 10),
  ('party-mix', 'simsimepaani', 11),
  ('party-mix', 'surke', 12),
  ('party-mix', 'mayaraicha', 13),
  ('party-mix', 'bistarai', 14),
  ('party-mix', 'axechiya', 15)
on conflict do nothing;
commit;
