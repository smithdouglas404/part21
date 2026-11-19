# Example artifacts

Sample exports produced by the application, kept here so the shapes can be inspected without
running anything. They are **illustrations, not fixtures**: the application never reads this
directory, and deleting it changes no behaviour.

| File | What it shows |
|---|---|
| `10-cfr-part-21-regulatory-pack.json` | Regulatory pack structure: regulation sets, source references, provision identifiers. |
| `FIND-2026-04-bitemporal-graph.json` | A finding's graph export with valid-from and recorded-at timestamps, nodes, edges and temporal events. |
| `FIND-CUSTOM-07-agentkit-execution.json` | A five-phase AgentKit execution trace with tool calls and human-gate decisions. |
| `agentkit-manifest.json` | Manifest declaring phases, tools, skills and gates. |
| `part21-policy-graph.json` | Policy-as-code graph: obligations, evaluators and their regulatory sources. |
| `part21-policy-pack.json` | Compiled policy pack consumed by the runtime evaluator. |

## Provenance

All records are synthetic. Finding identifiers, products, suppliers and people are invented
for demonstration and do not describe any real facility, licensee or supplier.

Regulatory citations inside these files were checked against the ingested eCFR snapshot at the
time of export. That does not make them current: the regulation may have changed since. Verify
against the official source before relying on any citation.

## Regenerating

These are snapshots in time. To produce current equivalents, run the application against your
own database and use the export endpoints; there is no script that regenerates them from
nothing, because doing so would require inventing data.
