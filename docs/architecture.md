# Architecture and upstream path

## Decision: JavaScript core, replaceable host adapter

Herdr's OpenCode integration is not a marketplace launcher alone. Its **JavaScript** agent/TUI plugins run inside OpenCode, subscribe to semantic events, and call Herdr's socket API. Installation/configuration and built-in restore rules are Rust code in Herdr.

fx currently has no equivalent dynamically loaded JavaScript lifecycle plugin API. It does have native Herdr socket reports and OSC 7501 foreground status output. A standalone repository cannot fix fx's lifecycle hooks by installing an OpenCode-shaped file. Therefore this plugin uses a **Bun PTY adapter**, not an undocumented hook configuration or an ACP replacement UI.

```text
Herdr action -> plugin pane, project cwd -> Bun PTY launcher -> interactive fx
                                              |
                           +------------------+-------------------+
                           |                                      |
                    PTY output observation                 private Unix socket
                     OSC 7501 / app=fx                    native session reports
                           |                                      |
                     StatusDecoder                         SessionTracker
                           |                              exact-ID saved check
                           +------------------+-------------------+
                                              |
                                           Reporter
                                    ordered, bounded, retried
                                              |
                                      real Herdr socket
                                 source custom:herdr-fx / agent fx
                                              |
                          Herdr activity, notification policy, persisted resume argv
```

The launcher preserves fx's terminal UI. It neither translates terminal screen text into state nor evaluates prompts as shell code. Pane commands use a fixed POSIX `sh` bootstrap (`exec bun "$HERDR_PLUGIN_ROOT/bin/herdr-fx.js" "$@"`) because Herdr starts them in the project cwd, not the plugin installation directory. Environment paths and forwarded arguments are quoted; the shell is replaced immediately by Bun. Actions run from the plugin root and need no bootstrap. An ACP/libfx UI could expose richer events but would replace the user's native interactive fx experience; that is outside this plugin's scope.

## Module boundaries

| Module | Responsibility | Upstream disposition |
| --- | --- | --- |
| `src/osc.js` | Bounded streaming OSC framing, root/app filtering, state translation | Retain as optional transport adapter; remove when native hooks suffice |
| `src/transport.js` | NDJSON request/response, correlation, size/deadline bounds | Reusable JavaScript Herdr client helper |
| `src/reporter.js` | Herdr source/sequence ownership, state dedup, ordered delivery/retry, resume reporting, cleanup | Reusable integration logic; can consume native hook events |
| `src/session.js` | Exact-ID persistence validation; generation guards against stale lookups | Replace external inspection with a native session-commit event upstream |
| `src/session-relay.js` | Consume fx's native startup reporter without forwarding arbitrary requests | Compatibility shim only |
| `src/runtime.js` | Bun PTY, raw input, resize/signals, executable resolution | Standalone host adapter; not part of the semantic core |
| `src/commands.js` | Safe argv and project-context construction | Thin launcher/manifest glue |

The semantic and socket modules use standard JavaScript/Node APIs, not Bun-specific APIs. Bun is used for PTY creation, process launch, command entrypoints, tests, and manifest checking. There are no third-party runtime dependencies or native addons to build. Supported runtime floor is Bun 1.3.5; local verification is recorded separately rather than assumed for all versions/platforms.

## Protocol choices

- External source is `custom:herdr-fx`, **not** the reserved upstream-style `herdr:fx`. Renaming the source is an upstream migration decision.
- Each outgoing request uses a string ID and waits for a matching, successful NDJSON response. A deadline covers both connect and response; failures do not terminate fx. Latest failed state retries while the pane is live. Normal transitions remain ordered; the backlog is capped at 32 jobs.
- Sequences start at wall-clock milliseconds times 1000 and increase per report, matching OpenCode's timestamp-based convention. This is not a distributed clock guarantee: a major backwards system-clock change can require releasing stale authority in Herdr.
- Outgoing `message` is used, not fx's older native `custom_status` field. OSC messages are decoded from base64, sanitized, and bounded.
- The private relay intercepts native fx reports so the native reporter cannot race the adapter on the real socket. It is scoped to the child/pane, created in a private temporary directory, and removed on exit. Requests are allowlisted and never forwarded or executed. Rename/cleanup requests are acknowledged but swallowed; the plugin never overwrites user pane titles.
- Before OSC is observed, native state reports provide fallback. After a root OSC report, OSC exclusively owns state; a late native `blocked` cannot undo a real unblock.
- `done -> idle`, `error -> blocked`. Herdr TUI's API does not accept `done`/`error` states. Herdr derives notifications; no duplicate toast/sound logic lives here.
- fx's root OSC record is used. Foreign apps and non-root record IDs are ignored. No session ID is extracted from terminal prose or a session-directory scan.
- Custom session IDs do not select Herdr's built-in official-agent restore rules. Instead each saved session is accompanied by `resume_argv` in a state report that also establishes ownership.
- Resume argv starts with the bare command `bun`, then the absolute launcher path, explicit fx executable, and `--resume <exact ID>`. This respects Herdr's plain-command/size/control-character/apostrophe constraints. Paths with spaces are separate argv elements, not shell interpolation. Paths with apostrophes cannot be represented by Herdr's restore mechanism and are rejected.
- Exit stops observation, drains accepted reports within a bounded budget, then clears only this source's authority. Turn completion does not release the pane. Failed cleanup is best-effort; abrupt SIGKILL cannot guarantee cleanup.

## Upstream in small changes

### 1. Fix the source of truth in fx (Zig)

The preferred final solution is **native fx support**, avoiding a PTY shim:

1. Report the root session ID on every selected/new/fork/reset/resume transition, not just startup.
2. Distinguish allocated identity from a successful session commit before advertising resumability.
3. Report `working` when permission/question/recovery waits end; preserve state while multiple waits remain outstanding.
4. Add exact `resume_argv` support (or coordinate official fx restore support in Herdr), current `message` fields, and monotonically sequenced reports.
5. Keep subagent root attribution and asynchronous stale-event guards explicit.
6. Bound reports off the UI's critical path, and test socket failure/exit races.

The wrapper deliberately does not guess these missing semantics. Its startup-session restore limitation must remain prominent until fx emits the missing transitions.

### 2. Add a first-class Herdr integration (Rust plus assets as needed)

Once fx supplies native events, a Herdr contribution can add fx detection/registration, setup guidance, official restore rules (`fx --resume <ID>`), and fixtures. Follow Herdr's current registry/API compatibility policy rather than blindly adding a variant to a frozen integration enum. No JavaScript plugin needs to be installed into fx if fx's native support is complete.

If fx instead adds a stable JavaScript hook loader, replace `runtime.js`/`session-relay.js` with a small event adapter, and move the portable reporter alongside Herdr's OpenCode assets. The important contribution is lifecycle/session semantics and tests—not retaining a wrapper for its own sake.

### 3. Keep this package as optional workflow UX

The manifest's launch/resume actions can remain useful independently, but must stop installing a second reporter when native support reaches parity. Do not publish under `herdr:` authority before coordinating that change upstream.

## Research baseline

Source inspected for this implementation:

- Herdr [`ee5bfb5`](https://github.com/herdrdev/herdr/tree/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde): [OpenCode agent plugin](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/integration/assets/opencode/herdr-agent-state.js), [TUI session plugin](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/integration/assets/opencode/herdr-tui-session.js), [plugin manifest](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/app/api/plugins/manifest.rs), [custom resume handling](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/app/api/panes.rs#L1554-L1698).
- fx [`9828612`](https://github.com/vercel-labs/fx/tree/9828612648a279c52129d59dab586e01a90c8ebd): [native reporter](https://github.com/vercel-labs/fx/blob/9828612648a279c52129d59dab586e01a90c8ebd/src/builtins/hooks/herdr.zig), [hook wiring](https://github.com/vercel-labs/fx/blob/9828612648a279c52129d59dab586e01a90c8ebd/src/builtins/hooks.zig), [OSC reporter](https://github.com/vercel-labs/fx/blob/9828612648a279c52129d59dab586e01a90c8ebd/src/ui/terminal/program_status.zig).

These are interface baselines, not assertions that every released binary implements them.
