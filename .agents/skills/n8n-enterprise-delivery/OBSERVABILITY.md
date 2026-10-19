# Observability: log streaming destinations and events

Reference depth for the observability section of `SKILL.md`.

## Log streaming: destinations and event catalog

**Destinations:** syslog (UDP, TCP, TLS), generic webhook (GET, POST, PUT), Sentry.
Each destination is an object with a type plus that type's config.

**Event groups.** Subscribe by prefix (`n8n.audit`, `n8n.workflow`) or pick
individual events under Settings > Log Streaming > Events.

| Group | Covers |
|---|---|
| `n8n.workflow.*` | started, success, failed, cancelled |
| `n8n.node.*` | node started, node finished |
| `n8n.audit.*` | user management (login, signup, deletion, invitations, MFA, API, credentials), workflow create/update/delete/activate/archive, community and n8n package management, external secrets, role mapping, token exchange, sharing restrictions |
| `n8n.worker.*` | worker started, stopped |
| `n8n.queue.*` | job enqueued, dequeued, completed, failed, stalled |
| `n8n.runner.*` | task requested, response received |
| AI node logs | memory, embeddings, document processing, tool calls, vector store operations, LLM generation and errors |

**`n8n.audit.*` is the audit-trail answer.** When a security team asks for an audit
trail, this is what to show them, not execution data. Turn on
`anonymizeAuditMessages` to strip sensitive payload from audit events before they
leave the instance; do that whenever the destination is a shared SIEM.

`n8n.queue.*` earns its keep separately: stalled and failed job counts are the
signal that the topology is undersized, and they are easier to alert on than
worker CPU.

**Retention:** n8n is not the retention store. Events are written to a local log
file and forwarded from there; `N8N_EVENTBUS_LOGWRITER_LOGFULLPATH` sets the path
and `N8N_EVENTBUS_LOGWRITER_MAXTOTALMESSAGESPERFILE` bounds how much is parsed on
recovery. The retention answer to give a customer is their own SIEM policy, plus a
short local buffer. That is usually the answer they wanted, because it means
retention stays under their existing controls.
