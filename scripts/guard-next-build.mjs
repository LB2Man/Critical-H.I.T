import net from "node:net";

const shouldSkip = process.env.CI || process.env.VERCEL || process.env.ALLOW_BUILD_WITH_SERVER;

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.once("error", () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

if (!shouldSkip && (await isPortOpen(3000))) {
  console.error(
    "A local server is already running on port 3000. Stop it before building, or set ALLOW_BUILD_WITH_SERVER=1 if you know it is unrelated.",
  );
  process.exit(1);
}
