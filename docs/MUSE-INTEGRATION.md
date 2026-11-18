
## Conversational Part 21 agent and Kanban traceability

The connector now exposes two different operations. `part21_auditBriefAgent` retrieves the selected audit, relational records, and read-only graph components, then invokes the grounded LLM for a narrative. `part21_agentDialogue` is the conversational intake loop: Muse sends a field statement, the Part 21 agent loads controlled skills, asks follow-up questions, and stores the user and agent turns in MySQL.

A first dialogue creates one agent-owned Kanban item in `backlog` with `attention: true`. Later turns reuse the same `conversationId` and `kanbanItemId`. Each user, agent, and system message is stored as a `kanban_communication` record and carries the applied skill IDs. Documents, photos, and voice transcripts are stored as `kanban_attachment` records on the same item, with SHA-256 provenance. The audit-scoped Kanban lookup returns the full communication timeline, attachment list, skill IDs, explicit finding link, and evidence-quality state.

Use Muse with an audit ID:

```text
Use the Part 21 Compliance Agent for audit AUD-026. I found a new audit finding during receiving inspection. Start the agent intake dialogue, load the appropriate skills, and ask me the questions needed to define the issue.
```

Continue using the returned conversation ID:

```text
Continue the Part 21 agent dialogue for conversation AGENT-... with this answer: the affected receiving record is 2-481, heat 7B-441, observed today at receiving, and the evidence is inspection report EV-803. Keep the dialogue attached to its Kanban item.
```

To attach field evidence, use the returned Kanban item ID:

```text
Attach the receiving inspection report or voice transcript to Kanban item KB-... for audit AUD-026. Keep it associated with the existing agent conversation.
```

To activate the item, either use the Kanban UI or tell Muse:

```text
Move Kanban item KB-... to active.
```

`active` is normalized to the persisted `in_progress` stage. When an item enters `in_progress`, its active skill is returned and the item remains red/attention-required until it reaches `final`.

The interim dialogue never mutates the authoritative knowledge graph. It can read graph relationships for context and insight. A confirmed finding draft is stored in MySQL only after the human confirmation gate, and authoritative graph projection remains blocked until qualified report/finding approval.
