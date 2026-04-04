import { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("X-Correlation-Id")?.trim();
  const correlationId = incoming && incoming.length > 0 ? incoming : randomUUID();
  res.setHeader("X-Correlation-Id", correlationId);
  req.correlationId = correlationId;
  next();
}
