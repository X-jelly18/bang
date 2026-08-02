import http2 from "http2";
import http2Proxy from "http2-proxy";
import fs from "fs";
import { URL } from "url";

const PORT = Number(process.env.PORT) || 8080;

type RouteMap = Record<string, string>;
let ROUTES: RouteMap = {};

function loadRoutes(): void {
  try {
    ROUTES = JSON.parse(fs.readFileSync("./routes.json", "utf8")) as RouteMap;
    console.log("Routes loaded:", ROUTES);
  } catch (err) {
    console.error("Failed to load routes:", err);
    ROUTES = {};
  }
}

loadRoutes();

fs.watchFile("./routes.json", () => {
  console.log("routes.json updated, reloading routes...");
  loadRoutes();
});

function getTarget(pathname: string): URL | null {
  for (const route of Object.keys(ROUTES)) {
    if (pathname.startsWith(route)) {
      try {
        return new URL(ROUTES[route]);
      } catch (err) {
        console.error(`Invalid URL target for route ${route}:`, ROUTES[route]);
      }
    }
  }
  return null;
}

const server = http2.createServer({ allowHTTP1: true });

// gRPC / HTTP2 Stream Handling
server.on("stream", (stream, headers) => {
  const pathname = (headers[":path"] as string) || "/";
  const target = getTarget(pathname);

  if (!target) {
    stream.respond({ ":status": 404, "content-type": "application/grpc" });
    stream.end();
    return;
  }

  http2Proxy.web(
    stream,
    headers,
    {
      hostname: target.hostname,
      port: Number(target.port) || (target.protocol === "https:" ? 443 : 80),
      protocol: target.protocol.replace(":", "") as "http" | "https",
    },
    (err) => {
      if (err && !stream.headersSent) {
        console.error("gRPC Proxy Error:", err);
        stream.respond({ ":status": 502, "content-type": "application/grpc" });
        stream.end();
      }
    }
  );
});

// Cloud Run Health Check Handler
server.on("request", (req, res) => {
  if (req.httpVersionMajor < 2 && (req.url === "/" || req.url === "/health")) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end();
});

// Graceful Shutdown Handler
process.on("SIGTERM", () => {
  console.log("SIGTERM received. Shutting down gracefully...");
  server.close(() => {
    process.exit(0);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Dedicated gRPC proxy running on port ${PORT}`);
});
              
