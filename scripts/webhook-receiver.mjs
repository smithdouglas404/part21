#!/usr/bin/env node
// Reference receiver for Part 21 alert notifications.
// Verifies the HMAC-SHA256 signature over `${timestamp}.${rawBody}`, rejects stale or unsigned
// requests, and appends every accepted alert to a JSON-lines log. Run it with:
//   PART21_ALERT_WEBHOOK_SECRET=... node scripts/webhook-receiver.mjs
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";

const secret = process.env.PART21_ALERT_WEBHOOK_SECRET;
const port = Number(process.env.PORT ?? 4100);
const logPath = process.env.WEBHOOK_LOG ?? "/home/ubuntu/part21ops/.webhook-receiver.log";
const maxSkewSeconds = 300;
if (!secret) { console.error("PART21_ALERT_WEBHOOK_SECRET is required."); process.exit(1); }

function verify(timestamp, raw, signature) {
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex")}`;
  const a = Buffer.from(expected), b = Buffer.from(signature ?? "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/hooks/part21") { res.writeHead(404).end(); return; }
  const chunks = [];
  req.on("data", chunk => chunks.push(chunk));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    const timestamp = String(req.headers["x-part21-timestamp"] ?? "");
    const signature = String(req.headers["x-part21-signature"] ?? "");
    const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
    const signatureValid = verify(timestamp, raw, signature);
    const fresh = Number.isFinite(skew) && skew <= maxSkewSeconds;
    const entry = {
      receivedAt: new Date().toISOString(),
      deliveryId: req.headers["x-part21-delivery"] ?? null,
      severity: req.headers["x-part21-severity"] ?? null,
      signatureValid,
      fresh,
      accepted: signatureValid && fresh,
      body: raw ? JSON.parse(raw) : null,
    };
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
    if (!entry.accepted) { res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, signatureValid, fresh })); return; }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, received: entry.body?.alert?.id ?? null, signatureValid: true }));
  });
});
server.listen(port, "127.0.0.1", () => console.log(`alert receiver listening on http://127.0.0.1:${port}/hooks/part21`));
