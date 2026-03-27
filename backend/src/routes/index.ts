import { Router } from "express";
import { healthRouter } from "./health.routes";
import { userRouter } from "./user.routes";
import { callRouter, recordingRouter } from "../modules/calls/routes/call.routes";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/users", userRouter);
apiRouter.use("/calls", callRouter);
apiRouter.use("/recordings", recordingRouter);
