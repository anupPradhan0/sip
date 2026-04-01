import { Router } from "express";
import { metrics } from "../services/observability/metrics.service";

export const metricsRouter = Router();

metricsRouter.get("/", (_req, res) => {
  res.status(200).json({ success: true, data: metrics.snapshot() });
});

