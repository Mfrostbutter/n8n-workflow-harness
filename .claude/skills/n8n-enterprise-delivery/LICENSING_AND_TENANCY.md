# Licensing mechanics and tenancy isolation

Reference depth for the licensing and multi-tenancy sections of `SKILL.md`.

## Licensing and the air-gap detail

- License activation and renewal require **egress to n8n's license server**.
  There is no offline activation flow.
- The workable pattern for a restricted network is an **egress-restricted proxy**:
  allow only the license host, via the license-server proxy setting.
- **Auto-renew** trades a periodic egress requirement against the risk of a
  license lapsing during an outage window. Discuss it explicitly; do not leave
  the default unexamined.
- On production, **do not detach floating seats on shutdown** (set the detach
  flag false), or a restart can leave the instance unlicensed until it
  re-negotiates.

### The variables

| Variable | Type | Default | Notes |
|---|---|---|---|
| `N8N_LICENSE_ACTIVATION_KEY` | string | `''` | Initializes the license. No effect once the instance is already activated. |
| `N8N_LICENSE_SERVER_URL` | string | `https://license.n8n.io/v1` | The one host to allowlist. |
| `https_proxy_license_server` | string | none | Proxy for license HTTPS requests. **The name must be lowercase.** This is the egress-restricted answer. |
| `N8N_LICENSE_AUTO_RENEW_ENABLED` | boolean | `true` | Off means manual renewal **every 10 days**, via Settings > Usage and plan, then refresh. |
| `N8N_LICENSE_DETACH_FLOATING_ON_SHUTDOWN` | boolean | `true` | Set **`false` on production**. Default releases floating entitlements on shutdown, so a restart can come back unlicensed until it renegotiates. |
| `N8N_LICENSE_TENANT_ID` | number | `1` | Only set if n8n tells you to. |
| `N8N_HIDE_USAGE_PAGE` | boolean | `false` | Hides usage and plans in the UI. |

### The number to quote

**10 days.** With auto-renew disabled, a licensed instance needs a human to renew
in the UI on that cadence. So the honest air-gap answer is: n8n runs offline, but
licensed features need a path to `license.n8n.io` (directly or through
`https_proxy_license_server`) at least every 10 days, or a person clicking renew on
that cadence forever. Ask which of those the customer prefers. Both are worse than
allowlisting one host, which is usually what they agree to once the alternative is
concrete.

The firewall ask is small and worth stating that way: outbound HTTPS to one
hostname, no inbound, no data payload beyond license negotiation.

## The three isolation levels

| | L1: one instance, project per tenant | L2: instance per tenant, shared infra | L3: instance per tenant, dedicated infra |
|---|---|---|---|
| Encryption key | shared | per tenant | per tenant |
| Execution data | one database, shared | per tenant database or schema | per tenant cluster |
| Variables, tags | instance-global, visible across projects | per tenant | per tenant |
| Redis | shared | shared, namespaced by `QUEUE_BULL_PREFIX` | per tenant |
| Blast radius of a bad workflow | whole instance | that tenant's n8n, shared infra still at risk | that tenant only |
| Noisy-neighbour risk | high, one execution pool | medium, shared Postgres and Redis | low |
| Per-tenant version pinning | impossible | possible | possible |
| Ops cost | one upgrade | N upgrades, one pipeline | N upgrades, N stacks |
| Honest label | access separation | tenancy | isolation |

**L1 is only defensible when the tenants are internal teams inside one legal entity
and one security boundary.** The moment "tenant" means "another customer", L1 fails
the first security review it meets, because one encryption key and one execution
database means an n8n admin in one project can be shown another's data.

**L2 is the field standard.** Shared control plane (one Helm chart or Terraform
module, one release per tenant), shared Postgres cluster with a database per tenant,
shared Redis namespaced per tenant, workflow templates promoted into each tenant
from one repository.

**L3 is for a regulatory or contractual requirement**, data residency per tenant, or
a customer who will pay for a dedicated failure domain. Do not propose it as the
default; it multiplies the upgrade cost by the tenant count.

## Cost drivers to price, per tenant

Price these with the customer rather than quoting a number: licensing per instance,
baseline compute for an idle instance (main plus at least one worker, and idle is
not free), Postgres (dedicated database on a shared cluster is cheap, dedicated
cluster is not), the operational cost of N upgrades on their release cadence, and
the promotion pipeline, which stays one repository and N pulls at any level.

The question that decides the level is not cost. It is: **can any tenant ever see
another tenant's execution data?** If the answer must be no, L1 is out before the
conversation starts.

`[FIELD]` the reference architecture diagram and a priced comparison. Both need one
real multi-tenant build behind them. When an engagement produces one, record tenant
count, the level chosen, the actual monthly infrastructure cost per tenant, and how
long an N-tenant upgrade took end to end. That last number is the one customers
never believe until someone has measured it. Flagship playbook candidate.
