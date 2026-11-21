import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { runInThisContext } from 'node:vm'
import ts from 'typescript'

// Load the real TypeScript domain hooks without starting Payload or touching its database.
const require = createRequire(import.meta.url)
const modules = new Map()
function loadTypeScript(filename) {
  if (modules.has(filename)) return modules.get(filename)
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  })
  const module = { exports: {} }
  const localRequire = name => name.startsWith('.')
    ? loadTypeScript(resolve(dirname(filename), `${name}.ts`)) : require(name)
  runInThisContext(`(function(require, module, exports) { ${outputText}\n})`, { filename })(localRequire, module, module.exports)
  modules.set(filename, module.exports)
  return module.exports
}
const { Attendance, Users } = loadTypeScript(resolve('src/collections/Attendance.ts'))
const before = Attendance.hooks.beforeChange[0]
const after = Attendance.hooks.afterChange[0]
const office = { name: 'Test office', latitude: -37.88, longitude: 145.02, radius: 100 }
const coordinates = { latitude: office.latitude, longitude: office.longitude, accuracy: 5 }
const started = new Date(Date.now() - 7200000).toISOString()
const breakStarted = new Date(Date.now() - 600000).toISOString()
function fixture({ role = 'member', outside = false, blocked = false, breakAction } = {}) {
  const writes = []
  const req = {
    user: { id: 'member-1', collection: 'users', role, email: 'member@example.test' },
    context: {
      attendanceCommand: true,
      coordinates: outside ? { ...coordinates, latitude: -37.878 } : { ...coordinates },
      ...(breakAction ? { breakAction } : {}),
    },
    payload: {
      findByID: async () => ({ id: 'member-1', name: 'Test member', attendanceBlocked: blocked }),
      findGlobal: async () => office,
      create: async options => { writes.push(options); return { id: 'new-record' } },
      update: async options => { writes.push(options); return { id: 'member-1' } },
    },
  }
  const originalDoc = { id: 'shift-1', person: 'member-1', tapIn: started, tapOut: null, breaks: [], outside: false }
  return { req, originalDoc, writes }
}
test('starting and finishing an unpaid break uses server timestamps', async () => {
  const f = fixture({ breakAction: 'start' })
  const startedBreak = await before({ data: {}, ...f, operation: 'update' })
  assert.equal(startedBreak.breaks.length, 1)
  assert.ok(startedBreak.breaks[0].start)
  assert.equal(startedBreak.breaks[0].end, undefined)
  f.req.context.breakAction = 'finish'
  f.originalDoc.breaks = startedBreak.breaks
  const finishedBreak = await before({ data: {}, ...f, operation: 'update' })
  assert.ok(finishedBreak.breaks[0].end)
})
test('duplicate unpaid-break starts are rejected', async () => {
  const f = fixture({ breakAction: 'start' })
  f.originalDoc.breaks = [{ start: breakStarted }]
  await assert.rejects(before({ data: {}, ...f, operation: 'update' }), /already have an unpaid break/)
})
test('a confirmed exit closes the shift and break and restricts the member', async () => {
  const f = fixture({ outside: true })
  f.originalDoc.breaks = [{ start: breakStarted }]
  const next = await before({ data: {}, ...f, operation: 'update' })
  assert.equal(next.outside, true)
  assert.equal(next.autoEnded, true)
  assert.ok(next.tapOut)
  assert.equal(next.breaks[0].end, next.tapOut)
  assert.equal(next.openKey, null)
  await after({ doc: { ...f.originalDoc, ...next }, previousDoc: f.originalDoc, req: f.req })
  assert.ok(f.writes.some(w => w.collection === 'boundary-alerts' && w.overrideAccess === true))
  assert.ok(f.writes.some(w => w.collection === 'users' && w.data.attendanceBlocked === true && w.req === f.req))
})
test('app administrators have the same boundary rules for their own shifts', async () => {
  const f = fixture({ role: 'admin', outside: true })
  const next = await before({ data: {}, ...f, operation: 'update' })
  assert.equal(next.autoEnded, true)
  assert.ok(next.tapOut)
})
test('restricted members and out-of-area tap-ins are rejected', async () => {
  const restricted = fixture({ blocked: true })
  await assert.rejects(before({ data: { person: 'member-1', tapIn: started }, req: restricted.req, operation: 'create' }), /clear your attendance restriction/)
  const outside = fixture({ outside: true })
  await assert.rejects(before({ data: { person: 'member-1', tapIn: started }, req: outside.req, operation: 'create' }), /inside the office boundary/)
})
test('weak GPS never automatically closes a shift', async () => {
  const f = fixture({ outside: true })
  f.req.context.coordinates.accuracy = 200
  await assert.rejects(before({ data: {}, ...f, operation: 'update' }), /accuracy is too low/)
})
test('members cannot mutate another person’s attendance', async () => {
  const f = fixture()
  f.originalDoc.person = 'someone-else'
  await assert.rejects(before({ data: {}, ...f, operation: 'update' }), /not your attendance record/)
})
test('administrator time corrections require an audit reason', async () => {
  const f = fixture({ role: 'admin' })
  f.req.context = {}
  const tapOut = new Date(Date.now() - 60000).toISOString()
  await assert.rejects(before({ data: { tapOut }, ...f, operation: 'update' }), /Explain the correction/)
  const next = await before({ data: { tapOut, correctionReason: 'Verified the departure with the team.' }, ...f, operation: 'update' })
  assert.equal(next.correctedBy, f.req.user.email)
  assert.ok(next.correctedAt)
})
test('clearance requires an administrator and a meaningful reason', () => {
  const f = fixture()
  const hook = Users.hooks.beforeChange[0]
  assert.throws(() => hook({ data: { attendanceBlocked: false }, originalDoc: { attendanceBlocked: true }, req: f.req }), /Only an administrator/)
  f.req.user.role = 'admin'
  assert.throws(() => hook({ data: { attendanceBlocked: false }, originalDoc: { attendanceBlocked: true }, req: f.req }), /clearance reason/)
  const next = hook({ data: { attendanceBlocked: false, clearanceReason: 'Departure reviewed and corrected.' }, originalDoc: { attendanceBlocked: true }, req: f.req })
  assert.equal(next.clearedBy, f.req.user.email)
  assert.ok(next.clearedAt)
})
test('signup and profile permissions cannot grant an administrator role', () => {
  const f = fixture()
  assert.equal(Users.fields.find(field => field.name === 'role').access.create({ req: f.req }), false)
  assert.equal(Users.access.update({ req: f.req }), false)
  f.req.context.profile = true
  assert.deepEqual(Users.access.update({ req: f.req }), { id: { equals: 'member-1' } })
  assert.equal(Users.fields.find(field => field.name === 'name').access.update({ req: f.req }), false)
})
