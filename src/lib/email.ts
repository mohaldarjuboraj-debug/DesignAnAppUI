import type { EmailAdapter } from 'payload'

export const resendEmail: EmailAdapter = () => ({
  name: 'resend',
  defaultFromAddress: process.env.EMAIL_FROM_ADDRESS || '',
  defaultFromName: 'The Break',
  async sendEmail(message) {
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM_ADDRESS) throw new Error('Email delivery is not configured.')
    const recipients = (Array.isArray(message.to) ? message.to : [message.to])
      .flatMap((value: string | { address?: string } | undefined) => typeof value === 'string' ? [value] : value?.address ? [value.address] : [])
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `The Break <${process.env.EMAIL_FROM_ADDRESS}>`,
        to: recipients,
        subject: message.subject || 'The Break',
        html: typeof message.html === 'string' ? message.html : undefined,
        text: typeof message.text === 'string' ? message.text : undefined,
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error('Email delivery failed. Please contact your administrator.')
    return { delivered: true }
  },
})

export function resetEmailHTML(token?: string) {
  const origin = process.env.NEXT_PUBLIC_SITE_URL || process.env.FIGMA_PUBLIC_URL
  if (!origin || !token) throw new Error('Password reset links are not configured.')
  const link = new URL('/', origin)
  link.searchParams.set('reset', token)
  const safeURL = link.toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return `<h1>Reset your password</h1><p>A password reset was requested for your The Break account.</p><p><a href="${safeURL}">Choose a new password</a></p><p>This one-use link expires in 30 minutes. If you did not request it, you can ignore this email. Resetting your password does not clear an attendance restriction; an administrator must review it.</p>`
}
