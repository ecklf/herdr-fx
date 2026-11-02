// Runtime-independent streaming OSC 7501 adapter. Never interprets screen text.
const ESC = 0x1b;
const MAX_SEQUENCE = 4096;

export function parseStatus(payload) {
  const fields = Object.create(null);
  for (const field of payload.split(":")) {
    const separator = field.indexOf("=");
    if (separator < 1) return;
    const key = field.slice(0, separator);
    if (Object.hasOwn(fields, key)) return;
    fields[key] = field.slice(separator + 1);
  }
  // fx owns the root record. Child/foreign records must not replace its state.
  if (fields.app !== "fx" || (fields.id && fields.id !== "0")) return;
  if (!["idle", "working", "blocked", "done", "error"].includes(fields.state)) return;
  let message;
  if (fields.msg) {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(fields.msg)) return;
    message = Buffer.from(fields.msg, "base64").toString("utf8")
      .replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
    message = [...message].slice(0, 256).join("");
  }
  return {
    state: fields.state,
    ...(fields.kind === "permission" || fields.kind === "question" ? { kind: fields.kind } : {}),
    ...(message ? { message } : {}),
  };
}

export class StatusDecoder {
  #mode = "text";
  #bytes = [];
  constructor(onStatus) { this.onStatus = onStatus; }

  write(chunk) {
    for (const byte of chunk) {
      if (this.#mode === "text") {
        if (byte === ESC) this.#mode = "escape";
      } else if (this.#mode === "escape") {
        this.#mode = byte === 0x5d ? "osc" : byte === ESC ? "escape" : "text";
        this.#bytes = [];
      } else if (this.#mode === "osc-escape") {
        if (byte === 0x5c) this.#finish();
        else {
          // An embedded escape aborts the malformed OSC and can start a new one.
          this.#bytes = [];
          this.#mode = byte === 0x5d ? "osc" : byte === ESC ? "escape" : "text";
        }
      } else if (byte === 0x07) {
        this.#finish();
      } else if (byte === ESC) {
        this.#mode = "osc-escape";
      } else if (this.#bytes.length >= MAX_SEQUENCE) {
        this.#bytes = [];
        this.#mode = "text";
      } else {
        this.#bytes.push(byte);
      }
    }
  }

  #finish() {
    const text = Buffer.from(this.#bytes).toString("utf8");
    this.#bytes = [];
    this.#mode = "text";
    if (!text.startsWith("7501;")) return;
    const status = parseStatus(text.slice(5));
    if (status) this.onStatus(status);
  }
}

export function toHerdrState(status) {
  switch (status.state) {
    case "working": return { state: "working" };
    case "idle":
    case "done": return { state: "idle" };
    case "error": return { state: "blocked", message: "fx turn failed" };
    case "blocked": return {
      state: "blocked",
      message: status.message ?? (status.kind === "permission" ? "Permission required" : "Input required"),
    };
    default: throw new Error(`Unsupported fx state: ${status.state}`);
  }
}
