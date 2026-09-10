import { describe, expect, it } from "vitest";
import net from "node:net";
import { resolvePort } from "./port.js";

function listenOn(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.once("listening", () => resolve(server));
    server.listen(port, "127.0.0.1");
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("resolvePort", () => {
  it("returns the preferred port when it's free", async () => {
    // Pick an ephemeral port first so the test doesn't depend on a fixed
    // number being free on the machine running it, then ask resolvePort for
    // exactly that one.
    const probe = await listenOn(0);
    const preferred = (probe.address() as net.AddressInfo).port;
    await close(probe);

    expect(await resolvePort(preferred)).toBe(preferred);
  });

  it("falls back to the next free port when the preferred one is taken", async () => {
    const held = await listenOn(0);
    const preferred = (held.address() as net.AddressInfo).port;

    const resolved = await resolvePort(preferred);
    expect(resolved).not.toBe(preferred);
    expect(resolved).toBeGreaterThan(preferred);

    await close(held);
  });
});
