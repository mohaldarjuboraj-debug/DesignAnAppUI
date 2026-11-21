import type { Access, CollectionConfig, GlobalConfig, PayloadRequest } from 'payload'
import { distanceMeters, validCoordinates } from '../lib/attendance-rules'
import { resetEmailHTML } from '../lib/email'

export const isManager = (user: PayloadRequest['user']) =>
  user?.collection === 'admins' || (user?.collection === 'users' && 'role' in user && user.role === 'admin')
const manager: Access = ({ req }) => isManager(req.user)
const ownOrManager: Access = ({ req }) => isManager(req.user) ? true :
  req.user?.collection === 'users' ? { person: { equals: req.user.id } } : false
const commandOrManager: Access = ({ req }) =>
  isManager(req.user) || (req.user?.collection === 'users' && req.context.attendanceCommand === true)

export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    forgotPassword: {
      expiration: 1800000,
      minRequestInterval: 60000,
      generateEmailSubject: () => 'Reset your The Break password',
      generateEmailHTML: args => resetEmailHTML(args?.token),
    },
  },
  admin: { useAsTitle: 'name', group: 'Attendance workspace' },
  access: {
    admin: () => false,
    create: ({ req }) => isManager(req.user) || req.context.signup === true,
    read: ({ req }) => isManager(req.user) ? true : req.user?.collection === 'users' ? { id: { equals: req.user.id } } : false,
    update: ({ req }) => isManager(req.user) ? true :
      req.user?.collection === 'users' && req.context.profile === true ? { id: { equals: req.user.id } } : false,
    delete: manager,
  },
  hooks: {
    beforeChange: [({ data, originalDoc, req }) => {
      if (originalDoc?.attendanceBlocked && data.attendanceBlocked === false) {
        if (!isManager(req.user)) throw new Error('Only an administrator can clear attendance restrictions.')
        if (typeof data.clearanceReason !== 'string' || data.clearanceReason.trim().length < 5) throw new Error('A clearance reason of at least 5 characters is required.')
        data.clearedAt = new Date().toISOString()
        data.clearedBy = req.user?.email
      }
      return data
    }],
    afterChange: [async ({ doc, previousDoc, req }) => {
      if (previousDoc?.attendanceBlocked && !doc.attendanceBlocked) {
        await req.payload.create({ collection: 'boundary-alerts', req, overrideAccess: true,
          data: { person: doc.id, message: `${doc.name}’s attendance access was restored by ${doc.clearedBy}. Reason: ${doc.clearanceReason}` } })
      }
    }],
  },
  fields: [
    { name: 'name', type: 'text', required: true, maxLength: 100, access: { update: ({ req }) => isManager(req.user) } },
    { name: 'displayName', type: 'text', maxLength: 100 },
    { name: 'phone', type: 'text', maxLength: 40 },
    { name: 'bio', type: 'textarea', maxLength: 500 },
    { name: 'attendanceBlocked', type: 'checkbox', defaultValue: false,
      access: { create: () => false, update: ({ req }) => isManager(req.user) } },
    { name: 'blockedAt', type: 'date', access: { create: () => false, update: () => false } },
    { name: 'clearanceReason', type: 'textarea', maxLength: 1000,
      access: { create: () => false, update: ({ req }) => isManager(req.user) } },
    { name: 'clearedAt', type: 'date', access: { create: () => false, update: () => false } },
    { name: 'clearedBy', type: 'text', access: { create: () => false, update: () => false } },
    { name: 'role', type: 'select', options: ['member', 'admin'], defaultValue: 'member', saveToJWT: true,
      access: { create: ({ req }) => isManager(req.user), update: ({ req }) => isManager(req.user) } },
  ],
}

export const OfficeBoundary: GlobalConfig = {
  slug: 'office-boundary', label: 'Office boundary',
  admin: { group: 'Attendance workspace' },
  access: { read: ({ req }) => Boolean(req.user), update: manager },
  fields: [
    { name: 'name', type: 'text', defaultValue: 'Caulfield office', required: true },
    { name: 'latitude', type: 'number', min: -90, max: 90 },
    { name: 'longitude', type: 'number', min: -180, max: 180 },
    { name: 'radius', type: 'number', min: 25, max: 5000, defaultValue: 100, required: true },
  ],
}

export const BoundaryAlerts: CollectionConfig = {
  slug: 'boundary-alerts',
  admin: { useAsTitle: 'message', group: 'Attendance workspace' },
  access: { read: ownOrManager, create: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'person', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'message', type: 'text', required: true },
    { name: 'distance', type: 'number' },
    { name: 'radius', type: 'number' },
  ],
}

export const AttendanceCorrections: CollectionConfig = {
  slug: 'attendance-corrections',
  admin: { useAsTitle: 'reason', group: 'Attendance workspace' },
  access: { read: ownOrManager, create: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'person', type: 'relationship', relationTo: 'users', required: true },
    { name: 'attendance', type: 'relationship', relationTo: 'attendance', required: true, index: true },
    { name: 'previousTapIn', type: 'date', required: true },
    { name: 'previousTapOut', type: 'date' },
    { name: 'newTapIn', type: 'date', required: true },
    { name: 'newTapOut', type: 'date' },
    { name: 'reason', type: 'text', required: true },
    { name: 'administrator', type: 'text', required: true },
  ],
}

export const Attendance: CollectionConfig = {
  slug: 'attendance',
  admin: { useAsTitle: 'tapIn', group: 'Attendance workspace', defaultColumns: ['person', 'tapIn', 'tapOut', 'outside', 'correctionReason'] },
  versions: { maxPerDoc: 100 },
  access: { read: ownOrManager, create: commandOrManager, update: commandOrManager, delete: () => false },
  hooks: {
    beforeChange: [async ({ data, originalDoc, req, operation }) => {
      const managing = isManager(req.user)
      if (!managing && req.user?.collection !== 'users') throw new Error('Please sign in.')
      if (!managing) {
        data.person = req.user!.id
        if (originalDoc && String(typeof originalDoc.person === 'object' ? originalDoc.person.id : originalDoc.person) !== String(req.user!.id)) throw new Error('This is not your attendance record.')
        if (req.context.attendanceCommand !== true) throw new Error('Use the location-verified tap controls.')
      }
      const tapIn = data.tapIn ?? originalDoc?.tapIn
      const tapOut = data.tapOut === undefined ? originalDoc?.tapOut : data.tapOut
      if (originalDoc?.autoEnded && !tapOut) throw new Error('An automatically ended shift must retain an end time. Restore access and start a new shift instead.')
      if (!tapIn || !Number.isFinite(Date.parse(tapIn)) || (tapOut && (!Number.isFinite(Date.parse(tapOut)) || Date.parse(tapOut) <= Date.parse(tapIn)))) throw new Error('Tap-out must be after tap-in.')
      if (Date.parse(tapIn) > Date.now() + 60000 || (tapOut && Date.parse(tapOut) > Date.now() + 60000)) throw new Error('Attendance times cannot be in the future.')
      const timesChanged = operation === 'update' &&
        ((data.tapIn !== undefined && Date.parse(data.tapIn) !== Date.parse(originalDoc.tapIn)) ||
          (data.tapOut !== undefined && (data.tapOut ? Date.parse(data.tapOut) : null) !== (originalDoc.tapOut ? Date.parse(originalDoc.tapOut) : null)))
      if (managing && timesChanged && req.context.attendanceCommand !== true) {
        if (typeof data.correctionReason !== 'string' || data.correctionReason.trim().length < 5) throw new Error('Explain the correction in at least 5 characters.')
        data.correctedBy = req.user?.email ?? 'Administrator'
        data.correctedAt = new Date().toISOString()
      }
      if (req.context.attendanceCommand === true) {
        if (req.user?.collection !== 'users') throw new Error('Sign in with an app account to record attendance.')
        const member = await req.payload.findByID({ collection: 'users', id: req.user.id, user: req.user, overrideAccess: false, req })
        if (member.attendanceBlocked) throw new Error('An administrator must clear your attendance restriction first.')
        const p = req.context.coordinates
        if (!validCoordinates(p)) throw new Error('Fresh location access is required.')
        const boundary = await req.payload.findGlobal({ slug: 'office-boundary', overrideAccess: false, user: req.user, req })
        if (boundary.latitude == null || boundary.longitude == null) throw new Error('An administrator must configure the office location first.')
        if (p.accuracy > Math.min(100, boundary.radius / 2)) throw new Error('GPS accuracy is too low. Move outdoors and try again.')
        const distance = distanceMeters(p, { latitude: boundary.latitude, longitude: boundary.longitude })
        if (operation === 'create' && distance + p.accuracy > boundary.radius) throw new Error('You must be confidently inside the office boundary to tap in.')
        if (distance - p.accuracy > boundary.radius) data.outside = true
        else if (distance + p.accuracy <= boundary.radius) data.outside = false
        data.distance = Math.round(distance)
        if (data.outside === true && operation !== 'create') {
          data.tapOut = data.tapOut || originalDoc?.tapOut || new Date().toISOString()
          data.autoEnded = true
        }
      }
      let breaks = (data.breaks ?? originalDoc?.breaks ?? []) as { start: string; end?: string | null; id?: string }[]
      if (req.context.breakAction && !data.autoEnded) {
        if (!originalDoc || originalDoc.tapOut) throw new Error('Start a shift before recording an unpaid break.')
        breaks = breaks.map(b => ({ ...b }))
        const ongoing = breaks.find(b => !b.end)
        if (req.context.breakAction === 'start') {
          if (ongoing) throw new Error('You already have an unpaid break running.')
          breaks.push({ start: new Date().toISOString() })
        } else {
          if (!ongoing) throw new Error('There is no unpaid break to finish.')
          ongoing.end = new Date().toISOString()
        }
      }
      const finalOut = data.tapOut === undefined ? tapOut : data.tapOut
      if (finalOut) breaks = breaks.map(b => b.end ? b : { ...b, end: finalOut })
      let previousEnd = Date.parse(tapIn)
      for (const b of breaks) {
        const start = Date.parse(b.start), end = b.end ? Date.parse(b.end) : Date.now()
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < previousEnd || end < start || (finalOut && end > Date.parse(finalOut))) throw new Error('Break times must be ordered and contained within the shift. Keep existing breaks within corrected shift times.')
        previousEnd = end
      }
      data.breaks = breaks
      const owner = data.person ?? originalDoc?.person
      data.openKey = finalOut ? null : String(typeof owner === 'object' ? owner.id : owner)
      return data
    }],
    afterChange: [async ({ doc, previousDoc, req }) => {
      if (previousDoc && doc.correctedAt && doc.correctedAt !== previousDoc.correctedAt) {
        // Immutable audit entries are separate from the bounded operational revision history.
        await req.payload.create({ collection: 'attendance-corrections', overrideAccess: true, req,
          data: { person: typeof doc.person === 'object' ? doc.person.id : doc.person, attendance: doc.id,
            previousTapIn: previousDoc.tapIn, previousTapOut: previousDoc.tapOut || null,
            newTapIn: doc.tapIn, newTapOut: doc.tapOut || null, reason: doc.correctionReason!,
            administrator: doc.correctedBy! } })
      }
      if (doc.outside && !previousDoc?.outside) {
        const personId = typeof doc.person === 'object' ? doc.person.id : doc.person
        const person = await req.payload.findByID({ collection: 'users', id: personId, overrideAccess: true, req })
        const boundary = await req.payload.findGlobal({ slug: 'office-boundary', overrideAccess: true, req })
        // System-generated, append-only alert; readers remain scoped to the owner or an administrator.
        await req.payload.create({ collection: 'boundary-alerts', overrideAccess: true, req,
          data: { person: personId, message: `${person.name} left ${boundary.name} (${doc.distance} m from the centre; ${boundary.radius} m boundary). Their shift ended automatically and attendance is restricted until administrator review.`, distance: doc.distance, radius: boundary.radius } })
        await req.payload.update({ collection: 'users', id: personId, overrideAccess: true, req,
          data: { attendanceBlocked: true, blockedAt: new Date().toISOString() } })
      }
    }],
  },
  fields: [
    { name: 'person', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'tapIn', type: 'date', required: true },
    { name: 'tapOut', type: 'date' },
    { name: 'breaks', type: 'array',
      access: { create: () => false, update: () => false },
      fields: [
        { name: 'start', type: 'date', required: true },
        { name: 'end', type: 'date' },
      ] },
    { name: 'autoEnded', type: 'checkbox', defaultValue: false,
      access: { create: () => false, update: () => false } },
    { name: 'openKey', type: 'text', unique: true, index: true, admin: { hidden: true },
      access: { create: () => false, update: () => false } },
    { name: 'outside', type: 'checkbox', defaultValue: false,
      access: { create: () => false, update: () => false } },
    { name: 'distance', type: 'number', access: { create: () => false, update: () => false } },
    { name: 'correctionReason', type: 'textarea', maxLength: 1000,
      access: { create: ({ req }) => isManager(req.user), update: ({ req }) => isManager(req.user) } },
    { name: 'correctedBy', type: 'text', access: { create: () => false, update: () => false } },
    { name: 'correctedAt', type: 'date', access: { create: () => false, update: () => false } },
  ],
}
