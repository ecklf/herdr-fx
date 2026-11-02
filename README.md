# herdr-fx

[fx](https://fx.sh) activity, needs-attention notifications, and saved-session
restore in [Herdr TUI](https://herdr.dev/tui/). Start or resume fx in a project
pane, see when it is working or waiting for you, and let Herdr handle notifications.
This plugin targets Herdr TUI, not the separate native Herdr app.

## Requirements

- Herdr TUI 0.9.5+ on macOS or Linux.
- [Bun](https://bun.sh/) 1.3.5+ on the Herdr server's `PATH`.
- A current [fx](https://fx.sh) installation on `PATH`, signed in and ready to use.

No npm dependencies, build step, or additional API keys are required.
Discovery prefers `fx`, falling back to `vercel-fx`; set `HERDR_FX_BIN` to override.

## Setup

```sh
herdr plugin install ecklf/herdr-fx
```

Installation registers the **Start fx** and **Resume fx session** actions.
No sidebar rows, shortcuts, or polling configuration are required. With a Herdr
session running, focus the project pane where you want to work:

```sh
herdr plugin action invoke open --plugin herdr-fx
```

To review a particular revision before installing, add `--ref <commit-or-tag>`
to the install command. The plugin runs with your user's permissions, like any
other Herdr plugin.

## Usage

| Action | Command | Behavior |
| --- | --- | --- |
| Start fx | `herdr plugin action invoke open --plugin herdr-fx` | Open a fresh fx session in a split |
| Resume fx session | `herdr plugin action invoke resume --plugin herdr-fx` | Open fx's session picker in a split |

Actions use the focused pane's directory, falling back to the workspace directory.
To open a pane in a specific project instead:

```sh
herdr plugin pane open --plugin herdr-fx --entrypoint session \
  --placement split --cwd /absolute/path/to/project --focus
```

Activity follows fx's status protocol, not terminal-text matching. Permissions
and questions appear as blocked; work resumes when the prompt closes. Completion
maps to idle, and failures appear as blocked. Herdr's notification, sound, focus,
and delay settings apply; the plugin does not send duplicate alerts.

Restore is registered only after the exact reported session has been saved.
The restore command relaunches this adapter with that session ID, without
replaying the initial prompt or permission flags. Keep the plugin installation,
Bun, fx executable, and saved session available for restart restore.

**Session-switch limitation:** current fx reports its session ID at startup only.
Switching sessions inside fx can leave restore pointing at the original session.
Exit and relaunch the adapter when changing sessions if you depend on restore.
Automatic tracking requires an upstream fx change; this plugin never guesses the
latest workspace session, which could belong to another pane.

Per-subagent progress, percentage-complete, token/cost telemetry, and mid-turn
crash recovery are not supported. See [architecture and limitations](docs/architecture.md).

For action errors, use `herdr plugin log list --plugin herdr-fx`. For delivery
errors, set `HERDR_FX_DEBUG=1` in the launched pane's environment, for example:

```sh
herdr plugin pane open --plugin herdr-fx --entrypoint session \
  --placement split --cwd /absolute/path/to/project --env HERDR_FX_DEBUG=1 --focus
```

## Update or uninstall

```sh
herdr plugin update herdr-fx
```

Exit and reopen existing fx panes to use updated code. Changes to the plugin's
installation path can invalidate previously recorded restore commands; start a
new adapter instance to register a fresh command. To remove:

```sh
herdr plugin uninstall herdr-fx
```

For a locally linked checkout, use `herdr plugin unlink herdr-fx` instead.

## Development

```sh
gh repo clone ecklf/herdr-fx
cd herdr-fx
bun run check
bun test
herdr plugin link "$PWD"
```

No build or dependency installation is needed. Diagnostics and direct launch:

```sh
bun bin/herdr-fx.js --doctor
bun bin/herdr-fx.js
bun bin/herdr-fx.js --resume SESSION_ID
bun bin/herdr-fx.js --fx-bin /absolute/path/to/fx --model MODEL "your prompt"
```

Doctor checks executable discovery and runtime/TTY/environment presence, not
server reachability or fx's event support. Tests use fake fx processes, fake
Herdr sockets, and real PTYs; no model calls or user-session changes are involved.
Verify notifications and restart restore in a scratch project against your
installed fx/Herdr versions before relying on them.

## License

[Apache-2.0](LICENSE).
