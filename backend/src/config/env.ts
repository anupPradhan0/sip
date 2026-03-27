import dotenv from "dotenv";

dotenv.config();

const DEFAULT_PORT = 5000;
const DEFAULT_MONGO_URI = "mongodb://localhost:27017/sip-backend";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? DEFAULT_PORT),
  mongoUri: process.env.MONGODB_URI ?? DEFAULT_MONGO_URI,
};
