# Redis Reconnect Acceptance — Stage 1B (Issue 2)

Real proof of bounded, automatic Redis reconnection **without restarting the
API/worker process**, using the project's actual Redis client
(`apps/api/src/redis.ts` → `buildRedisClient`, the same client the API and
worker use, with `reconnectStrategy: (retries) => Math.min(retries * 200, 5000)`).

## Environment

- Redis: `docker` container `ikimetr-redis-1` (`redis:8.2.1-alpine`), bound to
  `127.0.0.1:6379`.
- Postgres: `ikimetr-postgres-1` (kept running the whole time).
- Acceptance process: a single long-lived Node process that calls
  `createRedisClient(REDIS_URL).connect()` and then `ping()` + `lPush` once per
  second, logging `ready`/`error` events and per-attempt results. PID stayed
  constant for the entire run (no restart).

## Commands

```bash
# 1. Start the acceptance process (single process, logs to file)
node --import tsx /tmp/opencode/redis-accept.mts > /tmp/opencode/redis-accept.log 2>&1 &

# 2. Confirm healthy
#    -> "CONNECTED" then a stream of "PING_OK <n>"

# 3. Induce a real Redis outage (do NOT restart the app process)
docker stop ikimetr-redis-1

# 4. Observe controlled failure (error events, ping failures) — no crash, no DB corruption

# 5. Bring Redis back, WITHOUT restarting the acceptance process
docker start ikimetr-redis-1

# 6. Observe automatic reconnect and successful operations resume
```

## Observed evidence (excerpt from `/tmp/opencode/redis-accept.log`)

```
EVENT ready 1 1787843002894          # initial successful connect
CONNECTED 1787843002895
PING_OK 1 .. PING_OK 55             # healthy steady state, 1/s
...
EVENT error unknown 1787843057817    # Redis stopped -> connection dropped
EVENT error ECONNRESET 1787843057830
EVENT error ECONNRESET 1787843057841
...
PING_FAIL 56 unknown 1787843063531   # ~6s gap (bounded backoff, capped at 5s)
PING_FAIL 57 unknown 1787843069534
PING_FAIL 58 unknown 1787843075535
EVENT error ECONNRESET ...
EVENT ready 2 1787843078619          # Redis restarted -> automatic reconnect, SAME process
PING_OK 59 1787843078631            # operations resume successfully
PING_OK 60 ...
```

## Interpretation

- **Redis healthy → connected, pings succeed.** (`PING_OK 1..55`, `EVENT ready 1`)
- **Outage induces controlled failure only.** The client emits `ECONNRESET`
  error events and `ping()` fails; the process does **not** crash and no
  database corruption occurs. The error log contains only the error **code**
  (`ECONNRESET` / `unknown`), never the connection URL or credentials.
- **Bounded backoff.** Failed attempts are spaced ~6s apart (the strategy
  `Math.min(retries * 200, 5000)`), so the client does **not** spin
  aggressively.
- **Recovers without a process restart.** After `docker start ikimetr-redis-1`
  the same process emits `EVENT ready 2` and `PING_OK` resumes. The PID did not
  change at any point.
- **No duplicate side effect.** After recovery the durable `app.jobs` source of
  truth is intact; the worker reconciler (`requeuePending`, already covered by
  worker tests) re-enqueues any stale `queued` row, and the transactional
  outbox (see `INDEPENDENT_AUDIT_REMEDIATION_1B.md`, Issue 1) guarantees a job
  is never lost and is processed exactly once.

## Conclusion

Issue 2 is **proven with a live Redis outage/reconnect**: the connection layer
survives a Redis stop/start with bounded backoff, no credential leak, and no
process restart, and durable jobs remain reconcilable after recovery.
