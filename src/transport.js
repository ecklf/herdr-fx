import net from "node:net";
import { randomUUID } from "node:crypto";

// Full-operation deadline includes connecting, not just socket inactivity.
export function request(socketPath, method, params, { timeout = 500 } = {}) {
  return new Promise((resolve, reject) => {
    const id = `herdr-fx:${randomUUID()}`;
    const socket = net.createConnection(socketPath);
    let response = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("Herdr request timed out")), timeout);
    socket.on("connect", () => socket.write(`${JSON.stringify({ id, method, params })}\n`));
    socket.setEncoding("utf8");
    socket.on("data", (data) => {
      response += data;
      if (response.length > 65536) return finish(new Error("Herdr response too large"));
      const end = response.indexOf("\n");
      if (end < 0) return;
      try {
        const value = JSON.parse(response.slice(0, end));
        if (value.id !== id) throw new Error("Herdr response ID mismatch");
        if (value.error) throw new Error(`Herdr: ${value.error.code ?? "error"}: ${value.error.message ?? "request rejected"}`);
        finish(null, value.result);
      } catch (error) { finish(error); }
    });
    socket.on("error", (error) => finish(error));
    socket.on("end", () => finish(new Error("Herdr closed without a response")));
    socket.on("close", () => finish(new Error("Herdr socket closed")));
  });
}
