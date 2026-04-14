import { describe, expect, it } from 'vitest'
import { mapHookEventToStatus } from '../hook-server'

describe('mapHookEventToStatus', () => {
  it('treats Claude permission-like notifications as waiting, but does not turn idle notifications red', () => {
    expect(
      mapHookEventToStatus({
        hookName: 'Notification',
        notificationType: 'permission_prompt',
        previousStatus: 'done',
      }),
    ).toBe('waiting')

    expect(
      mapHookEventToStatus({
        hookName: 'Notification',
        notificationType: 'elicitation_dialog',
        previousStatus: 'working',
      }),
    ).toBe('waiting')

    expect(
      mapHookEventToStatus({
        hookName: 'Notification',
        notificationType: 'idle_prompt',
        previousStatus: 'done',
      }),
    ).toBe('done')
  })

  it('marks terminal status from official failure and elicitation hook events', () => {
    expect(
      mapHookEventToStatus({
        hookName: 'StopFailure',
        previousStatus: 'working',
      }),
    ).toBe('error')

    expect(
      mapHookEventToStatus({
        hookName: 'Elicitation',
        previousStatus: 'working',
      }),
    ).toBe('waiting')

    expect(
      mapHookEventToStatus({
        hookName: 'ElicitationResult',
        previousStatus: 'waiting',
      }),
    ).toBe('working')
  })
})
