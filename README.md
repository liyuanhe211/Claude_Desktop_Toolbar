# Conversation Toolbar

A Claude Code plugin (a hooks-module mod) that draws one row above the prompt, in the Claude desktop app's Code tab and in the terminal: a recent-folder list, status dots for the conversation's subagents, a button that copies the transcript path, and live usage widgets for the context window and the plan's rate limits.

## Features

| Control | What it does |
| --- | --- |
| Folder list | Shows the current folder by its name alone (`my-project`; "No folder" in a scratch workspace) and lists the most recently used folders: the 64 newest of the 100 the plugin remembers, because Claude Code refuses a Select with more options. Picking one starts the conversation there before the first prompt, or moves the session there afterwards. A name too long for the row keeps its end behind an ellipsis. |
| **Browse…** (last entry of the folder list) | Opens the Windows folder picker at the most recently used folder rather than the user profile. The picked folder is used and recorded the same way. |
| Subagent dots | One dot per subagent of this conversation, oldest left, shown once the first one starts. Running dots pulse in orange, one after another; finished ones are green, failed ones red, stopped ones a grey ring (also a subagent that ended without a known result). A subagent that waits is a slowly pulsing orange ring, a teammate between turns a still one. Hover for a summary and one line per subagent, newest first: state, type, task and duration. The newest 12 show, `+n` counting the older ones; the history keeps 50. The `↗` button right of the dots opens the desktop app's **Background tasks** pane, which lists the subagents with their tasks; in the terminal it only shows a toast. The pane also counts shell commands as tasks, so its count is higher than the number of dots. |
| **Copy Transcript Path** | Copies the path of this conversation's transcript (`.jsonl`) to the clipboard. Also available as `/copy-transcript-path`. |
| Usage widgets (right end) | Left to right: a ring for the model's weekly quota (for example Fable), the token count, a context bar full at 500k tokens, a ring for the 5-hour limit and a ring for the weekly limit. Each ring shows its whole percentage inside. |

### Usage widgets

- **Colors** follow the Codex usage widget: quotas green below 70 %, yellow to 85 %, red above; the context bar blue below 300k tokens, yellow to 400k, red above. A grey track shows only under 25 % used, and a missing reading shows `?`, never 0.
- **Refresh**: the context every 5 seconds; the plan windows every minute and after each turn, from one cached reading shared by all sessions.
- **Hover** a ring or the bar for its figures in one sentence:
  `5 h limit: 12% (Reset in 3 h 30 min. Runs out in 1 h 5 min.)`
- **Press the token count** to pin a monospaced block with every figure, aligned:

  ```
  Context  : 350k / 1M
  5 h limit: 91% (Reset in 4 h 10 min. Runs out in       5 min.)
  7 d limit: 76% (Reset in 5 d 14 h.   Runs out in 10 h 45 min.)
  Fable    : 88% (Reset in 5 d 14 h.   Runs out in  4 h 39 min.)
  ```

  "Runs out in" projects the average rate since the window began. A window that lasts until its reset at that rate says `Lasts past reset.`, a full one `Ran out.`.
- In the terminal the widgets are one text line with a Details button.

### Choosing a folder for a new conversation

The desktop app draws the row only after a session exists, so a new conversation that has not received any input shows no toolbar. Send `/folder <name or path>` as the first message: this creates the session without a model turn and opens the recent folder whose name matches (exact name, then a name starting with the argument, then a name containing it, then a path containing it) or the given absolute path. `/folder` alone just creates the session so the toolbar appears.

Moving uses the desktop app's own `change_directory` tool, so the app asks to approve the folder unless permissions are bypassed. The desktop app applies a move only at a turn you drive: during a running turn it waits for that turn to end; in an idle conversation it waits for your next message (a turn the toolbar itself submits does not count, so the toolbar does not try). Until then the list keeps the current folder, and a grey note beside it names the target, `→ Python_Lib  Moving after your next message...`, with its dots cycling. The note clears once the session is there. If the move is refused while a turn is running, the toolbar adds a note asking Claude to move the working directory once the turn is complete.

## Requirements

- **Windows.** The folder picker is a PowerShell script, and the folder handling expects Windows paths.
- **Claude Code 2.1.275 or later**, which loads hooks-module plugins and installs them from a marketplace in one step. The Claude desktop app's Code tab runs a bundled Claude Code and draws the toolbar too.

## Install

In a terminal Claude Code session, type:

```
/plugin install conversation-toolbar --marketplace <owner>/<repo>
```

Answer `y` to add the marketplace, then pick the user scope with Enter. The plugin is active in that session at once and in every session started afterwards, including the desktop app's Code tab. The desktop app's own prompt does not accept `/plugin`, so install from a terminal.

To run a local copy instead, name its folder in `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json` (paths separated by `;` on Windows), or start Claude Code with `--plugin-dir <folder>`.

## Data and privacy

- **Recent folders** live in the plugin's own store under the Claude Code configuration directory, shared by all sessions on the machine. Every session's starting folder, every folder picked here, and every folder a session is moved to goes to the front; scratch workspaces, session worktrees and temporary folders are never recorded.
- **First load**: the folders of the desktop app's own session records (`%APPDATA%\Claude\claude-code-sessions`) fill the list once. Only the folder paths are read.
- **Usage**: the context and the 5-hour and weekly windows come from the session itself. The model-scoped weekly quota comes from `https://api.anthropic.com/api/oauth/usage`, the endpoint Claude Code's `/usage` reads, called with the session's own authorization through the engine. Nothing is sent anywhere else.

## Layout

- `.claude-plugin/plugin.json`: the manifest (`conversation-toolbar`)
- `.claude-plugin/marketplace.json`: makes this repository a one-plugin marketplace
- `hooks/register.tsx`: the hooks: session start, turn boundaries, the slash commands, and the row above the prompt
- `hooks/folder_list.ts`: path handling and the recent-folder list, with no engine calls
- `hooks/subagent_dots.ts`: the subagent records and their dots, with no engine calls
- `hooks/usage_wheels.ts`: the usage figures, their text and the SVG rings and bar, with no engine calls
- `scripts/Pick_Folder.ps1`: the folder picker Browse runs
- `types/index.d.ts`: the `$.state` contract
- `tests/`: `claude plugin test` suites

## Development

From the repository folder:

```
claude plugin validate .
claude plugin test .
```

The engine writes its type declarations into `.claude-plugin/types/` when it loads the plugin; after that, `tsc -p .` type-checks it.

## License

[MIT](LICENSE)
