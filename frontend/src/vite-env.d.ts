/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional absolute API origin (no path, no trailing slash), e.g. `https://api.example.com`.
   * Set at **build time** only when the UI and API are on different origins and you are not using a same-origin `/api` proxy.
   */
  readonly VITE_API_BASE_URL?: string
}
