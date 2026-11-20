import { describe, expect, it } from "vitest";
import { notificationCandidate, signAlertPayload, verifyAlertSignature, webhookConfiguration } from "./alert-webhook";
import type { AuditAlert } from "./alerts";

const body = '{"event":"part21.alert.raised"}';
const secret = "test-secret";
const timestamp = "1763640000";

function alert(overrides: Partial<AuditAlert> = {}): AuditAlert {
  return {
    id: "WARN-TEST-1", auditId: "AUD-026", code: "finding-open-major", severity: "high",
    title: "Major finding remains open", narrative: "Sentence one. Sentence two.", status: "open",
    findingId: "F-042", sourceIds: ["F-042"], raisedAt: "2026-11-20T12:00:00.000Z", ...overrides,
  };
}

describe("alert webhook signing", () => {
  it("matches the published HMAC-SHA256 vector over timestamp.body", () => {
    expect(signAlertPayload(secret, timestamp, body)).toBe("sha256=c90fc640d2e947c6706032b22d301eba49a3d46bd87aea7022a7caff75e2af1a");
  });

  it("accepts a genuine signature and rejects tampering of body, timestamp or secret", () => {
    const signature = signAlertPayload(secret, timestamp, body);
    expect(verifyAlertSignature({ secret, timestamp, body, signature })).toBe(true);
    expect(verifyAlertSignature({ secret, timestamp, body: `${body} `, signature })).toBe(false);
    expect(verifyAlertSignature({ secret, timestamp: "1763640001", body, signature })).toBe(false);
    expect(verifyAlertSignature({ secret: "other", timestamp, body, signature })).toBe(false);
    expect(verifyAlertSignature({ secret, timestamp, body, signature: "" })).toBe(false);
  });

  it("only notifies open high and critical alerts", () => {
    expect(notificationCandidate(alert())).toBe(true);
    expect(notificationCandidate(alert({ severity: "critical" }))).toBe(true);
    expect(notificationCandidate(alert({ severity: "medium" }))).toBe(false);
    expect(notificationCandidate(alert({ severity: "low" }))).toBe(false);
    expect(notificationCandidate(alert({ status: "acknowledged" }))).toBe(false);
  });

  it("reports missing configuration honestly instead of pretending to be ready", () => {
    const saved = { url: process.env.PART21_ALERT_WEBHOOK_URL, secret: process.env.PART21_ALERT_WEBHOOK_SECRET };
    delete process.env.PART21_ALERT_WEBHOOK_URL;
    delete process.env.PART21_ALERT_WEBHOOK_SECRET;
    expect(webhookConfiguration().configured).toBe(false);
    process.env.PART21_ALERT_WEBHOOK_URL = "https://receiver.example.test/hooks/part21";
    expect(webhookConfiguration().urlConfigured).toBe(true);
    expect(webhookConfiguration().configured).toBe(false);
    process.env.PART21_ALERT_WEBHOOK_SECRET = "s3cret";
    expect(webhookConfiguration().configured).toBe(true);
    expect(webhookConfiguration().host).toBe("receiver.example.test");
    if (saved.url === undefined) delete process.env.PART21_ALERT_WEBHOOK_URL; else process.env.PART21_ALERT_WEBHOOK_URL = saved.url;
    if (saved.secret === undefined) delete process.env.PART21_ALERT_WEBHOOK_SECRET; else process.env.PART21_ALERT_WEBHOOK_SECRET = saved.secret;
  });
});
