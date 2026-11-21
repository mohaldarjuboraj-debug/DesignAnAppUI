export type ShiftTime = {
  tapIn: string
  tapOut?: string | null
  breaks?: { start: string; end?: string | null }[] | null
}
export function unpaidMilliseconds(shift: ShiftTime, now = Date.now()) {
  const shiftEnd = shift.tapOut ? Date.parse(shift.tapOut) : now
  return (shift.breaks ?? []).reduce((sum, b) =>
    sum + Math.max(0, Math.min(b.end ? Date.parse(b.end) : now, shiftEnd) -
      Math.max(Date.parse(b.start), Date.parse(shift.tapIn))), 0)
}
export function workingMilliseconds(shift: ShiftTime, now = Date.now()) {
  return Math.max(0, (shift.tapOut ? Date.parse(shift.tapOut) : now) -
    Date.parse(shift.tapIn) - unpaidMilliseconds(shift, now))
}
