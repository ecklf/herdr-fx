import { spawn } from "node:child_process";

// Inspect only the reported exact ID in the child's cwd. Never pick "latest"
// or read transcripts. Discard output so session content cannot leak to logs.
export function sessionExists(fxBin, id, cwd, timeout = 1500) {
  return new Promise((resolve) => {
    const child = spawn(fxBin, ["session", "--id", id, "--json"], {
      cwd, stdio: "ignore", env: { ...process.env, FX_HERDR: "0" },
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.once("error", () => { clearTimeout(timer); resolve(false); });
    child.once("exit", (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

export class SessionTracker {
  #id;
  #generation = 0;
  #saved = false;
  #checking = false;
  #closed = false;

  constructor({ exists, onSaved, onChanged = () => {}, onError = () => {} }) {
    this.exists = exists;
    this.onSaved = onSaved;
    this.onChanged = onChanged;
    this.onError = onError;
  }

  select(id) {
    if (this.#closed || id === this.#id) return;
    if (this.#id) this.onChanged();
    this.#id = id;
    this.#saved = false;
    this.#generation++;
    void this.check();
  }

  async check() {
    if (this.#closed || !this.#id || this.#saved || this.#checking) return;
    const generation = this.#generation;
    const id = this.#id;
    this.#checking = true;
    try {
      if (await this.exists(id) && generation === this.#generation && !this.#closed) {
        this.onSaved(id);
        this.#saved = true;
      }
    } catch (error) { this.onError(error); }
    finally {
      this.#checking = false;
      if (!this.#closed && generation !== this.#generation) void this.check();
    }
  }

  close() { this.#closed = true; this.#generation++; }
}
