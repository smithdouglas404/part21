import "dotenv/config";
import { ENV } from "../server/_core/env";
import { sdk } from "../server/_core/sdk";

const token = await sdk.signSession(
  {
    openId: process.env.PART21_TEST_OPEN_ID ?? "hJb4ZHUeEmhQEsRt87jMfS",
    appId: ENV.appId,
    name: "Frank",
  },
  { expiresInMs: 90 * 60 * 1000 }
);
process.stdout.write(token);
