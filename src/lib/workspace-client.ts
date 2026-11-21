export const button = 'min-h-11 rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64844b] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#e4e8dc] disabled:text-[#526049]'
export const input = 'min-h-11 w-full rounded-lg border border-[#dce2d4] bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#64844b]'
export const card = 'rounded-xl border border-[#e0e5d7] bg-[#fdfefa]'

export async function send(data: object) {
  const response = await fetch('/api/workspace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-Request': '1' },
    body: JSON.stringify(data),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Unable to complete this request.')
  return result as { message: string; signedOut?: boolean }
}
