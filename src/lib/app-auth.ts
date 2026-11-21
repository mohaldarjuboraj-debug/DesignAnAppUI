import 'server-only'
import { cookies } from 'next/headers'
import { getPayload } from 'payload'
import config from '@payload-config'

export function createAppAuth(collection: 'users') {
  return {
    async currentUser() {
      const token = (await cookies()).get('app-session')?.value
      if (!token) return null
      const payload = await getPayload({ config })
      const { user } = await payload.auth({ headers: new Headers({ Authorization: `JWT ${token}` }) })
      if (user?.collection !== collection) return null
      const current = await payload.findByID({ collection, id: user.id, user, overrideAccess: false })
      return { ...current, collection }
    },
    async login(email: string, password: string) {
      const payload = await getPayload({ config })
      const result = await payload.login({ collection, data: { email, password } })
      if (!result.token || !result.user) throw new Error('Unable to sign in.')
      if (result.user.attendanceBlocked) throw new Error('Your shift was ended after a boundary exit. Ask an administrator to review and restore your access.')
      ;(await cookies()).set('app-session', result.token, { httpOnly: true, secure: true, sameSite: 'none', path: '/', maxAge: 7200 })
    },
    async logout() { (await cookies()).delete('app-session') },
  }
}
export const appAuth = createAppAuth('users')
export async function workspaceUser() {
  return appAuth.currentUser()
}
