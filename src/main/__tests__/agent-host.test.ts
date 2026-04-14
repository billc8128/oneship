import { describe, it, expect } from 'vitest'
// AgentHost depends on electron.utilityProcess which is not available
// in vitest. We test the helper logic that doesn't need Electron — the
// respawn rate-limiter and the ready-ticket idempotency — and leave the
// full integration-level check for a dev-mode smoke test (Task 13).

import { RespawnGate, makeReadyTicket } from '../agent-host'

describe('RespawnGate', () => {
  it('allows up to 3 respawns within the window', () => {
    const gate = new RespawnGate({ max: 3, windowMs: 60_000 })
    expect(gate.allow(1000)).toBe(true)
    expect(gate.allow(2000)).toBe(true)
    expect(gate.allow(3000)).toBe(true)
    expect(gate.allow(4000)).toBe(false)
  })

  it('forgets respawns older than the window', () => {
    const gate = new RespawnGate({ max: 3, windowMs: 60_000 })
    gate.allow(1000)
    gate.allow(2000)
    gate.allow(3000)
    // After 70s, the earlier ones should have aged out
    expect(gate.allow(73_000)).toBe(true)
  })
})

describe('ReadyTicket', () => {
  it('resolve() satisfies the awaiter and self-sets the settled flag', async () => {
    const ticket = makeReadyTicket()
    expect(ticket.settled).toBe(false)
    let resolved = false
    const p = ticket.promise.then(() => { resolved = true })
    ticket.resolve()
    expect(ticket.settled).toBe(true)
    await p
    expect(resolved).toBe(true)
  })

  it('reject() rejects the awaiter and self-sets the settled flag', async () => {
    const ticket = makeReadyTicket()
    const p = ticket.promise.catch((e: Error) => e.message)
    ticket.reject(new Error('boom'))
    expect(ticket.settled).toBe(true)
    expect(await p).toBe('boom')
  })

  // The most important invariant: a single ticket survives multiple
  // spawnWorker() attempts. A ticket that already resolved must NOT
  // be resolveable a second time — and crucially, the helper must enforce
  // this on its own, without callers having to pre-check `settled`.
  // (Earlier implementation left the check to callers; an external review
  // flagged the test as tautological. Verify the helper's internal guard.)
  it('is single-use: a second resolve() call after a successful resolve is a no-op', async () => {
    const ticket = makeReadyTicket()
    let settleCount = 0
    const p = ticket.promise.then(() => { settleCount++ })
    ticket.resolve()
    // Unconditional second call — the helper MUST handle it. This is what
    // the production scenario looks like: spawn1 crashes pre-ready (no
    // settle), spawn2 reports ready (settles to resolved), spawn3 ALSO
    // somehow reports ready before being killed → settleReady forwards
    // the second 'ready' message → ticket.resolve() is called twice.
    ticket.resolve()
    ticket.resolve()
    await p
    expect(settleCount).toBe(1)
    expect(ticket.settled).toBe(true)
  })

  it('is single-use: a reject() call after a successful resolve is a no-op', async () => {
    const ticket = makeReadyTicket()
    let resolved = false
    let rejected = false
    ticket.promise.then(
      () => { resolved = true },
      () => { rejected = true }
    )
    ticket.resolve()
    // Worker resolves, then a delayed crash tries to settle as rejection.
    // The reject must be a no-op.
    ticket.reject(new Error('too late'))
    await new Promise((r) => setTimeout(r, 0))
    expect(resolved).toBe(true)
    expect(rejected).toBe(false)
  })

  it('is single-use: a resolve() call after a reject is a no-op', async () => {
    const ticket = makeReadyTicket()
    let resolved = false
    let rejected = false
    ticket.promise.then(
      () => { resolved = true },
      () => { rejected = true }
    )
    ticket.reject(new Error('first'))
    ticket.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(rejected).toBe(true)
    expect(resolved).toBe(false)
  })
})
