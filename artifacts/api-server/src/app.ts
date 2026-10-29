import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Replit terminates public traffic at a reverse proxy. Trust only the nearest
// hop, not arbitrary client-supplied entries further left in X-Forwarded-For.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Tauri uses browser fetch from its packaged webview, so it needs explicit
// CORS permission. The hosted overlay uses same-origin requests.
const desktopOrigins = new Set(["http://tauri.localhost", "tauri://localhost"]);
if (process.env.NODE_ENV === "development") {
  desktopOrigins.add("http://localhost:1420");
}
app.use(cors({
  origin: (origin, callback) => callback(null, !!origin && desktopOrigins.has(origin)),
  methods: ["GET", "POST", "DELETE"],
  allowedHeaders: ["Authorization", "Content-Type", "X-Kotoba-Cloud-Consent"],
  credentials: false,
}));
// Only the archive endpoint accepts a larger structured import; translation
// endpoints keep their original small request limit.
app.use((req, res, next) => {
  if (req.path === "/api/dialogue-archives" && req.method === "POST") { next(); return; }
  express.json({ limit: "8kb" })(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: "8kb" }));

app.use("/api", router);

app.use((error: { type?: string; status?: number }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error.type === "entity.too.large") {
    res.status(413).json({ error: "File/import is too large. Use at most 1 MiB per archive." });
    return;
  }
  if (error.type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid JSON request." });
    return;
  }
  next(error);
});

export default app;
