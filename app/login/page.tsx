'use client'

import { useState } from 'react'
import { useNightMode } from '@/lib/hooks/useNightMode'

export default function Login() {
  const night = useNightMode()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // TODO C3: supabase.auth.signInWithOtp({ email })
    console.log('magic link requested for', email)
    setSent(true)
  }

  return (
    <main
      className={`min-h-screen flex flex-col p-6 ${
        night ? 'bg-black text-[#8B0000]' : 'bg-white text-neutral-900'
      }`}
    >
      <div className="flex-1 flex flex-col justify-center max-w-md w-full mx-auto">
        <h1 className="text-3xl font-semibold mb-2">Latch</h1>
        <p
          className={`mb-8 ${
            night ? 'text-[#8B0000]/70' : 'text-neutral-500'
          }`}
        >
          Connecte-toi avec ton email.
        </p>
        {sent ? (
          <div
            className={`rounded-2xl p-4 ${
              night ? 'border border-[#8B0000]/40' : 'bg-neutral-100'
            }`}
          >
            Lien envoyé à <strong>{email}</strong>. Ouvre l&apos;email pour te
            connecter.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ton@email.com"
              autoComplete="email"
              className={`rounded-2xl border p-4 text-base focus:outline-none focus:ring-2 ${
                night
                  ? 'bg-black border-[#8B0000]/40 text-[#8B0000] placeholder-[#8B0000]/40 focus:ring-[#8B0000]'
                  : 'border-neutral-200 focus:ring-neutral-900'
              }`}
            />
            <button
              type="submit"
              className={`rounded-2xl py-4 text-lg font-medium transition-colors ${
                night
                  ? 'border-2 border-[#8B0000] text-[#8B0000] active:bg-[#8B0000]/10'
                  : 'bg-neutral-900 text-white active:bg-neutral-700'
              }`}
            >
              Recevoir un lien
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
