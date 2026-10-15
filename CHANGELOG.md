# Changelog

## 0.9.0 — 2026-10-15

- First public release: marketplace file, license, README with install steps.
- The run-out sentence ends with a period: `Runs out in 5 min.`, `Lasts past reset.`, `Ran out.`.

## 0.8.x — 2026-10-15

- The 5-hour and weekly limits are two separate rings, drawn like the model ring with the percentage inside.
- The token count sits left of the context bar; the detail block shows the count over the model's context window (`110k / 1M`).
- The folder list shows the folder name alone.
- The detail block gives each window's reset time and a projected run-out time, aligned in Consolas: reset times left-aligned number by number, run-out times unit under unit. Tooltips use the same sentences with single spaces.

## 0.7.x — 2026-10-15

- The model ring reads the model-scoped weekly quota from the plan usage endpoint, shared by all sessions and asked at most once a minute.
- Live refresh: the context every 5 seconds, the plan windows every minute and after each turn.
- Temporary folders are kept out of the folder list; Browse is the last entry of the list.
- The detail block is drawn in Consolas with the colons aligned.

## 0.5.0 – 0.6.0 — 2026-10-14

- Usage widgets: a model ring, a context bar full at 500k tokens with its token count, and limit rings in the Codex widget's colors.

## 0.4.x — 2026-10-14

- The folder list draws at most 64 entries, the limit the engine accepts for a Select (more made the whole row vanish).

## 0.2.0 – 0.3.0 — 2026-10-14

- Recent-folder list (100 kept), seeded from the desktop app's session records; a Browse folder picker that opens at the last used folder; `/folder <name or path>` for a conversation that has no toolbar yet.
- *Copy Transcript Path* button and `/copy-transcript-path`.
