import { request } from "./transport.js";
import { toHerdrState } from "./osc.js";

export const SOURCE = "custom:herdr-fx";

export function validSessionId(id) {
  return typeof id === "string" && id.length > 0 && id.length <= 512 && !/[\s\p{Cc}']/u.test(id) && !id.startsWith("-");
}

export function validateResumeArgv(argv) {
  if (!Array.isArray(argv) || !argv.length || argv.length > 64 ||
      !argv.every((arg) => typeof arg === "string" && !/[\p{Cc}']/u.test(arg)) ||
      argv.reduce((size, arg) => size + Buffer.byteLength(arg), 0) > 8192 ||
      !/^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/.test(argv[0])) {
    throw new Error("Resume command is not representable by Herdr (plain executable, no control characters/apostrophes)");
  }
  return argv;
}

// Portable boundary: a future native fx hook can feed this without the PTY.
// Notifications are derived by Herdr; this module never sends its own toasts.
export class Reporter {
  #state = { state: "idle" };
  #resume;
  #queue = [];
  #running;
  #retry;
  #closed = false;
  #closing = false;
  #closePromise;
  #shutdownDeadline = Infinity;
  #revision = 0;
  #seq = Date.now() * 1000;
  #last;
  #identityRevision = 0;
  #needsReset = false;

  constructor({ paneId, socketPath, send = request, onError = () => {}, retryDelay = 500 }) {
    this.paneId = paneId;
    this.socketPath = socketPath;
    this.send = send;
    this.onError = onError;
    this.retryDelay = retryDelay;
  }

  status(status) {
    this.#state = toHerdrState(status);
    this.#publish();
  }

  // Call only after confirming this exact session has been saved in this cwd.
  session(id, resumeArgv) {
    if (!validSessionId(id)) throw new Error("Invalid fx session ID");
    this.#resume = { agent_session_id: id, resume_argv: validateResumeArgv(resumeArgv) };
    this.#publish();
  }

  invalidateSession() {
    this.#resume = undefined;
    // Clearing authority also clears an old resume plan before reacquiring it.
    // Keep the reset pending across failures; never reacquire with stale restore data.
    this.#identityRevision++;
    this.#needsReset = true;
    this.#queue = [];
    this.#last = undefined;
    this.#publish();
  }

  #publish(method = "pane.report_agent") {
    if (this.#closed || this.#closing) return;
    const value = method === "pane.report_agent" ? { ...this.#state, ...this.#resume } : {};
    const signature = JSON.stringify({ method, value });
    if (signature === this.#last) return;
    this.#last = signature;
    clearTimeout(this.#retry);
    this.#retry = undefined;
    const job = { method, value, revision: ++this.#revision, identityRevision: this.#identityRevision };
    // Bounded backlog. Retain normal transitions, but prefer fresh state under
    // prolonged socket failure or a hostile flood of terminal records.
    if (this.#queue.length >= 32) this.#queue.splice(1);
    this.#queue.push(job);
    this.#pump();
  }

  #pump() {
    if (this.#running || this.#closed) return;
    this.#running = this.#drain().finally(() => {
      this.#running = undefined;
      if (this.#queue.length && !this.#closed) this.#pump();
    });
  }

  async #drain() {
    while (this.#queue.length && !this.#closed) {
      if (Date.now() >= this.#shutdownDeadline) { this.#queue = []; break; }
      const job = this.#queue.shift();
      if (job.identityRevision !== this.#identityRevision) continue;
      try {
        if (this.#needsReset) {
          await this.send(this.socketPath, "pane.clear_agent_authority", this.#params({}));
          if (job.identityRevision !== this.#identityRevision) continue;
          this.#needsReset = false;
        }
        await this.send(this.socketPath, job.method, this.#params(job.value));
      } catch (error) {
        this.onError(error);
        if (!this.#closed && !this.#closing && job.revision === this.#revision) {
          this.#retry = setTimeout(() => {
            this.#retry = undefined;
            if (this.#closed || job.revision !== this.#revision) return;
            this.#queue.push(job);
            this.#pump();
          }, this.retryDelay);
          this.#retry.unref?.();
        }
      }
    }
  }

  #params(value) {
    return { pane_id: this.paneId, source: SOURCE, agent: "fx", seq: ++this.#seq, ...value };
  }

  async flush() {
    while (this.#running) await this.#running;
  }

  close() {
    if (this.#closePromise) return this.#closePromise;
    this.#closing = true;
    this.#shutdownDeadline = Date.now() + 1500;
    clearTimeout(this.#retry);
    this.#closePromise = (async () => {
      // Preserve accepted completion/restore reports behind an in-flight send.
      // Bound draining so a dead Herdr cannot strand an exiting terminal.
      await this.flush();
      this.#closed = true;
      this.#queue = [];
      try {
        await this.send(this.socketPath, "pane.clear_agent_authority", this.#params({}));
      } catch (error) { this.onError(error); }
    })();
    return this.#closePromise;
  }
}
