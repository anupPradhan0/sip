import { Request, Response } from "express";
import { getReadinessPayload } from "../../../services/health/readiness.service";

export function getLiveness(_req: Request, res: Response): void {
  res.status(200).json({
    success: true,
    status: "live",
    timestamp: new Date().toISOString(),
  });
}

export async function getReadiness(_req: Request, res: Response): Promise<void> {
  const payload = await getReadinessPayload();
  res.status(payload.ok ? 200 : 503).json({
    success: payload.ok,
    status: payload.status,
    message: payload.message,
    checks: payload.checks,
    uptimeSeconds: payload.uptimeSeconds,
    timestamp: payload.timestamp,
  });
}
