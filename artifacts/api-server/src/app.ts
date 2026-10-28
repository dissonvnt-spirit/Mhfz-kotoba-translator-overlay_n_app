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
  methods: ["GET", "POST"],
  allowedHeaders: ["Authorization", "Content-Type", "X-Kotoba-Cloud-Consent"],
  credentials: false,
}));
app.use(express.json({ limit: "8kb" }));
app.use(express.urlencoded({ extended: true, limit: "8kb" }));

app.use("/api", router);

export default app;
