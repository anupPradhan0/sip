import { Router } from "express";
import { healthRouter } from "../modules/health/routes/health.routes";
import { metricsRouter } from "./metrics.routes";
import { userRouter } from "../modules/users/routes/user.routes";
import { callRouter, recordingRouter } from "../modules/calls/routes/call.routes";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/metrics", metricsRouter);
apiRouter.use("/users", userRouter);
apiRouter.use("/calls", callRouter);
apiRouter.use("/recordings", recordingRouter);
