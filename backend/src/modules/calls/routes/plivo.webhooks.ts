import type { Express } from "express";
import { plivoHangupAck, sendPlivoAnswerXml } from "../controllers/plivo-answer.controller";

/** Plivo XML Application routes (Answer / Hangup); mounted at app root, not under /api. */
export function registerPlivoWebhookRoutes(app: Express): void {
  app.all("/plivo/answer", (req, res) => {
    sendPlivoAnswerXml(req, res);
  });
  app.all("/api/plivo/answer", (req, res) => {
    sendPlivoAnswerXml(req, res);
  });

  app.post("/plivo/hangup", plivoHangupAck);
  app.post("/api/plivo/hangup", plivoHangupAck);
}
