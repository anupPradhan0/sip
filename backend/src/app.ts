import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { apiRouter } from "./routes";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware";
import { randomUUID } from "node:crypto";
import { logger } from "./utils/logger";

export const app = express();

app.set("trust proxy", 1);
app.set("etag", false);

app.use(cors());
app.use(helmet());

morgan.token("correlation-id", (req: express.Request) => req.correlationId ?? "-");
if (process.env.NODE_ENV === "production") {
  app.use(
    morgan(
      ':correlation-id :remote-addr :method :url HTTP/:http-version :status :res[content-length] - :response-time ms',
    ),
  );
} else {
  app.use(morgan(":correlation-id :method :url :status :response-time ms"));
}
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Correlation id for HTTP requests (best-effort).
app.use((req, res, next) => {
  const incoming = req.header("X-Correlation-Id")?.trim();
  const correlationId = incoming && incoming.length > 0 ? incoming : randomUUID();
  res.setHeader("X-Correlation-Id", correlationId);
  req.correlationId = correlationId;
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

function firstPlivoString(val: unknown): string | undefined {
  if (typeof val === "string" && val.trim().length > 0) return val.trim();
  if (Array.isArray(val) && typeof val[0] === "string" && val[0].trim()) return val[0].trim();
  return undefined;
}

/**
 * Plivo may call the Answer URL with GET or POST. Custom SIP headers from `sipHeaders` on `calls.create`
 * show up as `X-PH-KullooCallId` (see Plivo docs). They can appear in query string, form body, or with
 * slightly different key spelling — merge sources and fall back to scanning keys.
 */
function extractPlivoKullooCallId(req: express.Request): string | undefined {
  const query = req.query as Record<string, unknown>;
  const body =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : {};

  const directKeys = [
    "kullooCallId",
    "X-PH-KullooCallId",
    "x-ph-kulloocallid",
    "X_PH_KullooCallId",
    "SipHeader_X-PH-KullooCallId",
  ];

  for (const src of [query, body]) {
    for (const key of directKeys) {
      const v = firstPlivoString(src[key]);
      if (v && /^[a-fA-F0-9]{24}$/.test(v)) return v;
    }
  }

  for (const src of [query, body]) {
    for (const [key, val] of Object.entries(src)) {
      if (/kulloocallid/i.test(key)) {
        const v = firstPlivoString(val);
        if (v && /^[a-fA-F0-9]{24}$/.test(v)) return v;
      }
    }
  }

  return undefined;
}

function plivoCallUuid(req: express.Request): string | undefined {
  const query = req.query as Record<string, unknown>;
  const body =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : {};
  return firstPlivoString(query.CallUUID) ?? firstPlivoString(body.CallUUID);
}

function sendPlivoAnswerXml(req: express.Request, res: express.Response): void {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const callUuid = plivoCallUuid(req);
  const kullooCallId = extractPlivoKullooCallId(req);
  const baseUrl = getPublicBaseUrl(req);
  const freeswitchSipUri = process.env.FREESWITCH_SIP_URI?.trim();

  if (!freeswitchSipUri) {
    logger.error("plivo_answer_missing_freeswitch_sip_uri", {
      correlationId: req.correlationId,
      plivoCallUuid: callUuid,
      kullooCallId: kullooCallId ?? null,
    });
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
  const sipHeadersAttr =
    typeof kullooCallId === "string" && /^[a-fA-F0-9]{24}$/.test(kullooCallId.trim())
      ? ` sipHeaders="KullooCallId=${kullooCallId.trim()}"`
      : "";
  if (!kullooCallId && callUuid) {
    logger.warn("plivo_answer_missing_kulloo_call_id", {
      correlationId: req.correlationId,
      method: req.method,
      path: req.path,
      plivoCallUuid: callUuid,
      hint: "Check sipHeaders on calls.create and Plivo Answer URL method (GET vs POST).",
    });
  }

  logger.info("plivo_answer_bridge_to_freeswitch", {
    correlationId: req.correlationId,
    method: req.method,
    plPath: req.path,
    plivoCallUuid: callUuid ?? null,
    kullooCallId: typeof kullooCallId === "string" ? kullooCallId : null,
    hasSipHeaderReplay: Boolean(sipHeadersAttr),
  });
  res.type("application/xml").status(200).send(
    `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial${sipHeadersAttr}>
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
