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
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
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

  const c = night
    ? {
        bg: 'bg-[#1a1410]',
        text: 'text-[#d4b896]',
        muted: 'text-[#d4b896]/55',
        soft: 'text-[#d4b896]/75',
        ring: 'border-[#d4b896]/20',
        ringStrong: 'border-[#d4b896]/50',
        hoverFill: 'active:bg-[#d4b896]/10',
        inputBg: 'bg-[#241c17]',
        accent: 'bg-[#c89878]',
        accentText: 'text-[#1a1410]',
      }
    : {
        bg: 'bg-[#f7f2e9]',
        text: 'text-[#2c241e]',
        muted: 'text-[#2c241e]/55',
        soft: 'text-[#2c241e]/75',
        ring: 'border-[#2c241e]/15',
        ringStrong: 'border-[#2c241e]/40',
        hoverFill: 'active:bg-[#2c241e]/5',
        inputBg: 'bg-white',
        accent: 'bg-[#b07050]',
        accentText: 'text-[#f7f2e9]',
      }

  const inputClass = `rounded-3xl border p-4 text-base focus:outline-none focus:ring-2 disabled:opacity-50 ${c.inputBg} ${c.ring} ${c.text} placeholder:opacity-40 focus:ring-current`
  const primaryBtnClass = `rounded-full py-4 text-base font-light tracking-wide transition-colors disabled:opacity-50 ${c.accent} ${c.accentText} active:opacity-80`

  return (
    <main className={`min-h-screen flex flex-col p-6 ${c.bg} ${c.text}`}>
      <div className="flex-1 flex flex-col justify-center max-w-md w-full mx-auto">
        <h1
          className={`text-base font-light tracking-[0.32em] uppercase mb-10 ${c.soft}`}
        >
          Latch
        </h1>
        <p className={`mb-10 text-lg leading-relaxed ${c.text}`}>
          {step === 'email'
            ? 'Connecte-toi avec ton email.'
            : (
              <>
                Code envoyé à
                <br />
                <span className="font-medium">{email}</span>
                <br />
                <span className={`text-sm ${c.muted}`}>
                  Tape les 6 chiffres reçus
                </span>
              </>
            )}
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
            <button type="submit" disabled={loading} className={primaryBtnClass}>
              {loading ? 'Envoi…' : 'Recevoir un code'}
            </button>
            {error && (
              <div className={`text-sm mt-2 ${c.soft}`}>{error}</div>
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
              placeholder="000000"
              disabled={loading}
              autoFocus
              className={`${inputClass} text-center text-3xl tracking-[0.5em] font-mono`}
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
              className={`text-xs underline underline-offset-4 mt-2 ${c.muted}`}
            >
              ← Changer d&apos;email
            </button>
            {error && (
              <div className={`text-sm mt-2 ${c.soft}`}>{error}</div>
            )}
            <p className={`text-xs mt-6 ${c.muted}`}>
              Tu peux aussi cliquer le lien dans l&apos;email si tu préfères.
            </p>
          </form>
        )}
      </div>
    </main>
  )
}
