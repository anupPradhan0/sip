import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { apiRouter } from "./routes";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware";
import { correlationIdMiddleware } from "./middlewares/correlation.middleware";
import { registerPlivoWebhookRoutes } from "./modules/calls/routes/plivo.webhooks";

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

app.use(correlationIdMiddleware);

registerPlivoWebhookRoutes(app);

app.use("/api", apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);
