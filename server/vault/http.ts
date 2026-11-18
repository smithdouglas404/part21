import { Router, type Request, type RequestHandler } from "express";
import { getEvidenceRuntime, type EvidenceVaultService } from "../evidence-vault";
import { required, type EvidencePrincipal } from "./types";

/** Parent mounts behind its authentication layer; body actors are ignored. This module never registers routes globally. */
export function createEvidenceVerificationRouter(resolvePrincipal:(req:Request)=>Promise<EvidencePrincipal>,runtime:()=>EvidenceVaultService = getEvidenceRuntime) {
  const router = Router();
  const handle = (fn:(req:Request,res:Parameters<RequestHandler>[1])=>Promise<void>):RequestHandler => (req,res,next) => { void fn(req,res).catch(next); };
  const audit = (req:Request) => required(typeof req.query.auditId === "string" ? req.query.auditId : req.body?.auditId,"auditId");
  router.get("/status",handle(async (req,res) => { res.json(await runtime().getEvidenceVaultStatus(audit(req),await resolvePrincipal(req))); }));
  router.get("/assets/:assetId/download",handle(async (req,res) => {
    const revision = req.query.revision === undefined ? undefined : Number(req.query.revision);
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) throw new Error("Positive exact asset revision required");
    const result = await runtime().readEvidenceAsset(req.params.assetId,audit(req),await resolvePrincipal(req),revision);
    res.set(result.headers);res.send(result.bytes);
  }));
  router.get("/assets/:assetId/verify",handle(async (req,res) => {
    const revision = req.query.revision === undefined ? undefined : Number(req.query.revision);
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) throw new Error("Positive exact asset revision required");
    res.json(await runtime().verifyEvidenceAsset(req.params.assetId,audit(req),await resolvePrincipal(req),revision));
  }));
  router.get("/assets/:assetId/timeline",handle(async (req,res) => { res.json(await runtime().listEvidenceTimeline(req.params.assetId,audit(req),await resolvePrincipal(req))); }));
  router.post("/assets/:assetId/events/:eventId/proof",handle(async (req,res) => {
    const principal = await resolvePrincipal(req);
    res.json(await runtime().appendEvidenceEventProof({ assetId:req.params.assetId,eventId:req.params.eventId,auditId:audit(req),actor:principal.id }));
  }));
  router.get("/assets/:assetId/events/:eventId/proof/verify",handle(async (req,res) => { res.json(await runtime().verifyEvidenceEventProof(req.params.assetId,audit(req),req.params.eventId,await resolvePrincipal(req))); }));
  return router;
}
