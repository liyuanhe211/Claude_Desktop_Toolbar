# Changelog

## 0.14.1 — 2026-10-16

- The subagent dots and the Monitor clocks no longer flash while the toolbar redraws frequently (every 0.5 s while a program's button cycles its dots). The desktop app reloads the frame of a drawing whose content changed, and their tooltips held times that changed every second. A running subagent's tooltip line now omits the running time (an ended one keeps its run time), and a Monitor's line shows the time left as its clock's countdown, `(stops in 27m)`.

## 0.14.0 — 2026-10-16

- Other programs can show a button in the toolbar by writing a small JSON file into `%TEMP%\claude_desktop_toolbar\buttons`. The button sits right of the subagent dots, its label can change at any time, and three dots can cycle after it. A press writes a `.pressed` file beside it for the program to act on, and the button shows its pressed label until the program removes it.

## 0.13.1 — 2026-10-16

- Pressing **Copy Transcript Path** now shows feedback on the button itself: it reads `Copied ✓` (or `Copy failed`) for 2 s, then reverts to its own label. The toast with the full path stays.

## 0.13.0 — 2026-10-15

- Each waiting clock shows the time left before its Monitor expires on its right: whole minutes rounded up (`12m`), seconds in the last minute (`45s`), `∞` for a Monitor without a deadline. The countdown redraws every 10 s, and every 2 s in the last minute.
- The clock blinks slower, at 1/2 of a running dot's rate (2.4 s instead of 1.8 s).

## 0.12.0 — 2026-10-15

- A conversation waiting on a Monitor no longer looks finished: an orange clock blinks left of the subagent dots for every Monitor still watching, at 2/3 of a running dot's rate (1.8 s instead of 1.2 s). Hover for each Monitor's description, how long it has waited and when it stops. The clock goes when the Monitor ends, is stopped, or passes its deadline; the terminal shows `Monitors 1 waiting`. The `↗` button beside it opens the Background tasks pane.
- A Monitor started before the toolbar loaded (or before a reload) is read back from the conversation transcript.

## 0.11.0 — 2026-10-15

- A `↗` button right of the subagent dots opens the desktop app's **Background tasks** pane (the terminal shows a toast instead). The dots themselves take no click: an SVG takes no press and a button holds no SVG.
- Dots now appear and change the moment a subagent starts or ends. Before, the desktop app redrew the toolbar only on an unrelated change (a usage figure, the end of a turn), so the dots lagged behind and could miss subagents.
- The 2-second poll of the agent list restarts after a hot reload of the plugin folder, which does not run `session.start` again.

## 0.10.0 — 2026-10-15

- Subagent dots between the folder list and **Copy Transcript Path**: one dot per subagent of the conversation, in launch order. A running subagent's dot pulses in orange; a finished one stays green, a failed one red, a stopped one a grey ring. Hover for a summary and one line per subagent with its type, task and duration. The newest 12 dots show, with `+n` for older ones; the terminal shows the counts as text.
- A subagent finishing no longer counts as the end of the main conversation's turn for the usage rings and the folder bookkeeping.

## 0.9.4 — 2026-10-15

- Tried and withdrawn: submitting a short turn from the toolbar itself so that an idle conversation moves right away. The desktop app applies a move only at a turn you send, not one a plugin submits, so the turn cost quota and moved nothing. An idle conversation still shows `Moving after your next message...` and waits.

## 0.9.3 — 2026-10-15

- After you switch accounts, the usage rings no longer show the previous account's figures (such as the old Fable percentage) for up to a minute. A session now ignores any shared endpoint answer cached before it started and reads the endpoint itself.

## 0.9.2 — 2026-10-15

- An idle or finished session no longer leaves the 5-hour and weekly rings at the figures from its last turn. The rings now show whichever is fresher, the session's own reading or the shared endpoint answer.
- The folder list has no down arrow (`Desktop_Style_Patch/User_Overrides.css`).
- Picking a folder no longer raises a toast when the toolbar already shows the outcome (the folder list or the pending-move note); a declined or failed move still does.

## 0.9.1 — 2026-10-15

- A move the desktop app has not made yet appears in grey beside the folder list as `→ Python_Lib Moving after your next message...` (or `Moving when this turn ends...` during a turn), with cycling dots. The note clears once the session is in that folder. Instead of "Moving", the toast says when the move applies.

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
