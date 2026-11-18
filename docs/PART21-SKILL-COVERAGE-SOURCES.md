# 10 CFR Part 21 skill-coverage sources

Verified 2026-11-18 against official NRC and eCFR sources.

- eCFR Part 21: https://www.ecfr.gov/current/title-10/chapter-I/part-21
- NRC Part 21 regulation index: https://www.nrc.gov/reading-rm/doc-collections/cfr/part021/index.html
- NRC implementation guidance: https://www.nrc.gov/facilities-safety/new-reactors/how-we-regulate/regulatory-oversight/quality-assurance-for-new-reactors/guidance-on-implementation-of-10-cfr-part-21-requirements

The current eCFR table of contents groups Part 21 into:

- General Provisions: §§ 21.1–21.8 (purpose, scope, definitions, interpretations, communications, posting, exemptions, information collection).
- Notification: § 21.21 (notification of failure to comply or existence of a defect and its evaluation).
- Procurement Documents: § 21.31.
- Inspections and Records: §§ 21.41–21.51.
- Enforcement: §§ 21.61–21.62.

The NRC implementation page identifies RG 1.234 and NEI 14-09 Rev. 1 as acceptable implementation guidance for evaluating and reporting defects. It highlights discovery, records for evaluations that do not result in notification, procurement-document language, supplier/purchaser communication, transfer of responsibility, and the evaluation/notification process flow.

Application design implication: do not create one generic “Part 21 skill.” Use a governed skill family organized around the regulated lifecycle and audit activities, while tagging each skill with applicable CFR sections and client-approved interpretation overlays. A skill may cover multiple sections; a section is not itself an executable interview. Final applicability, reportability, notification, and legal conclusions remain qualified human decisions.

## Adjacent nuclear overlays verified for architecture

- 10 CFR Part 50 Appendix B: https://www.ecfr.gov/current/title-10/chapter-I/part-50/appendix-Appendix%20B%20to%20Part%2050 — Criteria III, IV, VI, VII, VIII, XV, XVI, XVII, and XVIII create design, procurement, identification, nonconformance, corrective action, records, and independent-audit evidence expectations that are not contained in Part 21 itself.
- 10 CFR 50.7: https://www.ecfr.gov/current/title-10/chapter-I/part-50/section-50.7 — employee protection for protected activities and the Safety Conscious Work Environment overlay. This is related to reporting culture but is not the same control as Part 21 §§ 21.5–21.6 postings.
- 10 CFR 73.54: https://www.nrc.gov/reading-rm/doc-collections/cfr/part073/part073-0054.html — protection of digital computer and communication systems and networks associated with safety, security, emergency preparedness, and safeguards functions. This is a cyber-security boundary, not a Part 21 reporting rule.
- 10 CFR Part 810: https://www.nrc.gov/reading-rm/doc-collections/cfr/part810/ — assistance to foreign atomic-energy activities and nuclear technology transfer/export controls. It applies only when the data or activity falls within Part 810 scope; it should not be treated as a general cybersecurity rule.

The attached team material is directionally strong, but the application must correct three common conflations. The 60-day clock is for evaluation from discovery, with an interim report path if the evaluation cannot be completed within 60 days. The 5-working-day clock is for informing the responsible officer after a qualifying evaluation; the 2-day initial NRC notification and 30-day written notification apply to the notification path described in § 21.21(d)(3). Finally, SCWE, 10 CFR 73.54, Part 810, NQA-1, NUPIC, and Appendix B are adjacent or implementation overlays; they must be linked to Part 21 in the graph but not mislabeled as Part 21 provisions.
