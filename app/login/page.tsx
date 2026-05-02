'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useNightMode } from '@/lib/hooks/useNightMode'
import { createClient } from '@/lib/supabase/client'

export default function Login() {
  const night = useNightMode()
  const router = useRouter()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const supabase = createClient()
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    setLoading(false)
    if (err) setError(err.message)
    else setStep('code')
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const supabase = createClient()
    const { error: err } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    })
    setLoading(false)
    if (err) {
      setError(err.message)
    } else {
      router.push('/')
      router.refresh()
    }
  }

  const inputClass = `rounded-2xl border p-4 text-base focus:outline-none focus:ring-2 disabled:opacity-50 ${
    night
      ? 'bg-black border-[#8B0000]/40 text-[#8B0000] placeholder-[#8B0000]/40 focus:ring-[#8B0000]'
      : 'border-neutral-200 focus:ring-neutral-900'
  }`
  const primaryBtnClass = `rounded-2xl py-4 text-lg font-medium transition-colors disabled:opacity-50 ${
    night
      ? 'border-2 border-[#8B0000] text-[#8B0000] active:bg-[#8B0000]/10'
      : 'bg-neutral-900 text-white active:bg-neutral-700'
  }`
  const secondaryClass = `text-sm underline underline-offset-2 ${
    night ? 'text-[#8B0000]/70' : 'text-neutral-500'
  }`

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
          {step === 'email'
            ? 'Connecte-toi avec ton email.'
            : `Code envoyé à ${email}. Tape les 6 chiffres reçus.`}
        </p>

        {step === 'email' ? (
          <form onSubmit={sendCode} className="flex flex-col gap-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ton@email.com"
              autoComplete="email"
              disabled={loading}
              className={inputClass}
            />
            <button
              type="submit"
              disabled={loading}
              className={primaryBtnClass}
            >
              {loading ? 'Envoi…' : 'Recevoir un code'}
            </button>
            {error && (
              <div
                className={`text-sm ${
                  night ? 'text-[#8B0000]/80' : 'text-red-700'
                }`}
              >
                {error}
              </div>
            )}
          </form>
        ) : (
          <form onSubmit={verifyCode} className="flex flex-col gap-3">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              minLength={6}
              pattern="[0-9]{6}"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
              }
              placeholder="123456"
              disabled={loading}
              autoFocus
              className={`${inputClass} text-center text-2xl tracking-[0.5em] font-mono`}
            />
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className={primaryBtnClass}
            >
              {loading ? 'Vérification…' : 'Valider'}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('email')
                setCode('')
                setError(null)
              }}
              className={secondaryClass}
            >
              ← Changer d&apos;email
            </button>
            {error && (
              <div
                className={`text-sm ${
                  night ? 'text-[#8B0000]/80' : 'text-red-700'
                }`}
              >
                {error}
              </div>
            )}
            <p
              className={`text-xs mt-4 ${
                night ? 'text-[#8B0000]/50' : 'text-neutral-400'
              }`}
            >
              Tu peux aussi cliquer le lien dans l&apos;email si tu préfères.
            </p>
          </form>
        )}
      </div>
    </main>
  )
}
