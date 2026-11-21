'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { distanceMeters, type Coordinates } from '@/lib/attendance-rules'
import { workingMilliseconds, unpaidMilliseconds } from '@/lib/shift-time'
import { button, input, card, send } from '@/lib/workspace-client'
import { AuthScreen, ProfileEditor, TeamAccess, type TeamMember, type Profile } from './AccountScreens'

type ID = string | number
type Person = { id: ID; name: string; email: string }
type Entry = { id: ID; person: Person | ID; tapIn: string; tapOut?: string | null; outside?: boolean; autoEnded?: boolean; breaks?: { start: string; end?: string | null }[] | null; distance?: number; correctionReason?: string; correctedBy?: string; correctedAt?: string }
type Alert = { id: ID; message: string; createdAt: string }
type Boundary = { name: string; latitude?: number | null; longitude?: number | null; radius: number }
type Workspace = { user: (Profile & { id: ID; manager: boolean; member: boolean }) | null; records: Entry[]; alerts: Alert[]; boundary: Boundary | null; team: TeamMember[]; notice?: string }
type IconName = 'overview' | 'attendance' | 'people' | 'reports' | 'settings' | 'pin' | 'bell' | 'arrow' | 'shield' | 'download' | 'search' | 'check' | 'edit'
const empty: Workspace = { user: null, records: [], alerts: [], boundary: null, team: [] }
const tabs: { name: string; icon: IconName }[] = [{ name: 'Overview', icon: 'overview' }, { name: 'Attendance', icon: 'attendance' }, { name: 'People', icon: 'people' }, { name: 'Reports', icon: 'reports' }, { name: 'Office boundary', icon: 'settings' }, { name: 'My profile', icon: 'people' }]
function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    attendance: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5" /></>,
    reports: <path d="M4 3v18h17M9 16v-5m5 5V6m5 10v-7" />,
    settings: <><path d="M4 7h16M4 17h16M8 4v6m8 4v6" /><circle cx="8" cy="7" r="2" /><circle cx="16" cy="17" r="2" /></>,
    pin: <><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-9 12h6" /></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" /><path d="m8 12 3 3 5-6" /></>,
    download: <path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    edit: <><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z" /></>,
  }
  return <svg aria-hidden="true" className={`h-5 w-5 shrink-0 ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}
const time = (date?: string | null) => date ? new Date(date).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : '—'
const personName = (entry: Entry) => typeof entry.person === 'object' ? entry.person.name : 'Member'
const state = (entry: Entry) => entry.autoEnded ? 'Auto-ended' : entry.tapOut ? 'Tapped out' : entry.outside ? 'Out of area' : entry.breaks?.some(b => !b.end) ? 'Unpaid break' : 'On site'
function Badge({ value }: { value: string }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${value === 'On site' ? 'bg-[#eaf3e9] text-[#356246]' : value === 'Out of area' ? 'bg-[#fff0dc] text-[#8b5419]' : 'bg-[#f0f1ef] text-[#62665f]'}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{value}</span>
}
function getLocation() {
  return new Promise<Coordinates>((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser does not support location access.'))
    navigator.geolocation.getCurrentPosition(p => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }), e => reject(new Error(e.code === 1 ? 'Location access was denied. Allow location in your browser’s site settings, then try again.' : e.code === 3 ? 'Location timed out. Move near a window or outdoors and try again.' : 'Location is unavailable. Check your device’s GPS and connection.')), { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 })
  })
}

export default function AttendanceWorkspace() {
  const [data, setData] = useState<Workspace>(empty)
  const [page, setPage] = useState('Overview')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All statuses')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [location, setLocation] = useState<Coordinates | null>(null)
  const [monitoring, setMonitoring] = useState(false)
  const [gpsError, setGpsError] = useState('')
  const [editing, setEditing] = useState<Entry | null>(null)
  const [resetRequested, setResetRequested] = useState(false)
  const [now, setNow] = useState(Date.now())
  const seen = useRef<Set<ID> | null>(null)
  const checking = useRef(false)
  const refresh = useCallback(async () => {
    const response = await fetch('/api/workspace', { cache: 'no-store' })
    if (!response.ok) throw new Error('Unable to load attendance. Please try again.')
    const next: Workspace = await response.json()
    if (next.notice) setNotice(next.notice)
    if (seen.current) {
      const incoming = next.alerts.filter(a => !seen.current!.has(a.id))
      if (incoming.length) {
        setNotice(incoming[0].message)
        if ('Notification' in window && Notification.permission === 'granted') new Notification('The Break · Out of area', { body: incoming[0].message })
      }
    }
    seen.current = new Set(next.alerts.map(a => a.id))
    setData(next); setLoaded(true)
  }, [])
  useEffect(() => {
    setResetRequested(new URLSearchParams(window.location.search).has('reset'))
    const load = () => { refresh().catch(e => { setNotice(e.message); setLoaded(true) }) }
    load()
    const interval = setInterval(load, 10000)
    return () => clearInterval(interval)
  }, [refresh])
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const active = data.records.find(r => !r.tapOut && (typeof r.person === 'object' ? r.person.id : r.person) === data.user?.id)
  useEffect(() => { setMonitoring(Boolean(active) && !resetRequested) }, [active?.id, resetRequested])
  useEffect(() => {
    if (!monitoring || !active || !navigator.geolocation) return
    const watcher = navigator.geolocation.watchPosition(async position => {
      const coordinates = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }
      setLocation(coordinates); setGpsError('')
      if (checking.current) return
      checking.current = true
      try {
        const result = await send({ action: 'position', coordinates })
        if (result.signedOut) { setNotice(result.message); setMonitoring(false) }
        await refresh()
      }
      catch (e) { setGpsError(e instanceof Error ? e.message : 'Location check failed. Check your connection.') }
      finally { checking.current = false }
    }, e => setGpsError(e.code === 1 ? 'Location permission was revoked. Monitoring is paused; enable it in site settings.' : 'GPS signal unavailable. Your boundary status cannot be updated.'), { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 })
    return () => navigator.geolocation.clearWatch(watcher)
  }, [monitoring, active?.id, refresh])
  async function run(action: () => Promise<string>) {
    setBusy(true); setNotice('')
    try { setNotice(await action()); await refresh() }
    catch (e) { setNotice(e instanceof Error ? e.message : 'Something went wrong. Please try again.') }
    finally { setBusy(false) }
  }
  function signOut() {
    return run(async () => {
      const result = await send({ action: 'logout' })
      setMonitoring(false)
      return result.message
    })
  }
  const records = data.records.filter(r => `${personName(r)} ${typeof r.person === 'object' ? r.person.email : ''}`.toLowerCase().includes(search.toLowerCase()) && (filter === 'All statuses' || state(r) === filter))
  const todayRecords = data.records.filter(r => new Date(r.tapIn).toDateString() === new Date().toDateString())
  const openRecords = data.records.filter(r => !r.tapOut)
  const members = new Set(todayRecords.map(r => typeof r.person === 'object' ? r.person.id : r.person)).size
  const hours = todayRecords.reduce((sum, r) => sum + workingMilliseconds(r, now) / 3600000, 0)
  function exportCsv() {
    const quote = (v: string) => `"${(/^[=+@\-\t\r]/.test(v) ? "'" + v : v).replace(/"/g, '""')}"`
    const csv = [['Name', 'Tap in (ISO)', 'Tap out (ISO)', 'Unpaid break minutes', 'Working hours', 'Status', 'Correction reason'], ...records.map(r => [personName(r), r.tapIn, r.tapOut || '', (unpaidMilliseconds(r, now) / 60000).toFixed(1), (workingMilliseconds(r, now) / 3600000).toFixed(2), state(r), r.correctionReason || ''])].map(row => row.map(quote).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = 'the-break-attendance.csv'; a.click(); URL.revokeObjectURL(url)
    setNotice('Attendance report exported.')
  }
  const navigation = (mobile = false) => <nav aria-label={mobile ? 'Mobile navigation' : 'Main navigation'} className={mobile ? 'flex gap-1 overflow-x-auto p-3 lg:hidden' : 'space-y-2 px-4'}>{tabs.filter(tab => data.user?.manager || !['People', 'Office boundary'].includes(tab.name)).map(tab => <button key={tab.name} onClick={() => setPage(tab.name)} className={`${button} flex items-center gap-3 whitespace-nowrap ${mobile ? '' : 'w-full'} ${page === tab.name ? 'bg-[#eaf0df] font-semibold text-[#35513a]' : 'text-[#65705e] hover:bg-[#f0f2ea]'}`}><Icon name={tab.icon} />{tab.name}</button>)}</nav>
  if (!data.user || resetRequested) return <AuthScreen checking={!loaded} notice={notice} onAuthenticated={async () => {
    setResetRequested(false); setPage('Overview'); setNotice(''); await refresh()
  }} />
  return <div className="min-h-screen overflow-x-hidden bg-[#f7f8f4] font-sans text-[#28372d]">
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-[232px] flex-col border-r border-[#e5e8df] bg-[#fcfcf9] lg:flex">
      <button onClick={() => setPage('Overview')} className={`${button} flex h-[105px] items-center gap-3 px-7 text-left`}><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2c5039] text-[#e7efc5]"><Icon name="people" /></span><span className="text-[23px] font-bold tracking-[-1px]">the break<span className="text-[#6c8654]">.</span><span className="mt-0.5 block text-xs font-medium tracking-normal text-[#63705f]">Connected. Together.</span></span></button>
      <p className="px-7 pt-6 pb-4 text-xs font-medium tracking-[1.5px] text-[#6b7561]">WORKSPACE</p>{navigation()}
      <div className="mx-5 mt-auto mb-7 rounded-xl border border-[#e0e6d6] bg-[#f1f4e9] p-4"><Icon name="shield" /><h3 className="mt-4 text-sm font-semibold">A little check-in.<br />A big impact.</h3><p className="mt-2 text-sm leading-6 text-[#65705e]">Every hour helps build a stronger community.</p><button onClick={() => setPage('Help & support')} className={`${button} mt-2 flex items-center gap-2 px-0`}>Our purpose <Icon name="arrow" /></button></div>
      <div className="border-t border-[#e5e8df] p-5"><p className="truncate text-sm font-semibold">{data.user.displayName || data.user.name}</p><p className="mt-1 text-xs text-[#697163]">{data.user.manager ? 'Administrator' : 'Team member'}</p><button className={`${button} mt-2 px-0`} disabled={busy} onClick={signOut}>Sign out of app</button></div>
    </aside>
    <div className="lg:ml-[232px]">
      <header className="flex min-h-[78px] flex-wrap items-center justify-between gap-3 border-b border-[#e5e8df] bg-[#fcfcf9] px-5 py-3 md:px-9">
        <div className="flex gap-2 text-sm"><span className="text-[#65705e]">Workspace</span><span className="text-[#65705e]">/</span><span>{page}</span></div>
        <div className="flex items-center gap-2 md:gap-4">
          <span className="hidden items-center gap-2 text-sm text-[#626e5e] md:flex"><span className="h-2 w-2 rounded-full bg-[#668f4f]" />{data.boundary?.name || 'Caulfield office'}</span>
          <button aria-label={`Notifications, ${data.alerts.length} alerts`} onClick={() => setPage('Notifications')} className={`${button} flex items-center gap-2 px-3`}><Icon name="bell" />{data.alerts.length > 0 && <span className="rounded-full bg-[#e7edda] px-2 py-1 text-xs">{data.alerts.length}</span>}</button>
          <button onClick={() => setPage('My profile')} className={`${button} border border-[#dfe4d6]`}>My profile</button>
          <button disabled={busy} onClick={signOut} className={`${button} px-2 lg:hidden`}>Sign out</button>
        </div>
      </header>
      {navigation(true)}
      <main className="mx-auto max-w-[1510px] px-5 py-8 md:px-9 md:py-9">
        <div className="mb-7 flex flex-wrap items-center justify-between gap-4"><div><p className="mb-2 text-xs font-medium uppercase tracking-[1.5px] text-[#647255]">Let’s make today count</p><h1 className="text-[28px] font-semibold tracking-[-1px] md:text-[32px]">{page === 'Overview' ? `Welcome${data.user?.name ? `, ${data.user.name.split(' ')[0]}` : ' to The Break'}.` : page}</h1><p className="mt-2 text-sm text-[#65705e]">A little clarity on your people, their time, and the impact you’re making.</p></div><span className="flex min-h-11 items-center gap-2 rounded-lg border border-[#dfe4d7] bg-[#fcfcf9] px-3 text-sm text-[#5e6958]"><Icon name="attendance" />{loaded ? new Date().toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) : 'Loading workspace…'}</span></div>
        {notice && <div role="status" className="mb-5 flex items-center justify-between gap-4 rounded-lg border border-[#ccdabc] bg-[#edf3e5] px-4 py-2 text-sm leading-6">{notice}<button aria-label="Dismiss message" className={`${button} text-xl`} onClick={() => setNotice('')}>×</button></div>}
        {page === 'My profile' && <ProfileEditor user={data.user} onSaved={refresh} />}
        {data.user.manager && ['Overview', 'People'].includes(page) && <TeamAccess team={data.team} onSaved={refresh} />}
        {page === 'Overview' && <>
          <section className="relative mb-6 flex min-h-[185px] overflow-hidden rounded-xl bg-[#edf0df] p-6 md:px-8"><div className="relative z-10 max-w-[75%]"><span className="inline-flex rounded-full bg-[#dfe7cb] px-3 py-1 text-xs font-medium text-[#4c6240]">Your community, connected</span><h2 className="mt-3 text-2xl font-semibold tracking-[-0.5px]">Every person counts.<br />Every moment matters.</h2><p className="mt-3 text-sm leading-6 text-[#627052]">Keep your team connected and your day running smoothly.</p></div><svg aria-hidden="true" viewBox="0 0 280 180" className="absolute right-0 bottom-0 h-full w-[35%]"><circle cx="195" cy="90" r="95" fill="#e2e8d1" /><circle cx="195" cy="90" r="68" fill="none" stroke="#c4d1ac" strokeDasharray="4 5" /><path d="M123 170v-45a35 35 0 0 1 70 0v45" fill="#758d5e" /><circle cx="158" cy="65" r="22" fill="#dab89b" /><path d="M135 60c0-32 46-32 46 0l-23-12Z" fill="#3b5135" /><path d="M183 170v-34a28 28 0 0 1 56 0v34" fill="#d1b579" /><circle cx="210" cy="89" r="18" fill="#af8162" /><path d="M192 86c-2-26 37-28 37 3l-15-15Z" fill="#3b5135" /><path d="M107 163h147v10H107Z" fill="#45613b" /><path d="M68 180c-23-44-8-77 9-93 14 34 17 62 6 93" fill="#b8c89b" /></svg></section>
          <section aria-label="Attendance summary" className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">{[
            { title: 'On site now', value: openRecords.filter(r => !r.outside).length, note: 'Location-verified active sessions', icon: 'people' as IconName },
            { title: 'Checked in today', value: members, note: `${todayRecords.length} attendance sessions today`, icon: 'check' as IconName },
            { title: 'Working hours', value: hours.toFixed(1), note: 'Shifts started today · unpaid breaks excluded', icon: 'attendance' as IconName },
            { title: 'Auto-ended shifts', value: todayRecords.filter(r => r.autoEnded).length, note: 'Confirmed boundary exits recorded today', icon: 'pin' as IconName },
          ].map(k => <div key={k.title} className={`${card} p-5`}><div className="flex items-center justify-between gap-2 text-sm text-[#66705e]">{k.title}<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#eef2e5] text-[#60774d]"><Icon name={k.icon} className="h-4 w-4" /></span></div><p className="mt-3 text-[32px] font-semibold leading-none tracking-[-1px]">{k.value}</p><p className="mt-3 text-xs leading-5 text-[#65705e]">{k.note}</p></div>)}</section>
        </>}
        {data.user.member && (page === 'Overview' || page === 'Attendance') && <section className={`${card} mb-6 p-6`}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div><p className="mb-2 text-xs font-medium uppercase tracking-[1.5px] text-[#647255]">Your working day</p><h2 className="text-lg font-semibold">Shift & unpaid breaks <span className="ml-2 inline-block"><Badge value={active ? state(active) : 'Tapped out'} /></span></h2><p className="mt-2 text-sm text-[#65705e]">{active ? `Shift started at ${time(active.tapIn)}. Break time is excluded from working hours.` : 'Ready to make a difference? Tap in when you arrive at the office.'}</p></div>
            <button disabled={busy} onClick={() => run(async () => {
              const coordinates = await getLocation(); setLocation(coordinates)
              const result = await send({ action: 'tap', direction: active ? 'out' : 'in', coordinates })
              setMonitoring(!active && !result.signedOut)
              return result.message
            })} className={`${button} min-h-12 min-w-36 bg-[#31543d] text-white hover:bg-[#24422e]`}>{busy ? 'Please wait…' : active ? 'Tap out · end shift' : 'Tap in · start shift'}</button>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-[1fr_1fr_1.3fr]">
            <div className="rounded-lg bg-[#f1f4ea] p-4"><p className="text-sm text-[#65705e]">Working time this shift</p><p className="mt-2 text-2xl font-semibold tabular-nums">{active ? (workingMilliseconds(active, now) / 3600000).toFixed(2) : '0.00'} <span className="text-sm font-normal text-[#65705e]">hours</span></p></div>
            <div className="rounded-lg bg-[#f6f2e8] p-4"><p className="text-sm text-[#65705e]">Unpaid break time</p><p className="mt-2 text-2xl font-semibold tabular-nums">{active ? Math.floor(unpaidMilliseconds(active, now) / 60000) : 0} <span className="text-sm font-normal text-[#65705e]">minutes</span></p></div>
            <div className="flex flex-col justify-center gap-2">
              {(['start', 'finish'] as const).map(direction => <button key={direction} disabled={busy || !active || (direction === 'start' ? Boolean(active.breaks?.some(b => !b.end)) : !active.breaks?.some(b => !b.end))} className={`${button} border border-[#d7dfcc] bg-white text-[#34523b]`} onClick={() => run(async () => {
                const coordinates = await getLocation(); setLocation(coordinates)
                return (await send({ action: 'break', direction, coordinates })).message
              })}>{direction === 'start' ? 'Start unpaid break' : 'Finish unpaid break'}</button>)}
            </div>
          </div>
          <div className="mt-5 border-t border-[#e8ecdf] pt-4">
            <p className="text-sm leading-6 text-[#65705e]">{location && data.boundary?.latitude != null && data.boundary.longitude != null ? `${Math.round(distanceMeters(location, { latitude: data.boundary.latitude, longitude: data.boundary.longitude }))} m from the office · GPS accuracy ±${Math.round(location.accuracy)} m` : 'Location access is required for every shift and break action.'}</p>
            {active && <p className="mt-2 text-sm font-medium text-[#466338]">{monitoring && !gpsError ? 'Location monitoring active while this page is open.' : 'Location monitoring needs attention.'}</p>}
            <p className="mt-3 text-sm leading-6 text-[#65705e]">A confirmed boundary exit ends your shift and any unpaid break, signs you out, and requires admin clearance. This also applies during unpaid breaks. Keep this page open: locked screens, closed pages, revoked GPS permissions, and lost connections can prevent detection.</p>
            {gpsError && <p role="alert" className="mt-3 text-sm text-[#96521c]">{gpsError}</p>}
          </div>
        </section>}
        {['Overview', 'Reports'].includes(page) && <section className="mb-6 grid gap-6 xl:grid-cols-[1.65fr_1fr]"><div className={`${card} min-w-0 p-6`}><h2 className="font-semibold">Attendance at a glance</h2><p className="mt-1 text-sm text-[#65705e]">Daily check-ins · last 7 days</p><WeeklyChart records={data.records} /></div><section className={`${card} p-6`}><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Boundary activity</h2><span className="text-xs text-[#547345]">Updates every 10s</span></div><AlertList alerts={data.alerts.slice(0, 2)} /><button onClick={() => setPage('Notifications')} className={`${button} mt-3 flex w-full items-center justify-center gap-2 border-t border-[#e8ecdf] pt-3 text-[#526e40]`}>View all notifications <Icon name="arrow" /></button></section></section>}
        {['Overview', 'Attendance', 'People', 'Reports'].includes(page) && <section className={`${card} overflow-hidden`}>
          <div className="flex flex-wrap items-center justify-between gap-4 p-6">
            <div className="flex items-center gap-2"><h2 className="font-semibold">{page === 'People' ? 'People & attendance' : 'Attendance records'}</h2><span className="rounded-full bg-[#eef1e5] px-2 py-1 text-xs text-[#58674a]">{data.records.length}</span></div>
            <button disabled={!records.length} onClick={exportCsv} className={`${button} flex items-center gap-2 border border-[#dfe4d6]`}><Icon name="download" className="h-4 w-4" />Export report</button>
          </div>
          <div className="flex flex-wrap gap-3 border-t border-[#e9ede2] px-6 py-4">
            <div className="relative min-w-0 flex-1 sm:max-w-xs"><Icon name="search" className="absolute top-3 left-3 h-4 w-4 text-[#66745a]" /><input aria-label="Search people" placeholder="Search by name or email…" className={`${input} pl-9`} value={search} onChange={e => setSearch(e.target.value)} /></div>
            <select aria-label="Filter attendance status" className={`${input} w-auto`} value={filter} onChange={e => setFilter(e.target.value)}>{['All statuses', 'On site', 'Unpaid break', 'Auto-ended', 'Out of area', 'Tapped out'].map(s => <option key={s}>{s}</option>)}</select>
            <span className="ml-auto flex items-center text-xs text-[#647255]">{data.user.manager ? 'Admin corrections are audited' : 'Only your records are visible'}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-left text-sm">
              <thead className="border-y border-[#e9ece2] bg-[#f8f9f4] text-xs text-[#64705a]"><tr>{['Name', 'Date', 'Tap in', 'Tap out', 'Unpaid breaks', 'Working hours', 'Status', 'Actions'].map(h => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr></thead>
              <tbody>{records.map(r => <tr key={r.id} className="border-b border-[#edf0e7] last:border-0 hover:bg-[#f7f9f2]">
                <td className="px-5 py-4"><p className="font-medium">{personName(r)}</p><p className="mt-1 text-xs text-[#65705e]">{typeof r.person === 'object' ? r.person.email : ''}</p></td>
                <td className="px-5 py-4 text-[#65705e]">{new Date(r.tapIn).toLocaleDateString('en-AU')}</td>
                <td className="px-5 py-4">{time(r.tapIn)}</td><td className="px-5 py-4">{time(r.tapOut)}</td>
                <td className="px-5 py-4"><p>{(unpaidMilliseconds(r, now) / 60000).toFixed(1)} min</p>{(r.breaks ?? []).map((b, i) => <p key={i} className="mt-1 text-xs text-[#65705e]">{time(b.start)} – {b.end ? time(b.end) : 'Ongoing'}</p>)}</td>
                <td className="px-5 py-4">{(workingMilliseconds(r, now) / 3600000).toFixed(2)} h</td>
                <td className="px-5 py-4"><Badge value={state(r)} /></td>
                <td className="px-5 py-4">{data.user?.manager ? <button onClick={() => setEditing(r)} className={`${button} flex items-center gap-2 border border-[#dfe4d6]`} aria-label={`Edit attendance for ${personName(r)}`}><Icon name="edit" className="h-4 w-4" />Edit times</button> : <span className="text-xs text-[#65705e]">{r.correctedAt ? 'Corrected by admin' : r.autoEnded ? 'Automatically closed' : 'Location verified'}</span>}</td>
              </tr>)}</tbody>
            </table>
            {!records.length && <div className="px-6 py-10 text-center"><h3 className="text-sm font-medium">{search || filter !== 'All statuses' ? 'No matching records' : 'A fresh start for your community'}</h3><p className="mt-2 text-sm text-[#65705e]">Your shift and unpaid break records appear here after you tap in. Try adjusting your search or status.</p></div>}
          </div>
          <p className="border-t border-[#edf0e7] px-6 py-4 text-xs text-[#65705e]">Showing {records.length} of {data.records.length} recent records · Times shown in your device’s timezone</p>
        </section>}
        {page === 'Office boundary' && <BoundaryForm boundary={data.boundary} manager={Boolean(data.user?.manager)} busy={busy} run={run} />}
        {page === 'Notifications' && <section className={`${card} max-w-3xl p-6`}><div className="flex flex-wrap items-center justify-between gap-4"><h2 className="text-lg font-semibold">Out-of-area notifications</h2><button className={`${button} border border-[#dfe4d6]`} onClick={async () => { try { if (!('Notification' in window)) { setNotice('Browser notifications are not supported here. In-app alerts remain available.'); return } const permission = await Notification.requestPermission(); setNotice(permission === 'granted' ? 'Browser notifications enabled while this page is running.' : 'Browser notifications are blocked. Alerts still appear in this inbox.') } catch { setNotice('Use the full browser window to enable notifications. In-app alerts remain available.') } }}>Enable browser notifications</button></div><p className="mt-3 text-sm leading-6 text-[#65705e]">Members see their own alerts. Administrators see all boundary alerts. This inbox refreshes every 10 seconds while open; email, SMS and closed-browser push delivery are not configured.</p><AlertList alerts={data.alerts} /></section>}
        {page === 'Help & support' && <section className={`${card} max-w-2xl p-7`}><h2 className="text-xl font-semibold">Together, no one falls through the gaps.</h2><p className="mt-4 text-sm leading-7 text-[#65705e]">The Break supports resilience and connection. Administrators set the office boundary and can correct attendance with a reason. Members sign in, allow location access, and tap in or out. Only location distance and boundary status are stored, not a continuous trail of coordinates.</p><p className="mt-4 text-sm leading-7 text-[#65705e]">Administrators can manage member accounts and grant the app administrator role through the existing Admin panel. App accounts remain separate from CMS editor accounts.</p></section>}
        <footer className="mt-7 flex flex-wrap items-center justify-between gap-3 text-xs text-[#65705e]"><span>Built for people. Powered by connection.</span><span className="flex items-center gap-2"><Icon name="shield" className="h-4 w-4" />The Break · Attendance workspace</span></footer>
      </main>
    </div>
    {editing && <CorrectionDialog entry={editing} close={() => setEditing(null)} busy={busy} save={async values => {
      setBusy(true)
      try {
        const result = await send({ action: 'correct', id: editing.id, ...values })
        await refresh()
        setEditing(null); setNotice(result.message)
      } finally { setBusy(false) }
    }} />}
  </div>
}

type Run = (action: () => Promise<string>) => Promise<void>
function BoundaryForm({ boundary, manager, busy, run }: { boundary: Boundary | null; manager: boolean; busy: boolean; run: Run }) {
  const [draft, setDraft] = useState({ name: boundary?.name || 'Caulfield office', latitude: boundary?.latitude?.toString() || '', longitude: boundary?.longitude?.toString() || '', radius: boundary?.radius?.toString() || '100' })
  useEffect(() => { if (boundary) setDraft({ name: boundary.name, latitude: boundary.latitude?.toString() || '', longitude: boundary.longitude?.toString() || '', radius: String(boundary.radius) }) }, [boundary?.name, boundary?.latitude, boundary?.longitude, boundary?.radius])
  return <section className={`${card} max-w-3xl p-6 md:p-8`}>
    <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#eaf0df]"><Icon name="pin" /></span>
    <h2 className="text-xl font-semibold">Set your office area</h2>
    <p className="mt-3 text-sm leading-6 text-[#65705e]">Choose the office centre and permitted radius. Everyone, including app admins, needs an accurate GPS fix inside this area to tap in. A confirmed exit ends the shift and any break, signs the person out, and requires admin clearance.</p>
    {!manager && <p role="status" className="mt-5 rounded-lg bg-[#f0f3e9] p-4 text-sm">Only a signed-in administrator can change the boundary.</p>}
    <form className="mt-6 space-y-5" onSubmit={e => {
      e.preventDefault()
      run(async () => (await send({ action: 'boundary', name: draft.name, latitude: Number(draft.latitude), longitude: Number(draft.longitude), radius: Number(draft.radius) })).message)
    }}>
      <fieldset disabled={!manager || busy} className="space-y-5">
        <label className="block text-sm">Office name<input className={`${input} mt-2`} required maxLength={100} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        <div className="grid gap-4 md:grid-cols-2">{(['latitude', 'longitude'] as const).map(key => <label key={key} className="block text-sm capitalize">{key}<input className={`${input} mt-2`} type="number" step="any" required min={key === 'latitude' ? -90 : -180} max={key === 'latitude' ? 90 : 180} value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}</div>
        <button type="button" className={`${button} flex items-center gap-2 border border-[#dfe4d6]`} onClick={() => run(async () => {
          const p = await getLocation()
          if (p.accuracy > 50) throw new Error(`GPS accuracy is ±${Math.round(p.accuracy)} m. Get a more precise fix or enter the office coordinates manually.`)
          setDraft(d => ({ ...d, latitude: p.latitude.toFixed(7), longitude: p.longitude.toFixed(7) }))
          return 'Current location copied. Check the radius and save to apply.'
        })}><Icon name="pin" />Use my current location</button>
        <label className="block text-sm">Boundary radius (metres)<input className={`${input} mt-2`} type="number" required min={25} max={5000} value={draft.radius} onChange={e => setDraft({ ...draft, radius: e.target.value })} /><span className="mt-2 block text-sm text-[#65705e]">Between 25 and 5,000 metres. Recommended: 100 m.</span></label>
        <button className={`${button} bg-[#31543d] text-white`}>{busy ? 'Saving…' : 'Save office boundary'}</button>
      </fieldset>
    </form>
    <p className="mt-6 border-t border-[#e5e9dd] pt-5 text-sm leading-6 text-[#65705e]">GPS uncertainty is considered before a boundary exit is confirmed. Changes apply on each person’s next location check, including while they are on an unpaid break. Background detection is not guaranteed when a phone is locked.</p>
  </section>
}
function AlertList({ alerts }: { alerts: Alert[] }) {
  return <div aria-live="polite" className="mt-5 space-y-4">{alerts.length ? alerts.map(a => <div key={a.id} className="flex gap-3 border-b border-[#e8ecdf] pb-4 last:border-0"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#fff1db] text-[#875d24]"><Icon name="pin" className="h-4 w-4" /></span><div className="min-w-0"><p className="text-sm leading-6">{a.message}</p><p className="mt-1 text-xs text-[#65705e]">{new Date(a.createdAt).toLocaleString('en-AU')}</p></div></div>) : <p className="py-4 text-sm leading-6 text-[#65705e]">All clear. Boundary alerts will appear here when a member’s GPS confirms they have left the office area.</p>}</div>
}
function CorrectionDialog({ entry, close, save, busy }: { entry: Entry; close: () => void; save: (data: { tapIn: string; tapOut: string | null; reason: string }) => Promise<void>; busy: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const local = (value?: string | null) => { if (!value) return ''; const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLInputElement>('input')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close() }
      if (e.key !== 'Tab') return
      const nodes = ref.current?.querySelectorAll<HTMLElement>('input, textarea, button:not(:disabled)')
      if (!nodes?.length) return
      const first = nodes[0], last = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus() }
  }, [close])
  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#142619]/50 p-4"><div ref={ref} role="dialog" aria-modal="true" aria-labelledby="correction-title" className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-[#fcfdf8] p-6 shadow-xl"><h2 id="correction-title" className="text-xl font-semibold">Edit attendance times</h2><p className="mt-2 text-sm text-[#65705e]">{personName(entry)} · Times in your device’s timezone</p><form onSubmit={async e => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const tapIn = String(f.get('tapIn')), tapOut = String(f.get('tapOut'))
    if (tapOut && Date.parse(tapOut) <= Date.parse(tapIn)) { setError('Tap-out must be after tap-in.'); return }
    setError('')
    try { await save({ tapIn: new Date(tapIn).toISOString(), tapOut: tapOut ? new Date(tapOut).toISOString() : null, reason: String(f.get('reason')) }) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to save this correction.') }
  }} className="mt-6 space-y-5"><label className="block text-sm">Tap-in time<input required name="tapIn" type="datetime-local" defaultValue={local(entry.tapIn)} className={`${input} mt-2`} /></label><label className="block text-sm">Tap-out time<input name="tapOut" type="datetime-local" defaultValue={local(entry.tapOut)} className={`${input} mt-2`} /><span className="mt-2 block text-sm text-[#65705e]">Leave blank only if this session is still open.</span></label><label className="block text-sm">Reason for correction<textarea name="reason" required minLength={5} maxLength={1000} rows={3} className={`${input} mt-2 py-3`} placeholder="For example: member forgot to tap out." /></label>{entry.correctedAt && <p className="text-sm leading-6 text-[#65705e]">Previous correction: {entry.correctionReason}<br />{entry.correctedBy} · {new Date(entry.correctedAt).toLocaleString('en-AU')}</p>}<p className="rounded-lg bg-[#eef2e6] p-3 text-sm leading-6 text-[#506443]">Previous times, administrator details, and your reason are preserved in an immutable correction log in the Admin panel.</p>{error && <p role="alert" className="text-sm text-red-800">{error}</p>}<div className="flex justify-end gap-3"><button type="button" onClick={close} className={`${button} border border-[#dfe4d6]`}>Cancel</button><button disabled={busy} className={`${button} bg-[#31543d] text-white`}>{busy ? 'Saving…' : 'Save correction'}</button></div></form></div></div>
}
function WeeklyChart({ records }: { records: Entry[] }) {
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return { label: d.toLocaleDateString('en-AU', { weekday: 'short' }), value: records.filter(r => new Date(r.tapIn).toDateString() === d.toDateString()).length } })
  const max = Math.max(4, ...days.map(d => d.value))
  return <svg role="img" aria-label={`Check-ins over the last week: ${days.map(d => `${d.label} ${d.value}`).join(', ')}`} viewBox="0 0 560 210" className="mt-4 h-[210px] w-full">{[0, 1, 2, 3, 4].map(i => <g key={i}><line x1="35" y1={170 - i * 35} x2="550" y2={170 - i * 35} stroke="#e5eadb" strokeDasharray="3 4" /><text x="15" y={174 - i * 35} fontSize="12" fill="#626e57">{Math.round(max * i / 4)}</text></g>)}{days.map((d, i) => <g key={i}><rect x={52 + i * 72} y={170 - d.value / max * 140} width="34" height={Math.max(2, d.value / max * 140)} rx="4" fill={i === 6 ? '#526e3f' : '#8ba66d'} /><text x={69 + i * 72} y="194" textAnchor="middle" fontSize="12" fill="#626e57">{d.label}</text>{d.value > 0 && <text x={69 + i * 72} y={162 - d.value / max * 140} textAnchor="middle" fontSize="12" fill="#425c34">{d.value}</text>}</g>)}</svg>
}
