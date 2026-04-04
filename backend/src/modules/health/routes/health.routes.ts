import { Router } from "express";
import { getLiveness, getReadiness } from "../controllers/health.controller";

export const healthRouter = Router();

healthRouter.get("/live", getLiveness);
healthRouter.get("/", getReadiness);
