import { getPayload } from 'payload'
import config from '@payload-config'
import { appAuth, workspaceUser } from '@/lib/app-auth'
import { isManager } from '@/collections/Attendance'
import { distanceMeters, validCoordinates } from '@/lib/attendance-rules'

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } })
export async function GET() {
  const user = await workspaceUser()
  if (!user) return json({ user: null, records: [], alerts: [], boundary: null, team: [] })
  if (user.attendanceBlocked) {
    await appAuth.logout()
    return json({ user: null, records: [], alerts: [], boundary: null, team: [], notice: 'Your shift ended automatically after leaving the office area. An administrator must review and restore your access before you can sign in again.' })
  }
  const payload = await getPayload({ config })
  const [records, alerts, boundary, team] = await Promise.all([
    payload.find({ collection: 'attendance', user, overrideAccess: false, limit: 100, sort: '-tapIn', depth: 1, populate: { users: { name: true, email: true } } }),
    payload.find({ collection: 'boundary-alerts', user, overrideAccess: false, limit: 30, sort: '-createdAt', depth: 0 }),
    payload.findGlobal({ slug: 'office-boundary', user, overrideAccess: false }),
    isManager(user) ? payload.find({ collection: 'users', user, overrideAccess: false, limit: 100, depth: 0,
      select: { name: true, email: true, role: true, attendanceBlocked: true, blockedAt: true } }) : Promise.resolve({ docs: [] }),
  ])
  return json({ user: { id: user.id, name: user.name, email: user.email, manager: isManager(user), member: true,
    displayName: user.displayName, phone: user.phone, bio: user.bio }, records: records.docs, alerts: alerts.docs, boundary, team: team.docs })
}
export async function POST(request: Request) {
  // A custom header plus JSON-only requests prevent cross-site form submissions.
  if (request.headers.get('x-workspace-request') !== '1' || !request.headers.get('content-type')?.includes('application/json')) return json({ error: 'Invalid request.' }, 403)
  try {
    const body = await request.json()
    const payload = await getPayload({ config })
    if (body.action === 'forgot') {
      if (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || body.email.length > 254) return json({ error: 'Enter a valid personal email address.' }, 400)
      // Payload owns token creation, expiry, throttling, and one-use validation.
      // Keep the result independent of whether an account exists.
      try { await payload.forgotPassword({ collection: 'users', overrideAccess: false, data: { email: body.email.trim().toLowerCase() } }) }
      catch { payload.logger.warn('Password reset email request could not be completed; check email-provider configuration.') }
      return json({ message: 'If this email has an account, a reset link will be sent. Check your inbox and spam folder. If it does not arrive, contact your administrator.' })
    }
    if (body.action === 'reset') {
      if (typeof body.token !== 'string' || !body.token || body.token.length > 200 || typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128) return json({ error: 'Use a valid reset link and a new password of 12–128 characters.' }, 400)
      await payload.resetPassword({ collection: 'users', overrideAccess: false, data: { token: body.token, password: body.password } })
      await appAuth.logout()
      return json({ message: 'Password changed. You can now sign in with your new password.' })
    }
    if (body.action === 'login') {
      if (typeof body.email !== 'string' || typeof body.password !== 'string') return json({ error: 'Enter your email and password.' }, 400)
      await appAuth.login(body.email.trim(), body.password)
      return json({ message: 'Signed in successfully.' })
    }
    if (body.action === 'signup') {
      if (typeof body.name !== 'string' || body.name.trim().length < 2 || body.name.length > 100 || typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128) return json({ error: 'Enter your name, a valid email, and a password of 12–128 characters.' }, 400)
      await payload.create({ collection: 'users', overrideAccess: false, context: { signup: true },
        data: { name: body.name.trim(), email: body.email.trim().toLowerCase(), password: body.password } })
      await appAuth.login(body.email.trim().toLowerCase(), body.password)
      return json({ message: 'Your member account is ready.' })
    }
    if (body.action === 'logout') {
      const account = await workspaceUser()
      if (account && !account.attendanceBlocked) {
        const open = await payload.find({ collection: 'attendance', user: account, overrideAccess: false,
          where: { and: [{ person: { equals: account.id } }, { tapOut: { exists: false } }] }, limit: 1, depth: 0 })
        if (open.docs.length) return json({ error: 'Please tap out to end your shift before signing out.' }, 409)
      }
      await appAuth.logout()
      return json({ message: 'You have been signed out.' })
    }
    const user = await workspaceUser()
    if (!user) return json({ error: 'Please sign in to continue.' }, 401)
    if (user.attendanceBlocked) {
      await appAuth.logout()
      return json({ error: 'Your attendance is restricted after a boundary exit. Ask an administrator to restore access.', signedOut: true }, 403)
    }
    if (body.action === 'profile') {
      if (typeof body.displayName !== 'string' || body.displayName.length > 100 || typeof body.phone !== 'string' || body.phone.length > 40 || typeof body.bio !== 'string' || body.bio.length > 500) return json({ error: 'Check your display name, phone (40 characters maximum), and bio (500 characters maximum).' }, 400)
      await payload.update({ collection: 'users', id: user.id, user, overrideAccess: false, context: { profile: true },
        data: { displayName: body.displayName.trim(), phone: body.phone.trim(), bio: body.bio.trim() } })
      return json({ message: 'Your profile has been updated. Login details are unchanged.' })
    }
    if (body.action === 'clear-restriction') {
      if (!isManager(user)) return json({ error: 'Only administrators can restore attendance access.' }, 403)
      if ((typeof body.id !== 'string' && typeof body.id !== 'number') || typeof body.reason !== 'string' || body.reason.trim().length < 5 || body.reason.length > 1000) return json({ error: 'Choose a person and enter a clearance reason (5–1,000 characters).' }, 400)
      await payload.update({ collection: 'users', id: body.id, user, overrideAccess: false,
        data: { attendanceBlocked: false, clearanceReason: body.reason.trim() } })
      return json({ message: 'Access restored. The person can sign in again. Adjust their attendance separately if needed.' })
    }
    if (body.action === 'boundary') {
      if (!isManager(user)) return json({ error: 'Only administrators can change the office boundary.' }, 403)
      if (!validCoordinates({ latitude: body.latitude, longitude: body.longitude, accuracy: 0 }) || !Number.isFinite(body.radius) || body.radius < 25 || body.radius > 5000 || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100) return json({ error: 'Enter a location and a radius between 25 and 5,000 metres.' }, 400)
      await payload.updateGlobal({ slug: 'office-boundary', user, overrideAccess: false, data: { name: body.name.trim(), latitude: body.latitude, longitude: body.longitude, radius: body.radius } })
      return json({ message: 'Office boundary saved for everyone.' })
    }
    if (body.action === 'correct') {
      if (!isManager(user)) return json({ error: 'Only administrators can edit attendance.' }, 403)
      if ((typeof body.id !== 'string' && typeof body.id !== 'number') || typeof body.tapIn !== 'string' || (body.tapOut !== null && typeof body.tapOut !== 'string') || typeof body.reason !== 'string' || body.reason.trim().length < 5 || body.reason.length > 1000) return json({ error: 'Provide valid times and a correction reason (5–1,000 characters).' }, 400)
      await payload.update({ collection: 'attendance', id: body.id, user, overrideAccess: false,
        data: { tapIn: body.tapIn, tapOut: body.tapOut, correctionReason: body.reason.trim() } })
      return json({ message: 'Attendance corrected. Previous values are preserved in revision history.' })
    }
    if (body.action === 'tap' || body.action === 'position' || body.action === 'break') {
      if (user.collection !== 'users') return json({ error: 'Use a member app account to tap in or out.' }, 403)
      if (!validCoordinates(body.coordinates)) return json({ error: 'Fresh location access is required.' }, 400)
      if (body.action === 'break' && body.direction !== 'start' && body.direction !== 'finish') return json({ error: 'Choose start or finish unpaid break.' }, 400)
      const context = { attendanceCommand: true, coordinates: body.coordinates,
        ...(body.action === 'break' ? { breakAction: body.direction } : {}) }
      const open = await payload.find({ collection: 'attendance', user, overrideAccess: false, where: { and: [{ person: { equals: user.id } }, { tapOut: { exists: false } }] }, limit: 1, depth: 0 })
      const signedOut = async () => {
        await appAuth.logout()
        return json({ message: 'You left the permitted office area. Your shift and any unpaid break have ended, and you have been signed out. An administrator must review and restore your access.', signedOut: true })
      }
      if (body.action === 'break') {
        if (!open.docs.length) return json({ error: 'Tap in for your shift before recording a break.' }, 409)
        const updated = await payload.update({ collection: 'attendance', id: open.docs[0].id, user, overrideAccess: false, context, data: {} })
        if (updated.autoEnded) return signedOut()
        return json({ message: body.direction === 'start' ? 'Unpaid break started. This time is excluded from working hours.' : 'Unpaid break finished. You’re back on shift.' })
      }
      if (body.action === 'position') {
        if (!open.docs.length) return json({ message: 'No open session.' })
        const boundary = await payload.findGlobal({ slug: 'office-boundary', user, overrideAccess: false })
        if (boundary.latitude == null || boundary.longitude == null) return json({ error: 'An administrator must configure the office location first.' }, 400)
        if (body.coordinates.accuracy > Math.min(100, boundary.radius / 2)) return json({ error: 'GPS accuracy is too low. Move outdoors and try again.' }, 400)
        const distance = distanceMeters(body.coordinates, { latitude: boundary.latitude, longitude: boundary.longitude })
        const outside = distance - body.coordinates.accuracy > boundary.radius
        const inside = distance + body.coordinates.accuracy <= boundary.radius
        if ((!outside && !inside) || Boolean(open.docs[0].outside) === outside) return json({ message: 'Location checked. No confirmed boundary crossing.' })
        const updated = await payload.update({ collection: 'attendance', id: open.docs[0].id, user, overrideAccess: false, context, data: {} })
        if (updated.autoEnded) return signedOut()
        return json({ message: 'Location checked.' })
      }
      if (body.direction === 'out') {
        if (!open.docs.length) return json({ error: 'You are already tapped out. Refresh and try again.' }, 409)
        const updated = await payload.update({ collection: 'attendance', id: open.docs[0].id, user, overrideAccess: false, context, data: { tapOut: new Date().toISOString() } })
        if (updated.autoEnded) return signedOut()
      } else if (body.direction === 'in') {
        if (open.docs.length) return json({ error: 'You are already tapped in.' }, 409)
        await payload.create({ collection: 'attendance', user, overrideAccess: false, context, data: { person: user.id, tapIn: new Date().toISOString() } })
      } else return json({ error: 'Choose tap in or tap out.' }, 400)
      return json({ message: body.direction === 'in' ? 'You’re tapped in. Location verified.' : 'You’re tapped out. Location recorded.' })
    }
    return json({ error: 'Unknown action.' }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The request could not be completed.'
    if (/credentials|login|locked/i.test(message)) return json({ error: 'Unable to sign in. Check your credentials or try again later.' }, 400)
    return json({ error: message.length < 250 ? message : 'Unable to save. Check the fields and try again.' }, 400)
  }
}
