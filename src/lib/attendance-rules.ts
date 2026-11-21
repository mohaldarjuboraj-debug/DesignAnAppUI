export type Coordinates = { latitude: number; longitude: number; accuracy: number }
export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = (n: number) => n * Math.PI / 180
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)))
}
export function validCoordinates(value: unknown): value is Coordinates {
  if (!value || typeof value !== 'object') return false
  const p = value as Coordinates
  return [p.latitude, p.longitude, p.accuracy].every(Number.isFinite) &&
    Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180 && p.accuracy >= 0
}
