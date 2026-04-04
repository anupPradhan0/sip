import { Request, Response } from "express";
import { env } from "../../../config/env";
import { logger } from "../../../utils/logger";
import {
  extractKullooCallIdFromSources,
  extractPlivoCallUuidFromSources,
} from "../../../utils/plivo-payload";

export function sendPlivoAnswerXml(req: Request, res: Response): void {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const query = req.query as Record<string, unknown>;
  const body =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : {};

  const callUuid = extractPlivoCallUuidFromSources(query, body);
  const kullooCallId = extractKullooCallIdFromSources(query, body);
  const freeswitchSipUri = env.freeswitchSipUri;

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

export function plivoHangupAck(_req: Request, res: Response): void {
  res.status(200).json({ success: true });
}
