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

const server = http2.createServer();

server.on("request", (req, res) => {
  const pathname = req.url || "/";
  
  // Cloud Run HTTP/2 Health Check
  if (pathname === "/" || pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
    return;
  }

  const target = getTarget(pathname);

  if (!target) {
    res.writeHead(404, { "Content-Type": "application/grpc" });
    res.end();
    return;
  }

  http2Proxy.web(
    req,
    res,
    {
      hostname: target.hostname,
      port: Number(target.port) || (target.protocol === "https:" ? 443 : 80),
      // Bypass the strict "@types" definition to allow h2c ("http") routing
      protocol: target.protocol.replace(":", "") as any,
    },
    (err) => {
      if (err && !res.headersSent) {
        console.error("gRPC Proxy Error:", err);
        res.writeHead(502, { "Content-Type": "application/grpc" });
        res.end();
      }
    }
  );
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
