# eCFR ingestion findings

The official eCFR service supplies public regulatory text and metadata without an API key. The API structure response is a document hierarchy, not a ready-made nuclear operational knowledge graph. Full content is XML. GPO’s XML guide notes that paragraph numbering can occur as text without XML nesting, so clause-level parsing still needs validation; legal rules are not already executable in the API.

Verified source URLs:

- https://www.ecfr.gov/reader-aids/ecfr-developer-resources/rest-api-interactive-documentation — no API keys, XML transformations, metadata and historical search.
- https://www.ecfr.gov/reader-aids/ecfr-developer-resources/understanding-ecfr-dates — distinguish latest_amended_on, latest_issue_date, up_to_date_as_of and import_in_progress.
- https://www.ecfr.gov/api/versioner/v1/titles.json — fetched response identified Title 10 Energy and reported up_to_date_as_of 2026-11-09. This is the source-reported baseline observed on 2026-11-18, not a guarantee of regulatory freshness.
- https://www.ecfr.gov/api/versioner/v1/structure/2026-11-09/title-10.json — verified document hierarchy; compact Part 21 extraction saved in ecfr-observed-structure.json.
- https://www.ecfr.gov/api/versioner/v1/full/2026-11-09/title-10.xml?part=21 — verified full Part 21 content at pinned date.
- https://raw.githubusercontent.com/usgpo/bulk-data/master/ECFR-XML-User-Guide.md — XML divisions, paragraphs, unstable NODE values, limits of markup, legal status and authenticity.

Network requests from the application sandbox directly to the documentation webpage redirected to an access-verification page. That is not an API JSON response. A production adapter must verify final URL, content type and parser schema; fail visibly on CAPTCHA/access pages and never record them as regulatory text.

Use eCFR for regulatory text. NRC Regulatory Guides, inspection procedures, NEI guidance and licensed EPRI/NQA-1 documents need separate source adapters, controlled versions and licensing. Government regulatory text availability does not make all cited standards open-source or grant redistribution rights.

Important corrections from the team attachment and application:

1. §21.21(a)(1): evaluate as soon as practicable and ordinarily within 60 days of discovery. §21.21(a)(2): if a potentially substantial-safety-hazard-related evaluation cannot finish in time, a written interim report is due within 60 days, with expected completion date. Day 45 can be an internal escalation threshold; it is not a statutory rule.
2. §21.21(a)(3): qualifying evaluation results inform the responsible officer as soon as practicable and within five working days. §21.21(b) has a different five-working-day trigger: supplier determination that it lacks evaluation capability, followed by notification to purchasers/affected licensees. It is not a general licensee-to-vendor delegation rule.
3. §21.21(d)(3): initial notification within two days and written notification within 30 days are keyed to the responsible officer receiving the relevant information, not 30 days after the initial call.
4. §21.51 is Maintenance and inspection of records. §21.61 is Failure to notify. Heat-lot identity maps specifically to Appendix B Criterion VIII; nonconforming material maps to Criterion XV. Neither should be mislabeled as a generic Part 21 provision.
5. §21.51(a)(1)-(3) establish different retention triggers: evaluations at least five years after evaluation, supplier notices at least five years after notification, supplier purchaser records ten years after delivery. Other record classes and licensing bases require their own rules.
6. Appendix B XVII requires adequate, identifiable, retrievable QA records and retention responsibilities. It does not certify a storage vendor or require blockchain. Appendix B XVIII requires planned periodic audits, qualified auditors independent of the audited area, management review and follow-up.
7. §21.6 requires current Part21, section206 and procedures posted on covered US premises, with a specific alternative notice path when posting regulations/procedures is not practicable. Digital availability and SCWE are not substitutes for verifying the actual obligations.
8. RG1.164 Rev1 endorses EPRI3002002982 with exceptions/clarifications. Do not import the entire referenced standard as automatically binding law.

Regulatory URLs used: https://www.ecfr.gov/current/title-10/chapter-I/part-21/section-21.21 ; https://www.ecfr.gov/current/title-10/chapter-I/part-21 ; https://www.ecfr.gov/current/title-10/chapter-I/part-50/appendix-Appendix%20B%20to%20Part%2050 ; https://www.nrc.gov/docs/ML2403/ML24038A310.pdf .
