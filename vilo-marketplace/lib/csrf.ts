import type { NextRequest } from 'next/server'

/**
 * Origin-based CSRF guard for state-changing admin endpoints.
 *
 * Cookie-based auth means a malicious site could trick a logged-in
 * admin's browser into POSTing a request to /api/admin/* — the cookie
 * rides along. Standard mitigation: refuse the request unless the
 * Origin header matches a known-good origin.
 *
 * We don't bother with a CSRF token: every admin mutation is on a
 * same-origin XHR from the admin UI, where Origin is always sent by
 * the browser, and a third-party site can't forge Origin from JS.
 *
 * Allowed origins:
 *   - the request's own host (covers any Vercel deployment URL,
 *     custom domains, and localhost without us having to enumerate
 *     them)
 *   - explicit additions via VILO_ALLOWED_ORIGINS (comma-separated)
 *     for the rare cross-origin admin call (none today).
 *
 * Returns null if the request passes the check, or an error string
 * describing the failure for the caller to put in a 403 response.
 */
export function checkSameOrigin(request: NextRequest): string | null {
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')
  const host = request.headers.get('host')
  if (!host) return 'missing host header'

  // Synthesize the request's own origin from forwarded proto + host so
  // we can compare against the Origin header even behind Vercel's edge.
  const proto =
    request.headers.get('x-forwarded-proto') ||
    (request.url.startsWith('https://') ? 'https' : 'http')
  const selfOrigin = `${proto}://${host}`

  const extra = (process.env.VILO_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const allowed = new Set([selfOrigin, ...extra])

  // Prefer Origin; fall back to Referer's origin if Origin absent (some
  // browsers omit Origin on same-origin GET-following-form-POST flows).
  let candidate: string | null = origin
  if (!candidate && referer) {
    try {
      const u = new URL(referer)
      candidate = `${u.protocol}//${u.host}`
    } catch {
      // ignore
    }
  }

  if (!candidate) return 'missing origin / referer header'
  if (!allowed.has(candidate)) {
    return `origin "${candidate}" not allowed (expected one of ${[...allowed].join(', ')})`
  }
  return null
}
