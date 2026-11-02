import net from "node:net";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validSessionId } from "./reporter.js";

// fx has no external lifecycle-plugin loader. Consume its existing native
// reporter on a private socket rather than racing it on Herdr's real socket.
// No incoming request is forwarded or executed.
export async function createSessionRelay({ paneId, onSession, onFallbackStatus = () => {} }) {
  const directory = await mkdtemp(join(tmpdir(), "hfx-"));
  const socketPath = join(directory, "fx.sock");
  const clients = new Set();
  const server = net.createServer((client) => {
    clients.add(client);
    client.setEncoding("utf8");
    client.setTimeout(1000, () => client.destroy());
    client.on("error", () => {});
    client.on("close", () => clients.delete(client));
    let buffer = "";
    let handled = false;
    client.on("data", (data) => {
      if (handled) return;
      buffer += data;
      if (buffer.length > 16384) return client.destroy();
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      handled = true;
      try {
        const message = JSON.parse(buffer.slice(0, newline));
        const params = message.params ?? {};
        const target = message.method === "agent.rename" ? params.target : params.pane_id;
        if (typeof message.id !== "string" || target !== paneId) throw new Error("Invalid request");
        if (message.method === "pane.report_agent_session" || message.method === "pane.report_agent") {
          if (params.source !== "custom:fx" || params.agent !== "fx") throw new Error("Foreign reporter");
          if (validSessionId(params.agent_session_id)) onSession(params.agent_session_id);
          if (message.method === "pane.report_agent" && ["idle", "working", "blocked"].includes(params.state)) {
            onFallbackStatus({ state: params.state, message: params.custom_status ?? params.message });
          }
        } else if (!["pane.rename", "agent.rename", "pane.clear_agent_authority"].includes(message.method)) {
          throw new Error("Unsupported request");
        }
        client.end(`${JSON.stringify({ id: message.id, result: {} })}\n`);
      } catch {
        client.destroy();
      }
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => { server.off("error", reject); resolve(); });
    });
    await chmod(socketPath, 0o600);
  } catch (error) {
    server.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    socketPath,
    async close() {
      for (const client of clients) client.destroy();
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
