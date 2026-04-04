import { useCallback, useState } from 'react'
import { apiUrl } from './lib/api-url'
import './App.css'

function App() {
  const [health, setHealth] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const checkBackend = useCallback(async () => {
    setLoading(true)
    setHealth(null)
    try {
      const res = await fetch(apiUrl('/api/health/live'))
      const text = await res.text()
      setHealth(`${res.status} ${res.statusText}${text ? `: ${text}` : ''}`)
    } catch (e) {
      setHealth(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }, [])

  return (
    <div className="app">
      <header className="header">
        <h1>Kulloo</h1>
        <p className="tagline">React frontend · Vite + TypeScript</p>
      </header>
      <main className="main">
        <p>
          API calls use <code>{apiUrl('/api/…')}</code> (relative by default; optional{' '}
          <code>VITE_API_BASE_URL</code> at build time).
        </p>
        <button type="button" className="btn" onClick={checkBackend} disabled={loading}>
          {loading ? 'Checking…' : 'Ping backend (GET /api/health/live)'}
        </button>
        {health !== null && (
          <pre className="result" role="status">
            {health}
          </pre>
        )}
      </main>
    </div>
  )
}

export default App
