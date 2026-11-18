import { createHash } from "node:crypto";
import { S3Client, GetBucketVersioningCommand, GetObjectLockConfigurationCommand, PutObjectCommand, GetObjectCommand, GetObjectRetentionCommand, GetObjectLegalHoldCommand, PutObjectLegalHoldCommand, PutObjectRetentionCommand } from "@aws-sdk/client-s3";
import { required, sha256, VaultProtectionError, type EvidenceAsset, type ExternalReference, type ProtectedVault } from "./types";

export type S3ObjectLockConfiguration = {
  provider: string; endpoint?: string; region: string; bucket: string;
  credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
  mode: "GOVERNANCE" | "COMPLIANCE"; forcePathStyle?: boolean;
};
export type S3CommandSender = { send(command: any): Promise<any> };
/** Supports a selected maintained S3 provider. No implicit MinIO/community deployment or bucket provisioning. */
export function createS3ObjectLockAdapter(config: S3ObjectLockConfiguration, injectedClient?: S3CommandSender): ProtectedVault {
  required(config.provider,"S3 provider"); required(config.bucket,"S3 bucket"); required(config.region,"S3 region");
  required(config.credentials?.accessKeyId,"S3 accessKeyId"); required(config.credentials?.secretAccessKey,"S3 secretAccessKey");
  if (config.endpoint && new URL(config.endpoint).protocol !== "https:") throw new Error("Configured S3 endpoint must use HTTPS");
  if (!["GOVERNANCE","COMPLIANCE"].includes(config.mode)) throw new Error("Explicit S3 retention mode required");
  const client = injectedClient ?? new S3Client({ ...config, credentials: config.credentials });
  const checkBucket = async () => {
    const [versioning, lock] = await Promise.all([
      client.send(new GetBucketVersioningCommand({ Bucket: config.bucket })),
      client.send(new GetObjectLockConfigurationCommand({ Bucket: config.bucket })),
    ]);
    if (versioning.Status !== "Enabled" || lock.ObjectLockConfiguration?.ObjectLockEnabled !== "Enabled") throw new Error("Bucket versioning and Object Lock must both be enabled");
  };
  const verify = async (asset: EvidenceAsset): Promise<{ sha256: string; reference: ExternalReference }> => {
    await checkBucket();
    const ref = asset.external;
    if (!ref || ref.provider !== config.provider || ref.bucket !== config.bucket || !ref.versionId || ref.versionId === "null") throw new Error("Exact configured provider/bucket/VersionId required");
    const expectedPrefix = `evidence/${encodeURIComponent(asset.auditId)}/${encodeURIComponent(asset.assetId)}/`;
    if (!ref.key.startsWith(expectedPrefix)) throw new Error("External reference key is outside the exact audit/asset namespace");
    const location = { Bucket: ref.bucket, Key: ref.key, VersionId: ref.versionId };
    const [object, retention, hold] = await Promise.all([
      client.send(new GetObjectCommand(location)),
      client.send(new GetObjectRetentionCommand(location)),
      client.send(new GetObjectLegalHoldCommand(location)),
    ]);
    if (object.VersionId !== ref.versionId || !object.Body) throw new Error("Readback did not return exact retained VersionId");
    const bytes = Buffer.from(await object.Body.transformToByteArray());
    const digest = sha256(bytes);
    if (bytes.length !== asset.sizeBytes || digest !== asset.sha256) throw new Error("Retained version original-byte digest mismatch");
    if (asset.retention.status !== "assigned" || !asset.retention.retainUntil) throw new Error("Reviewed retention policy is not assigned");
    const until = retention.Retention?.RetainUntilDate;
    const untilTime = until instanceof Date ? until.getTime() : Date.parse(String(until));
    if (retention.Retention?.Mode !== config.mode || !Number.isFinite(untilTime) || untilTime < Date.parse(asset.retention.retainUntil)) throw new Error("Retained version retention mode/date mismatch");
    const expectedHold = asset.retention.legalHold ? "ON" : "OFF";
    if (hold.LegalHold?.Status !== expectedHold) throw new Error("Retained version legal hold mismatch");
    return { sha256: digest, reference: { ...ref, mode: config.mode, retainUntil: new Date(untilTime).toISOString(), legalHold: asset.retention.legalHold } };
  };
  return {
    provider: config.provider,
    async protect(asset, bytes) {
      if (sha256(bytes) !== asset.sha256 || bytes.length !== asset.sizeBytes) throw new Error("Upload bytes do not match DB-preserved version");
      if (asset.retention.status !== "assigned" || !asset.retention.retainUntil || Date.parse(asset.retention.retainUntil) <= Date.parse(asset.recordedAt)) throw new Error("Future assigned record-specific retention is required before Object Lock upload");
      await checkBucket();
      const key = `evidence/${encodeURIComponent(asset.auditId)}/${encodeURIComponent(asset.assetId)}/${asset.revision}`;
      const result = await client.send(new PutObjectCommand({
        Bucket: config.bucket, Key: key, Body: bytes, ContentType: asset.mediaType,
        ContentMD5: createHash("md5").update(bytes).digest("base64"),
        ChecksumAlgorithm: "SHA256", ChecksumSHA256: Buffer.from(asset.sha256,"hex").toString("base64"),
        ObjectLockMode: config.mode, ObjectLockRetainUntilDate: new Date(asset.retention.retainUntil),
        ObjectLockLegalHoldStatus: asset.retention.legalHold ? "ON" : "OFF",
      }));
      if (!result.VersionId || result.VersionId === "null") throw new Error("Provider omitted protected object VersionId");
      const external: ExternalReference = { provider: config.provider,bucket:config.bucket,key,versionId:result.VersionId,mode:config.mode,retainUntil:asset.retention.retainUntil,legalHold:asset.retention.legalHold };
      try { return (await verify({ ...asset, external })).reference; }
      catch (error) { throw new VaultProtectionError(error instanceof Error ? error.message : String(error),external); }
    },
    verify,
    async updateHold(asset, legalHold) {
      const ref = asset.external;
      if (!ref) throw new Error("No exact protected version is available");
      await client.send(new PutObjectLegalHoldCommand({ Bucket: ref.bucket,Key:ref.key,VersionId:ref.versionId,LegalHold:{ Status:legalHold ? "ON" : "OFF" } }));
      return (await verify({ ...asset, retention:{ ...asset.retention,legalHold } })).reference;
    },
    async updatePolicy(asset) {
      const ref = asset.external;
      if (!ref || ref.bucket !== config.bucket || ref.provider !== config.provider || asset.retention.status !== "assigned" || !asset.retention.retainUntil) throw new Error("Exact protected version and assigned policy required");
      if (Date.parse(asset.retention.retainUntil) < Date.parse(ref.retainUntil)) throw new Error("Provider retention shortening is prohibited");
      await checkBucket();
      const location = { Bucket:ref.bucket,Key:ref.key,VersionId:ref.versionId };
      await client.send(new PutObjectRetentionCommand({ ...location,Retention:{ Mode:config.mode,RetainUntilDate:new Date(asset.retention.retainUntil) } }));
      await client.send(new PutObjectLegalHoldCommand({ ...location,LegalHold:{ Status:asset.retention.legalHold ? "ON" : "OFF" } }));
      return (await verify(asset)).reference;
    },
  };
}
