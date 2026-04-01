import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { apiRouter } from "./routes";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware";
import { randomUUID } from "node:crypto";

export const app = express();

app.set("trust proxy", 1);
app.set("etag", false);

app.use(cors());
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Correlation id for HTTP requests (best-effort).
app.use((req, res, next) => {
  const incoming = req.header("X-Correlation-Id")?.trim();
  const correlationId = incoming && incoming.length > 0 ? incoming : randomUUID();
  res.setHeader("X-Correlation-Id", correlationId);
  (req as any).correlationId = correlationId;
  next();
});

function getPublicBaseUrl(req: express.Request): string {
  const explicit = process.env.PUBLIC_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  const proto = req.protocol;
  const host = req.get("host");
  return `${proto}://${host}`;
}

function sendPlivoAnswerXml(req: express.Request, res: express.Response): void {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const callUuid = (req.method === "GET" ? req.query.CallUUID : req.body?.CallUUID) as string | undefined;
  const baseUrl = getPublicBaseUrl(req);
  const freeswitchSipUri = process.env.FREESWITCH_SIP_URI?.trim();

  if (!freeswitchSipUri) {
    res.type("application/xml").status(200).send(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>FreeSWITCH SIP URI is not configured.</Speak>
  <Hangup />
</Response>`,
    );
    return;
  }

  // Route the call to our media plane (FreeSWITCH). Recording happens there (Kulloo-owned).
  res.type("application/xml").status(200).send(
    `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <User>${freeswitchSipUri}</User>
  </Dial>
</Response>`,
  );
}

function registerPlivoWebhookRoutes(): void {
  // Plivo may use GET or POST for Answer URL depending on product flow; accept any method.
  app.all("/plivo/answer", (req, res) => {
    sendPlivoAnswerXml(req, res);
  });
  app.all("/api/plivo/answer", (req, res) => {
    sendPlivoAnswerXml(req, res);
  });

  const hangup = (_req: express.Request, res: express.Response): void => {
    res.status(200).json({ success: true });
  };
  app.post("/plivo/hangup", hangup);
  app.post("/api/plivo/hangup", hangup);
}

registerPlivoWebhookRoutes();

app.use("/api", apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);
