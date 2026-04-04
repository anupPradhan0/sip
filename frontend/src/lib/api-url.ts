/**
 * Builds a URL for the Kulloo HTTP API.
 * - Default (no env): relative paths like `/api/...` — works with Vite dev proxy, Docker nginx `/api` proxy, or any reverse proxy that forwards `/api` to the backend.
 * - `VITE_API_BASE_URL`: set at build time when the browser must call the API on another host (no same-origin proxy).
 */
export function apiUrl(path: string): string {
  const raw = import.meta.env.VITE_API_BASE_URL?.trim() ?? ''
  const base = raw.replace(/\/$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return base ? `${base}${p}` : p
}
