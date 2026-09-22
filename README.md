# pi-claude-hooks

Run your Claude Code hooks inside [pi](https://pi.dev). The extension reads the hook configuration your team already deploys to `.claude/` and runs those command hooks on pi's events. Existing hook scripts keep working unchanged, including scripts that read `.tool_input.file_path` or match on `Edit|Write`.

## Quick start

Install the package:

```bash
pi install git:github.com/jordyvanvorselen/pi-claude-hooks
```

Or install from a local checkout:

```bash
pi install /path/to/pi-claude-hooks
```

Or try it for one run without installing:

```bash
pi -e git:github.com/jordyvanvorselen/pi-claude-hooks
pi -e /path/to/pi-claude-hooks
```

Open pi in a project that has `.claude/settings.json` hooks. Run `/claude-hooks` to see what was loaded.

Hooks only run for trusted projects. If pi has not trusted the project yet, only your user-level `~/.claude/settings.json` hooks load, and you get a warning.

## Config sources

Hook files are read in this order. Later files append to the earlier ones.

| Order | File | Notes |
| --- | --- | --- |
| 1 | `~/.claude/settings.json` | Your user hooks. Turn off with `loadUserSettings: false`. |
| 2 | `<project>/.claude/settings.json` | Team hooks. Only for trusted projects. |
| 3 | `<project>/.claude/settings.local.json` | Personal project hooks. Only for trusted projects. |
| 4 | `<project>/.claude/*.json` | Any other JSON file that contains hooks, for example `apm-hooks.json`. Glob is configurable. |

A file counts as a hook file when it has a top-level `hooks` object, or when it has event names such as `PreToolUse` at the top level (the shape APM writes to `apm-hooks.json`).

Identical hooks are deduplicated. When `settings.json` and `apm-hooks.json` contain the same event, matcher and command, that hook runs once.

Only `type: "command"` hooks run. `http`, `prompt`, `agent` and `mcp_tool` hooks are skipped with one warning per type.

### Options

Put options in `~/.pi/agent/claude-hooks.json` or `<project>/.pi/claude-hooks.json`. The project file overrides the user file.

```json
{
  "enabled": true,
  "loadUserSettings": true,
  "extraFiles": ["*.json"],
  "defaultTimeoutSeconds": 600,
  "sessionEndTimeoutSeconds": 1.5,
  "shell": "/bin/bash",
  "verbose": false,
  "startupSummary": "compact"
}
```

| Option | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | Set to `false` to load nothing. |
| `loadUserSettings` | `true` | Read `~/.claude/settings.json`. |
| `extraFiles` | `["*.json"]` | Filename globs, matched inside `.claude/`, for extra hook files. `settings.json` and `settings.local.json` are always excluded here because they load on their own. Use `[]` to load no extra files. |
| `defaultTimeoutSeconds` | `600` | Timeout for hooks without their own `timeout`. `UserPromptSubmit` hooks are capped at 30 seconds, matching Claude Code. |
| `sessionEndTimeoutSeconds` | `1.5` | Timeout for `SessionEnd` hooks so quitting pi stays fast. A hook's own `timeout` wins. |
| `shell` | `/bin/bash` when present | Shell used to run hook commands. |
| `verbose` | `false` | Log every hook run and exit code. |

Environment variables for quick overrides: `PI_CLAUDE_HOOKS_EXTRA_FILES` (comma separated globs), `PI_CLAUDE_HOOKS_VERBOSE=1`, `PI_CLAUDE_HOOKS_DISABLED=1`.

## Startup summary

When a session starts, the extension adds a `[Claude hooks]` block to the chat in the same style as pi's own `[Skills]` and `[Extensions]` sections.

```
[Claude hooks]
  SessionStart (1), PreToolUse (3), PostToolUse (1)
```

Press the expand shortcut (the one that expands tool output) to see every hook grouped by source file, with its matcher and a shortened command:

```
[Claude hooks]
  ~/.claude/settings.json
    SessionStart [startup] bash ~/.claude/hooks/agent-state.sh session
  ~/projects/app/.claude/settings.json
    PreToolUse [Bash] if jq -re '.tool_input.command // empty' | grep -qE '(rm\s+(-[a-z]*...
    PreToolUse [Edit|Write] p=$(jq -re '.tool_input.file_path // empty') || exit 0; root=...
    PostToolUse [Edit|Write] if jq -re 'select((.tool_input.file_path // "") | (test("(co...
```

Set `startupSummary` in the options file:

| Value | Behaviour |
| --- | --- |
| `"compact"` | Default. Event names with counts. Expands on demand. |
| `"full"` | Always show the grouped list. |
| `"off"` | Show nothing. |

The block is a pi custom entry. It is stored in the session file but never sent to the model. It appears once per session: resuming a session does not add another one, and nothing is shown when no hooks loaded or when pi runs without a UI (print and JSON modes).

## Commands

| Command | What it does |
| --- | --- |
| `/claude-hooks` | List loaded sources and hooks per event. |
| `/claude-hooks-reload` | Re-read all hook files. |
| `/claude-hooks-verbose` | Toggle logging of every hook run. |

## Event mapping

| Claude Code event | Pi event | Matcher value | Can block |
| --- | --- | --- | --- |
| `PreToolUse` | `tool_call` | Tool name (pi and Claude names) | Yes. Blocks the tool call. |
| `PostToolUse` | `tool_result` with `isError: false` | Tool name | No. Feedback goes to the model. |
| `PostToolUseFailure` | `tool_result` with `isError: true` | Tool name | No. Feedback goes to the model. |
| `UserPromptSubmit` | `input` | none | Yes. Drops the prompt. |
| `SessionStart` | `session_start` | `startup`, `resume`, `clear`, `fork` | No |
| `SessionEnd` | `session_shutdown` | `clear`, `resume`, `other` | No |
| `Stop` | `agent_before_settle` | none | Yes. Appends the reason as context and runs one more turn. |
| `PreCompact` | `session_before_compact` | `manual`, `auto` | Yes. Cancels compaction. |
| `PostCompact` | `session_compact` | `manual`, `auto` | No |

Session source mapping: pi `startup` and `reload` become `startup`, `new` becomes `clear`, `resume` stays `resume`, `fork` stays `fork`. Session end reasons: pi `new` becomes `clear`, `resume` stays `resume`, everything else becomes `other`.

Matchers follow Claude Code rules and are case-insensitive. A matcher made of names separated by `|` or `,` is an exact list. Anything else is a regular expression. Empty, missing or `*` matches everything.

## Tool name and field normalisation

Claude Code scripts see capitalised tool names and `file_path` style fields. Pi uses lowercase names and different field names. The extension presents both, so scripts written for either side work.

### Tool names

Matchers are tested against the pi name and the Claude Code name. `"Edit|Write"` and `"Bash"` work unchanged. `tool_name` in the stdin payload is the Claude Code name. `pi_tool_name` holds the pi name.

| Pi tool | Claude Code name |
| --- | --- |
| `bash` | `Bash` |
| `powershell` | `Bash` |
| `read` | `Read` |
| `write` | `Write` |
| `edit` | `Edit` |
| `grep` | `Grep` |
| `find` | `Glob` |
| `ls` | `LS` |
| anything else | unchanged |

### `tool_input` fields

Pi's own fields are always present. These Claude Code fields are added next to them.

| Pi tool | Pi input | Added Claude Code fields |
| --- | --- | --- |
| `edit` | `path`, `edits: [{oldText, newText}]` | `file_path` = `path`, `old_string` = all `oldText` joined with newlines, `new_string` = all `newText` joined with newlines |
| `write` | `path`, `content` | `file_path` = `path` |
| `read` | `path`, `offset`, `limit` | `file_path` = `path` |
| `bash` | `command`, `timeout` | none, `command` already matches |
| `grep` | `pattern`, `path`, `glob`, `ignoreCase`, ... | `-i` = `ignoreCase` |
| `find` | `pattern`, `path`, `limit` | none, matches Claude Code `Glob` |

### `updatedInput` mapping back

When a `PreToolUse` hook returns `hookSpecificOutput.updatedInput`, the extension translates Claude Code fields back before pi runs the tool.

| Returned field | Applied as |
| --- | --- |
| `file_path` | `path` (for `read`, `write`, `edit`) |
| `old_string`, `new_string` | `edits[0].oldText`, `edits[0].newText` when the call has exactly one edit. With several edits the change is ignored and you get a warning. |
| `-i` | `ignoreCase` (for `grep`) |
| anything else | passed through as is |

## Stdin payload

Every hook gets JSON on stdin:

```json
{
  "session_id": "...",
  "transcript_path": "/path/to/pi/session.jsonl",
  "cwd": "/path/to/project",
  "hook_event_name": "PreToolUse",
  "permission_mode": "default",
  "tool_name": "Edit",
  "pi_tool_name": "edit",
  "tool_input": { "path": "a.ts", "edits": [...], "file_path": "a.ts", "old_string": "...", "new_string": "..." },
  "tool_use_id": "call_123"
}
```

Event specific fields: `tool_response: { output, details, is_error }` on `PostToolUse`, `error` on `PostToolUseFailure`, `prompt` on `UserPromptSubmit`, `source` and `model` on `SessionStart`, `reason` on `SessionEnd`, `stop_hook_active` and `last_assistant_message` on `Stop`, `trigger` and `custom_instructions` on `PreCompact`, `trigger` and `compaction_summary` on `PostCompact`.

## Environment

Hook commands run in the project directory with your environment plus:

| Variable | Value |
| --- | --- |
| `CLAUDE_PROJECT_DIR` | Project root (pi's cwd) |
| `PI_SESSION_ID` | Pi session id |
| `PI_SESSION_FILE` | Pi session file, when the session is saved |
| `PI_PROVIDER`, `PI_MODEL` | Current model |
| `PI_REASONING_LEVEL` | Current thinking level |
| `PI_CLAUDE_HOOKS` | `1`, so scripts can tell they run under pi |

## Exit code contract

| Exit code | `PreToolUse` | `PostToolUse` | `UserPromptSubmit` | `Stop` | `PreCompact` | Others |
| --- | --- | --- | --- | --- | --- | --- |
| `0` | Parse stdout as JSON if it is a JSON object | Same | Same. Plain stdout is added as context for the model | Same | Same | Same. `SessionStart` plain stdout is added as context |
| `2` | Block the tool. stderr is the reason the model sees | Tool already ran. stderr is appended to the tool result for the model | Drop the prompt. stderr is shown to you | Keep going. stderr is added as context and one more turn runs | Cancel compaction | stderr is shown to you |
| other | Non-blocking. stderr is shown as an error. Valid JSON on stdout still applies | Same | Same | Same | Same | Same |

A hook that hits its timeout is reported as an error and never blocks.

## JSON output contract

Print a JSON object on stdout with exit code 0.

| Field | Supported | Behaviour |
| --- | --- | --- |
| `continue: false`, `stopReason` | Yes | On `PreToolUse` the tool is blocked and the agent stops. On `PostToolUse` the run is aborted. Elsewhere it counts as a block. |
| `systemMessage` | Yes | Shown to you as a warning. |
| `suppressOutput` | Ignored | Stdout is never shown in the transcript anyway. |
| `decision: "block"`, `reason` | Yes | Blocks on `PreToolUse`, `UserPromptSubmit`, `Stop`, `PreCompact`. Feeds `reason` to the model on `PostToolUse`. |
| `decision: "approve"` | Yes | Same as `permissionDecision: "allow"`. |
| `hookSpecificOutput.permissionDecision` | Yes | `deny` blocks. `ask` opens a confirm dialog, or blocks when there is no UI. `allow` lets the call through. `deny` wins over `ask` wins over `allow` when several hooks answer. |
| `hookSpecificOutput.permissionDecisionReason` | Yes | Reason for the block or the dialog. |
| `hookSpecificOutput.updatedInput` | Yes | Replaces the tool input. See the mapping above. |
| `hookSpecificOutput.additionalContext` | Yes | `PreToolUse` and `PostToolUse`: appended to the tool result. `UserPromptSubmit` and `SessionStart`: sent as a hidden message before the next turn. |

## Supported and unsupported

Supported: command hooks, all events in the mapping table, matchers, per-hook `timeout`, exit codes 0 and 2, the JSON fields listed above, `stop_hook_active` loop protection on `Stop`.

Not supported: `http`, `prompt`, `agent` and `mcp_tool` hook types. Events pi has no equivalent for: `Notification`, `PermissionRequest`, `PermissionDenied`, `SubagentStart`, `SubagentStop`, `PostToolBatch`, `PreModelSwitch`, `PostModelSwitch`, `Elicitation`, worktree, teammate and task events. Hook fields `if`, `once`, `async`, `statusMessage`, `args`. `CLAUDE_ENV_FILE`. Plugin and skill frontmatter hooks. `allowManagedHooksOnly` and managed settings.

Pi has no permission prompts of its own, so `permissionDecision: "allow"` has nothing to bypass. It simply lets the call proceed.

## Development

```bash
npm install
npm test
npm run typecheck
```

The integration tests run the real hook commands from a Hertek project against pi-shaped tool inputs. One of those hooks needs GNU `realpath -m`. On macOS install coreutils with Homebrew, the tests add its `gnubin` directory to `PATH` automatically.
