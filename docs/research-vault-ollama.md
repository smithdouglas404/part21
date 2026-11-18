Keep the existing Node/MySQL graph app as the working system and add a **separate protected vault for original record bytes**. Use cryptographic event receipts to prove which record version supported which decision; hashes alone are not retained records. Treat Ollama as an optional inference provider, not as storage or a compliance control. “Mimo” and “MDB” likely mean MinIO and immudb, respectively, but that identification remains unconfirmed.

Verified **18 November 2026** by **Manus AI**. Research and this document only: no application edit, deployment, service installation or purchase.

## MinIO: useful locking semantics, but community maintenance has ended

The official community repository now prominently says **“THIS REPOSITORY IS NO LONGER MAINTAINED.”** This is stronger than older “maintenance mode” descriptions. Community source remains GNU AGPLv3; its README says distribution is source-only and historical precompiled binaries will not receive updates. The maintenance notice takes precedence over older README instructions promising fixes through source builds. Do not select that unmaintained branch by default for a new long-lived regulated vault. Review AGPL obligations against the actual intended use rather than assuming the adjacent Node app is automatically relicensed. [1]

The repository points to **AIStor Free**, a standalone edition under a free license, and **AIStor Enterprise**, a distributed commercial edition with support. Free price does not mean the same license, support commitments or deployment model as community MinIO. If MinIO remains preferred, evaluate the current AIStor edition, actual license and support terms separately; no purchase is recommended or authorized here. [1] [9]

Object lock operates on **individual object versions**, not merely a filename. It requires versioning. Uploading to the same key creates a new version; an unversioned delete can add a delete marker that hides the current object without deleting protected versions. The app must preserve and retrieve the exact bucket, key and version ID, not rely on “latest.” Versioning alone is insufficient because specific unlocked versions can be deleted. [2] [3]

**Governance mode** protects against ordinary users but permits authorized bypass. Current AIStor documentation requires `s3:BypassGovernanceRetention`, the bypass request header, and, for changing retention, `s3:PutObjectRetention`. It is appropriate for controlled testing or deliberately overridable retention, not a claim that administrators cannot remove records. **Compliance mode** prevents deletion and shortening or removal of retention during the protected period, including through the root API account. Retention can be extended under the S3 semantics linked by MinIO; validate exact permissions and behavior on the chosen release. [2] [3] [10]

**Legal hold** is indefinite until an authorized user explicitly lifts it. It complements timed retention: protected versions remain locked until the hold is lifted and retention has expired. It is not irrevocable, and a hold applied to existing objects does not automatically cover future uploads. Give hold-release privileges to a separate controlled role and record the reason and approval. [2] [3]

Edition matters: the community retention guide requires enabling lock at bucket creation, while current AIStor documentation permits enabling it on existing buckets beginning with `RELEASE.2025-05-20T20-30-00Z`. Do not assume current commercial instructions describe a legacy community build. Locking is a storage-service/API control, not protection against destruction of underlying disks, compromised host administration or loss of encryption keys. Separate backup, recovery, host controls and trusted time remain necessary; MinIO documents system-clock or configured NTP time for retention dates. [2] [3]

## immudb: verifiable event history, not a substitute for a WORM bytes vault

immudb supports key-value, SQL and document access over a cryptographically linked transaction history. Updates add new history rather than silently rewriting previous transactions. Its own documentation explicitly recommends use as a secondary database to verify checksums or important data without replacing the primary application database. This fits the existing MySQL graph better than a database migration. [4] [11]

The critical limitation is in its official **retention** documentation: automated retention and manual truncation can delete actual values from the value log while retaining proofs and schema. Therefore “immutable database” must not be equated with guaranteed WORM retention of document bytes. It can store bytes, but its proof and retention mechanisms are different from MinIO/S3 compliance lock and legal hold. A surviving digest cannot reproduce a lost PDF, workbook, photograph or approval record. [12]

Verification needs an independent trust boundary. The official auditor guide recommends a separate independent auditor, retained root hashes and optional server-signature verification against a configured public key. Store checkpoints durably outside the database administrator’s control, not just in an ephemeral container or the auditor’s default temporary directory. An attacker who replaces both the database and every trusted checkpoint can undermine the value of historical verification. [13]

Also distinguish chain verification from checking stored values. The official v1.11.1 release adds opt-in `--audit-verify-values` to reread and SHA-256-check committed values after chain-proof verification; default auditing remains chain-only. If adopted, validate value checking as well as historical consistency and test alarms and recovery. The repository has recent release activity, including v1.11.2 published 3 September 2026; this is evidence of maintenance, not an SLA. [14] [15]

Current source is **Business Source License 1.1**, not a blanket Apache-2.0 offering. Its license covers v1.9DOM.2 or later, permits production use subject to its competitive-offering restriction, explicitly excludes internal organizational use from that competitive definition, and changes each version to Apache 2.0 after four years. Older documentation still carries an Apache footer. Review the exact chosen release and intended hosted/embedded business model before adoption. [4] [5] [16]

## Practical vault boundary for the present app

Prioritize a maintained, versioned, object-lock-capable service outside the managed small-memory application container. Since no air gap is required now, an approved managed object-lock service is a reasonable lower-operations option; a separately administered supported object store is another. Do not co-host MinIO/AIStor, immudb and Ollama beside Node/MySQL merely because they can run in containers. Actual memory limits, persistent disk guarantees, private networking and backups have not been inspected in this research.

The vault should retain the original uploaded bytes, approved reports and signed decision artifacts. Keep parsed text, OCR and AI-derived material as separately identified derivatives, never replacements for originals. MySQL should retain graph links and searchable metadata, including the immutable object version reference, SHA-256 digest, byte length, media type, source, intake time, audit scope and acceptance status.

An optional immudb ledger should retain a **canonical event payload plus its hashes**, not just bare digests: record and object-version IDs, source digest, actor identity, action, timestamps, provenance, policy/ontology revision, human approval and supersession relationship. Retain the complete decision artifact in the bytes vault. Bind signed event receipts to that exact record version. This separates evidence preservation from evidence-history verification.

A future implementation should promote a record to “vaulted” only after upload, read-back digest verification and confirmation of its version, retention and hold state. Use an idempotent pending/outbox/reconciliation path for MySQL-to-vault/ledger writes; these systems are not one atomic transaction. Never silently fall back to ordinary uploads, mutable database rows or local temporary files while displaying “protected.”

## Ollama: local API is feasible, but use a separate inference host

Ollama provides a local HTTP API at `http://localhost:11434/api` and an OpenAI-compatible endpoint at `/v1`. Its `/api/chat` supports function schemas and returns tool calls for the application to execute. It also supports `format: "json"` and a JSON Schema through `format`; validate the resulting JSON in the app and test the selected model’s tool behavior. Schema conformity does not establish factual accuracy or authorize a mutation. Official documentation currently says Ollama cloud does not support structured outputs. [7] [8] [17]

Local inference does not send prompts or responses to Ollama, according to its FAQ. However, **a localhost API request can still invoke a cloud model** when that model is selected and the server is signed in. Local URL alone is not proof of local inference. To disable Ollama cloud models and web search, set `OLLAMA_NO_CLOUD=1` or `{"disable_ollama_cloud": true}` in `~/.ollama/server.json`, restart and verify the `Ollama cloud disabled: true` log. Also allowlist approved local model identifiers and record the actual provider/model used. [6] [18]

This setting is not an air-gap switch for the whole system. Model pulls use the Internet, updates may download, and external app tools remain external. **Muse field input remains an external input/data path even if inference is local.** Local Ollama does not make Muse, the managed app host, storage providers or other connectors local. Preserve Muse source identity, message/artifact IDs, raw input and intake provenance; assess that connector’s permissions and data handling separately. [6]

The local API requires **no authentication** and binds to `127.0.0.1:11434` by default. A managed app’s `localhost` is its own container, not a user workstation. For a separate Ollama host, require explicit private reachability, authenticated access and TLS at a gateway or equivalent boundary; do not publicly expose the unauthenticated service. [6] [18]

Sizing is model-, quantization-, context- and concurrency-dependent, not one universal minimum. CPU inference uses RAM; GPU inference uses VRAM or a mixture. Longer contexts and parallel requests increase memory, and models remain loaded for five minutes by default unless `keep_alive` or server settings change that. A GPU is not mandatory, but CPU latency may be unsuitable. Benchmark a small approved model on a separately sized persistent host before promising capacity. Optional bounded initial settings include one loaded model, one parallel request, a deliberately limited context and short keep-alive. Keep Ollama disabled/unconfigured until that host exists; never imply local inference has occurred. [6]

## What this can and cannot establish for nuclear records

No MinIO, immudb or Ollama product automatically certifies the application to **10 CFR Part 50 Appendix B**, establishes record truth, or creates legal nonrepudiation. Appendix B **Criterion XVII** is Quality Assurance Records; **Criterion XVIII** is Audits. Criterion XVII requires sufficient identifiable and retrievable records with retention duration, location and assigned responsibility established consistently with applicable requirements. NRC electronic-record guidance also addresses authenticity, alteration prevention, disaster recovery and software configuration under the organization’s QA program. A storage vendor’s SEC/FINRA/CFTC assessment is not an Appendix B determination. [3] [19] [20]

Choose retention from record category and the applicable QA/contract/regulatory basis, not an arbitrary bucket default. For example, current **10 CFR 21.51** specifies at least five years after evaluation for deviation/failure evaluations, at least five years after notification for supplier notifications, and ten years after delivery for supplier basic-component purchaser records. Design-certification/approval categories include separate fifteen-year purchaser-record rules. Hold cases and other applicable commitments may require longer preservation. The schedule needs a qualified owner and documented triggering date. [21]

Hashes support change detection. Database-state signatures support verification against a trusted signing key; they do not prove which human reviewed a finding or that an uploaded statement is correct. Strong attribution requires identity-bound approvals or signatures over the exact artifact/event, controlled keys and trusted public-key bindings, timestamps, least-privilege roles, separation of administration from approval/hold release, independent checkpoints, protected backups and tested restoration. Preserve legible, complete records throughout retention. AI output remains a recommendation until qualified human acceptance; describe controls as configured and tested, never as automatic certification. [11] [13] [19] [20]

## References

[1]: https://github.com/minio/minio "MinIO community repository and current maintenance notice"
[2]: https://github.com/minio/minio/blob/master/docs/bucket/retention/README.md "MinIO community Object Lock and Immutability Guide"
[3]: https://docs.min.io/aistor/administration/object-locking-and-immutability/ "AIStor object locking, versioning, retention modes and legal holds"
[4]: https://github.com/codenotary/immudb "immudb current repository capabilities and licensing"
[5]: https://docs.immudb.io/master/ "Older immudb documentation overview with Apache footer"
[6]: https://docs.ollama.com/faq "Ollama local FAQ, privacy, cloud disable, networking and resources"
[7]: https://docs.ollama.com/capabilities/structured-outputs "Ollama structured JSON and schema outputs"
[8]: https://docs.ollama.com/capabilities/tool-calling "Ollama tool calling and application execution examples"
[9]: https://www.min.io/download "AIStor download and standalone free-license offering"
[10]: https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html "S3 Object Lock version, mode, retention extension and hold semantics"
[11]: https://immudb.io/docs/immudb/ "immudb capabilities, secondary database role and signed states"
[12]: https://immudb.io/docs/production/retention/ "immudb retention and manual value-log truncation"
[13]: https://immudb.io/docs/production/auditor/ "immudb independent auditor, root hashes and public-key verification"
[14]: https://github.com/codenotary/immudb/releases "immudb release history and v1.11.1 optional value verification"
[15]: https://github.com/codenotary/immudb/releases/tag/v1.11.2 "immudb v1.11.2 maintenance release published September 2026"
[16]: https://github.com/codenotary/immudb/blob/master/LICENSE "immudb Business Source License 1.1 and additional production-use grant"
[17]: https://docs.ollama.com/api/introduction "Ollama local and cloud API endpoints and JavaScript library"
[18]: https://docs.ollama.com/api/authentication "Ollama unauthenticated local API and cloud model routing through local server"
[19]: https://www.ecfr.gov/current/title-10/chapter-I/part-50/subject-group-ECFR89aa6ca4aada73c/appendix-Appendix%20B%20to%20Part%2050 "10 CFR Part 50 Appendix B, Criterion XVII records and XVIII audits"
[20]: https://www.nrc.gov/documents-reports/generic-communications/regulatory-issue-summaries/2000/ri00018 "NRC RIS 2000-18 electronic QA record integrity, authenticity and recovery guidance"
[21]: https://www.ecfr.gov/current/title-10/chapter-I/part-21/section-21.51 "10 CFR 21.51 record retention categories and inspection obligations"
