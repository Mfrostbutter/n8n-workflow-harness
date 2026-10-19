# Scaling: concurrency knobs and sizing

Reference depth for the queue mode section of `SKILL.md`.

## The concurrency knobs

| Knob | Default | What it does |
|---|---|---|
| `N8N_CONCURRENCY_PRODUCTION_LIMIT` | disabled | Caps concurrent **production** executions (webhook and trigger started). Excess queues FIFO. |
| `--concurrency` (worker flag) | per worker | Per-worker execution slots in queue mode. |
| `N8N_CONCURRENCY_EVALUATION_LIMIT` | tier: Community/Pro 1, Business 3, Enterprise 5 | Caps concurrent evaluation test runs. Separate pool from production. |
| `OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS` | `false` | Send manual (editor) executions to workers instead of main. |
| `N8N_MULTI_MAIN_SETUP_ENABLED` | `false` | Multiple main processes, licensed. Leader key TTL 10s, check interval 3s. |
| `QUEUE_HEALTH_CHECK_ACTIVE` | `false` | The endpoint a load balancer or k8s probe needs. |
| `QUEUE_BULL_PREFIX` | none | Namespaces all queue keys. This is how two instances share one Redis. |
| `N8N_WEBHOOK_RESPONSE_RELAY_SIZE_MAX` | `64` (MiB) | Max response relayed worker to main. Larger needs `N8N_WEBHOOK_RESPONSE_RELAY_OFFLOAD_ENABLED`. |

Four consequences worth knowing before you set any of them:

1. **In queue mode, `N8N_CONCURRENCY_PRODUCTION_LIMIT` overrides the worker
   `--concurrency` flag** unless it is `-1`. Setting both and expecting the worker
   flag to win is a common misconfiguration.
2. **A queued execution cannot be retried.** Cancelling or deleting it removes it
   from the queue. So the production limit is backpressure, not a durable buffer.
   If the customer needs a durable buffer, that is a queue in front of n8n, not
   this setting.
3. **Turn on `OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS`** on any instance where people
   build. Otherwise a developer testing a heavy workflow in the editor competes
   with the scheduler on main.
4. **Stalled-job handling can re-run an execution.** `QUEUE_WORKER_LOCK_DURATION`
   is 60000ms, renewed every `QUEUE_WORKER_LOCK_RENEW_TIME` 10000ms, with
   `QUEUE_WORKER_STALLED_INTERVAL` 30000ms and `QUEUE_WORKER_MAX_STALLED_COUNT` 1.
   An execution that blocks the event loop past the renew cadence can be treated as
   stalled and picked up again. Anything with a side effect needs to be idempotent,
   and that is a workflow design requirement, not a config fix.

## Sizing method

Measure, do not guess. Collect peak executions per minute, p95 execution duration,
payload sizes, retention settings (`EXECUTIONS_DATA_*`), and binary volume, then
set the production limit at the concurrency the instance sustains under a load test
rather than at a round number.

`[FIELD]` observed thresholds. Once an engagement has load-tested a real topology,
record here: instance size, worker count and per-worker concurrency, sustained
executions per minute, p95 duration, and what fell over first. Three or four real
data points make the next sizing conversation defensible; zero means it is a guess
regardless of how confident it sounds.
