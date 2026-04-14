import { describe, it, expect } from 'vitest'
import { sanitizeErrorMessage } from '../sanitize-error'

describe('sanitizeErrorMessage', () => {
  it('returns the message of an Error', () => {
    expect(sanitizeErrorMessage(new Error('boom'))).toBe('boom')
  })

  it('passes through string', () => {
    expect(sanitizeErrorMessage('nope')).toBe('nope')
  })

  it('JSON.stringify falls back for objects', () => {
    expect(sanitizeErrorMessage({ a: 1 })).toBe('{"a":1}')
  })

  it('scrubs HOME from Error messages', () => {
    const home = process.env.HOME || process.env.USERPROFILE
    // Skip this test if we genuinely have no HOME set (rare CI edge case).
    if (!home) return
    const err = new Error(`ENOENT: ${home}/secret/path.txt`)
    expect(sanitizeErrorMessage(err)).toBe('ENOENT: ~/secret/path.txt')
  })

  it('scrubs HOME from raw string inputs too', () => {
    const home = process.env.HOME || process.env.USERPROFILE
    if (!home) return
    expect(sanitizeErrorMessage(`${home}/x.log not found`)).toBe('~/x.log not found')
  })

  it('handles null', () => {
    expect(sanitizeErrorMessage(null)).toBe('null')
  })

  it('handles undefined', () => {
    expect(sanitizeErrorMessage(undefined)).toBe('undefined')
  })

  it('falls back to String(err) for circular objects', () => {
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular
    const result = sanitizeErrorMessage(circular)
    // String(circular) === '[object Object]' — good enough to avoid a crash,
    // and the HOME scrubber pass is a no-op on a string with no HOME in it.
    expect(result).toBe('[object Object]')
  })

  it('falls back to String(err) when JSON.stringify returns undefined (e.g. top-level function)', () => {
    const fn = function boom() { return 1 }
    const result = sanitizeErrorMessage(fn)
    // Different Node versions stringify functions differently, so just
    // assert we got some non-empty string, not undefined.
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})
