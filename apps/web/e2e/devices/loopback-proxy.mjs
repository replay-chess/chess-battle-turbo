// A loopback TCP proxy for the visual baselines in the official Playwright image (layout/*.visual.spec.ts): the page
// must load from http://localhost (a secure context, as in CI) while the app runs on the Docker host.
//   node e2e/devices/loopback-proxy.mjs <listen port> <target host:port>
import net from "node:net";
import process from "node:process";

const [listen, target] = process.argv.slice(2);
if (!listen || !target) {
  console.error("usage: loopback-proxy.mjs <listen port> <target host:port>");
  process.exit(2);
}
const [host, port] = target.split(":");
net
  .createServer((client) => {
    const upstream = net.connect(Number(port), host);
    client.pipe(upstream).pipe(client);
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", close);
    upstream.on("error", close);
  })
  .listen(Number(listen), "127.0.0.1");
