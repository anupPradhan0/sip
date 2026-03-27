import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { apiRouter } from "./routes";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware";

export const app = express();

app.use(cors());
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/plivo/answer", (_req, res) => {
  res.type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>Hello from kulloo hello call.</Speak>
  <Record maxLength="20" playBeep="false" />
  <Hangup />
</Response>`,
  );
});

app.use("/api", apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);
