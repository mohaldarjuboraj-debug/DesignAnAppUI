'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { button, input, card, send } from '@/lib/workspace-client'

type Mode = 'login' | 'signup' | 'forgot' | 'reset'
export function AuthScreen({ onAuthenticated, notice, checking }: {
  onAuthenticated: () => Promise<void>
  notice: string
  checking: boolean
}) {
  const [mode, setMode] = useState<Mode>('login')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  useEffect(() => {
    const reset = new URLSearchParams(window.location.search).get('reset')
    if (reset) { setToken(reset); setMode('reset') }
  }, [])
  function changeMode(next: Mode) {
    setMode(next); setMessage(''); setError(''); setShowPassword(false)
    if (next !== 'reset' && token) {
      const url = new URL(window.location.href); url.searchParams.delete('reset')
      window.history.replaceState({}, '', url.pathname + url.search)
      setToken('')
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const f = new FormData(event.currentTarget)
    const password = String(f.get('password') || '')
    if (mode === 'reset' && password !== f.get('confirm')) { setError('Your passwords do not match.'); return }
    setBusy(true); setMessage(''); setError('')
    try {
      const result = await send({
        action: mode, token, password, email: f.get('email'), name: f.get('name'),
      })
      if (mode === 'login' || mode === 'signup') await onAuthenticated()
      else if (mode === 'reset') { changeMode('login'); setMessage(result.message) }
      else setMessage(result.message)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to continue. Please try again.') }
    finally { setBusy(false) }
  }
  const title = { login: 'Welcome back.', signup: 'Make yourself at home.', forgot: 'Forgot your password?', reset: 'A fresh start.' }[mode]
  const description = {
    login: 'Sign in to your community workspace.',
    signup: 'Join The Break with your personal email address.',
    forgot: 'Enter your personal email and we’ll help you reset it.',
    reset: 'Choose a new, secure password for your account.',
  }[mode]
  return <main className="grid min-h-screen overflow-x-hidden bg-[#f8f9f4] font-sans text-[#28372d] lg:grid-cols-[0.95fr_1.05fr]">
    <section className="relative flex flex-col overflow-hidden bg-[#294a36] p-7 text-[#f3f5e9] md:p-12 lg:min-h-screen lg:p-14">
      <div className="relative z-10 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#698064] bg-[#365940]">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5" /></svg>
        </span>
        <span className="text-[28px] font-bold tracking-[-1px]">the break<span className="text-[#c4d69b]">.</span></span>
      </div>
      <div className="relative z-10 my-10 max-w-lg lg:my-auto lg:py-16">
        <p className="text-xs font-medium uppercase tracking-[2.5px] text-[#d5e2bc]">Connected. Together.</p>
        <h1 className="mt-5 text-4xl leading-[1.15] font-medium tracking-[-1.5px] md:text-5xl xl:text-[58px]">Every person counts.<br /><span className="text-[#cedcaf]">Every moment<br className="hidden lg:block" /> matters.</span></h1>
        <p className="mt-6 max-w-sm text-base leading-7 text-[#e0e8d5]">A little check-in. A stronger community.<br />Your time makes a real difference.</p>
        <div className="mt-8 hidden items-center gap-3 lg:flex">
          <div className="flex -space-x-2">{['TB', 'TO', 'GE'].map((initials, i) => <span key={initials} className={`flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#294a36] text-xs font-semibold ${i === 0 ? 'bg-[#d7bd96] text-[#4a3d2f]' : i === 1 ? 'bg-[#ced8b6] text-[#3b5135]' : 'bg-[#e6d8c8] text-[#654d3d]'}`}>{initials}</span>)}</div>
          <p className="text-sm text-[#e0e8d5]">One team. A shared purpose.</p>
        </div>
      </div>
      <p className="relative z-10 hidden text-xs text-[#d5e2bc] lg:block">Built for people. Powered by connection.</p>
      <div aria-hidden="true" className="pointer-events-none absolute -right-36 -bottom-44 h-[460px] w-[460px] rounded-full border border-[#6b835b]" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 -bottom-28 h-[330px] w-[330px] rounded-full border border-[#6b835b]" />
    </section>
    <section className="flex min-w-0 flex-col justify-center px-6 py-10 md:px-12 lg:px-16">
      <div className="mx-auto w-full max-w-[420px]">
        <p className="text-xs font-medium uppercase tracking-[2px] text-[#647255]">The Break workspace</p>
        <h2 className="mt-3 text-[32px] font-semibold tracking-[-1px]">{title}</h2>
        <p className="mt-3 text-sm leading-6 text-[#65705e]">{description}</p>
        {notice && <p role="status" className="mt-5 rounded-lg border border-[#e5d3b4] bg-[#fff4e3] p-4 text-sm leading-6 text-[#78511c]">{notice}</p>}
        {message && <p role="status" className="mt-5 rounded-lg border border-[#cedbbf] bg-[#edf3e6] p-4 text-sm leading-6 text-[#385b30]">{message}</p>}
        {error && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">{error}</p>}
        <form key={mode} onSubmit={submit} className="mt-7 space-y-5">
          {mode === 'signup' && <label className="block text-sm font-medium">Full name<input name="name" autoComplete="name" required minLength={2} maxLength={100} className={`${input} mt-2 min-h-12`} placeholder="Your full name" /></label>}
          {mode !== 'reset' && <label className="block text-sm font-medium">Personal email<input name="email" type="email" autoComplete="email" required maxLength={254} className={`${input} mt-2 min-h-12`} placeholder="you@example.com" /></label>}
          {mode !== 'forgot' && <div><label className="block text-sm font-medium" htmlFor="account-password">{mode === 'reset' ? 'New password' : 'Password'}</label><div className="relative mt-2"><input id="account-password" name="password" type={showPassword ? 'text' : 'password'} required minLength={mode === 'login' ? 1 : 12} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className={`${input} min-h-12 pr-20`} placeholder={mode === 'login' ? 'Enter your password' : 'At least 12 characters'} /><button aria-pressed={showPassword} aria-label={showPassword ? 'Hide password' : 'Show password'} type="button" onClick={() => setShowPassword(!showPassword)} className={`${button} absolute top-0.5 right-0.5 px-3 text-[#526943]`}>{showPassword ? 'Hide' : 'Show'}</button></div></div>}
          {mode === 'reset' && <label className="block text-sm font-medium">Confirm new password<input name="confirm" type="password" required minLength={12} maxLength={128} autoComplete="new-password" className={`${input} mt-2 min-h-12`} /></label>}
          {mode === 'login' && <div className="flex justify-end"><button type="button" className={`${button} -my-2 px-0 text-[#4d6b3c] underline underline-offset-4`} onClick={() => changeMode('forgot')}>Forgot password?</button></div>}
          {mode === 'signup' && <p className="text-sm leading-6 text-[#65705e]">Accounts start as team members. An authorised administrator assigns admin access. Location access is requested when you start your shift.</p>}
          <button disabled={busy || checking} className={`${button} flex min-h-12 w-full items-center justify-center gap-3 bg-[#31543d] text-white hover:bg-[#24422e]`}>{checking ? 'Checking your session…' : busy ? 'Please wait…' : { login: 'Sign in', signup: 'Create account', forgot: 'Send reset link', reset: 'Save new password' }[mode]}<span aria-hidden="true">→</span></button>
        </form>
        <div className="mt-6 text-center text-sm text-[#65705e]">{mode === 'login' ? <>New to The Break? <button className={`${button} px-1 text-[#3f6034] underline underline-offset-4`} onClick={() => changeMode('signup')}>Create an account</button></> : <button className={`${button} text-[#3f6034] underline underline-offset-4`} onClick={() => changeMode('login')}>Back to sign in</button>}</div>
        <div className="mt-9 flex items-start gap-3 border-t border-[#dde3d4] pt-6"><span aria-hidden="true" className="mt-1 text-[#60774b]">✓</span><p className="text-sm leading-6 text-[#65705e]">Your personal email stays private. Shift records are only visible to you and authorised administrators.</p></div>
        <p className="mt-5 text-center text-xs text-[#65705e]">Workspace setup? <a href="/admin" className="inline-flex min-h-11 items-center underline underline-offset-4">CMS editor access</a></p>
      </div>
    </section>
  </main>
}

export type Profile = { name?: string; email: string; displayName?: string | null; phone?: string | null; bio?: string | null }
export function ProfileEditor({ user, onSaved }: { user: Profile; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  return <section className={`${card} max-w-3xl p-6 md:p-8`}>
    <p className="text-xs font-medium uppercase tracking-[2px] text-[#647255]">Your space</p>
    <h2 className="mt-3 text-xl font-semibold">Personal profile</h2>
    <p className="mt-3 text-sm leading-6 text-[#65705e]">Make your profile yours. Your registered identity, login email, role, and attendance permissions cannot be changed here.</p>
    <form className="mt-6 space-y-5" onSubmit={async e => {
      e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setMessage('')
      try { const result = await send({ action: 'profile', displayName: f.get('displayName'), phone: f.get('phone'), bio: f.get('bio') }); await onSaved(); setMessage(result.message) }
      catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to save your profile.') }
      finally { setBusy(false) }
    }}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm">Registered name · read-only<input readOnly value={user.name || ''} className={`${input} mt-2 bg-[#f1f3ec] text-[#65705e]`} /></label>
        <label className="text-sm">Login email · read-only<input readOnly value={user.email} className={`${input} mt-2 bg-[#f1f3ec] text-[#65705e]`} /></label>
        <label className="text-sm">Display name<input name="displayName" defaultValue={user.displayName || ''} maxLength={100} className={`${input} mt-2`} autoComplete="nickname" /></label>
        <label className="text-sm">Phone number<input name="phone" type="tel" defaultValue={user.phone || ''} maxLength={40} className={`${input} mt-2`} autoComplete="tel" /></label>
      </div>
      <label className="block text-sm">A little about you<textarea name="bio" defaultValue={user.bio || ''} maxLength={500} rows={4} className={`${input} mt-2 py-3`} placeholder="What do you enjoy contributing to the community?" /><span className="mt-2 block text-sm text-[#65705e]">Up to 500 characters. Avoid including sensitive personal information.</span></label>
      {message && <p role="status" className="text-sm leading-6 text-[#405e34]">{message}</p>}
      <button disabled={busy} className={`${button} bg-[#31543d] text-white`}>{busy ? 'Saving…' : 'Save profile'}</button>
      <p className="border-t border-[#e5e9dd] pt-5 text-sm leading-6 text-[#65705e]">Need a new password? Sign out and choose “Forgot password?” on the sign-in screen.</p>
    </form>
  </section>
}

export type TeamMember = { id: string | number; name: string; email: string; role?: string; attendanceBlocked?: boolean; blockedAt?: string | null }
export function TeamAccess({ team, onSaved }: { team: TeamMember[]; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | number | null>(null)
  const [message, setMessage] = useState('')
  const blocked = team.filter(p => p.attendanceBlocked)
  return <section className={`${card} mb-6 p-6`}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Attendance review queue</h2><span className="rounded-full bg-[#f4ead8] px-3 py-1 text-xs text-[#78511c]">{blocked.length} need review</span></div>
    <p className="mt-2 text-sm leading-6 text-[#65705e]">Review the automatic shift end, correct attendance if needed, then restore the person’s access. Clearing access does not reopen or change their previous shift.</p>
    {message && <p role="status" className="mt-4 text-sm leading-6 text-[#405e34]">{message}</p>}
    {!blocked.length && <p className="mt-5 rounded-lg bg-[#f1f4ea] p-4 text-sm text-[#526646]">All clear. No one is waiting for administrator clearance.</p>}
    <div className="mt-5 space-y-4">{blocked.map(person => <form key={person.id} className="rounded-xl border border-[#e4d6bc] bg-[#fffcf5] p-5" onSubmit={async e => {
      e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(person.id); setMessage('')
      try { const result = await send({ action: 'clear-restriction', id: person.id, reason: f.get('reason') }); await onSaved(); setMessage(result.message) }
      catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to restore access.') }
      finally { setBusy(null) }
    }}><p className="font-semibold">{person.name}</p><p className="mt-1 text-sm text-[#65705e]">{person.email}{person.blockedAt && ` · ${new Date(person.blockedAt).toLocaleString('en-AU')}`}</p><label className="mt-4 block text-sm">Clearance reason<input name="reason" required minLength={5} maxLength={1000} className={`${input} mt-2`} placeholder="Explain what was reviewed and resolved." /></label><button disabled={busy !== null} className={`${button} mt-4 bg-[#31543d] text-white`}>{busy === person.id ? 'Restoring…' : 'Restore sign-in access'}</button></form>)}</div>
  </section>
}
