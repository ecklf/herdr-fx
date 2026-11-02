import net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function socketServer(handle) {
  const directory = await mkdtemp(join(tmpdir(), "hfx-test-"));
  const socketPath = join(directory, "s");
  const sockets = new Set();
  const server = net.createServer((client) => {
    sockets.add(client);
    client.on("error", () => {});
    client.on("close", () => sockets.delete(client));
    client.setEncoding("utf8");
    let buffer = "";
    client.on("data", (data) => {
      buffer += data;
      const newline = buffer.indexOf("\n");
      if (newline >= 0) handle(client, JSON.parse(buffer.slice(0, newline)));
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
  return { socketPath, directory, async close() {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  } };
}
