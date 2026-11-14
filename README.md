# Jhapat (झपट)

The Nepali party song game. Put items such as paani, phool, chiya and paisa on the table. Jhapat drops into a random Nepali song 7–10 seconds before one of their words is sung, and the first hand on it wins. Free, no sign-up.

- Play: https://jhapat.live/
- Tagging studio (editors): https://jhapat.live/studio/

Songs, timed lyrics (from [LRCLIB](https://lrclib.net)), YouTube uploads and word tags live in a Supabase database (`db/schema.sql`). An hourly workflow keeps a copy of the song catalog on the `catalog` branch for first visits; a weekly one checks that every upload still plays outside YouTube. `npm test` runs the checks.
