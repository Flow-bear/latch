'use client'

import { useState } from 'react'

export default function Home() {
  const [response, setResponse] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function testClaude() {
    setLoading(true)
    setError(null)
    setResponse(null)
    try {
      const res = await fetch('/api/test-claude')
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`)
      } else {
        setResponse(data.text)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-neutral-50 dark:bg-neutral-950">
      <div className="w-full max-w-xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
            latch
          </h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Test de l&apos;API Claude (claude-sonnet-4-5)
          </p>
        </header>

        <button
          onClick={testClaude}
          disabled={loading}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-50 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {loading ? 'Appel en cours…' : 'Tester Claude'}
        </button>

        {response && (
          <div className="rounded-md border border-neutral-200 bg-white p-4 text-sm text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200">
            {response}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </div>
        )}
      </div>
    </main>
  )
}
