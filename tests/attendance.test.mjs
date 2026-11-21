import test from 'node:test'
import assert from 'node:assert/strict'
import { workingMilliseconds, unpaidMilliseconds } from '../src/lib/shift-time.ts'
import { distanceMeters, validCoordinates } from '../src/lib/attendance-rules.ts'

const hour = 3600000
const start = '2026-11-16T09:00:00.000Z'
test('completed unpaid breaks are excluded from working hours', () => {
  const shift = { tapIn: start, tapOut: '2026-11-16T17:00:00.000Z', breaks: [
    { start: '2026-11-16T12:00:00.000Z', end: '2026-11-16T12:30:00.000Z' },
    { start: '2026-11-16T15:00:00.000Z', end: '2026-11-16T15:15:00.000Z' },
  ] }
  assert.equal(unpaidMilliseconds(shift), hour * 0.75)
  assert.equal(workingMilliseconds(shift), hour * 7.25)
})
test('working time freezes while an unpaid break is running', () => {
  const shift = { tapIn: start, breaks: [{ start: '2026-11-16T12:00:00.000Z' }] }
  assert.equal(workingMilliseconds(shift, Date.parse('2026-11-16T12:30:00.000Z')), hour * 3)
  assert.equal(workingMilliseconds(shift, Date.parse('2026-11-16T13:00:00.000Z')), hour * 3)
})
test('a closed shift never continues accumulating unpaid break time', () => {
  const shift = { tapIn: start, tapOut: '2026-11-16T12:15:00.000Z', breaks: [{ start: '2026-11-16T12:00:00.000Z' }] }
  assert.equal(unpaidMilliseconds(shift, Date.parse('2026-11-17T00:00:00.000Z')), hour / 4)
  assert.equal(workingMilliseconds(shift), hour * 3)
})
test('legacy shifts without breaks retain their original duration', () => {
  assert.equal(workingMilliseconds({ tapIn: start, tapOut: '2026-11-16T17:00:00.000Z' }), hour * 8)
})
test('geofence distance calculation distinguishes inside and outside', () => {
  const office = { latitude: -37.88, longitude: 145.02 }
  assert.equal(distanceMeters(office, office), 0)
  assert.ok(distanceMeters(office, { latitude: -37.8796, longitude: 145.02 }) < 50)
  assert.ok(distanceMeters(office, { latitude: -37.8785, longitude: 145.02 }) > 150)
})
test('invalid location data is rejected', () => {
  assert.equal(validCoordinates({ latitude: 200, longitude: 0, accuracy: 5 }), false)
  assert.equal(validCoordinates({ latitude: 0, longitude: Infinity, accuracy: 5 }), false)
  assert.equal(validCoordinates({ latitude: 0, longitude: 0, accuracy: -1 }), false)
  assert.equal(validCoordinates({ latitude: -37.88, longitude: 145.02, accuracy: 8 }), true)
})
