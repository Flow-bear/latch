# Latch — Documentation technique

> Architecture, data model, prompts, déploiement et troubleshooting.
> Pour la vision produit et les parcours utilisateur, voir [`FUNCTIONAL.md`](./FUNCTIONAL.md).

## Sommaire

- [Stack](#stack)
- [Arborescence](#arborescence)
- [Architecture](#architecture)
- [Schéma de données](#schéma-de-données)
- [Routes](#routes)
- [Auth flow](#auth-flow)
- [Sync local → cloud](#sync-local--cloud)
- [Mode offline](#mode-offline)
- [Prompts LLM](#prompts-llm)
- [Cron du check-in matin](#cron-du-check-in-matin)
- [Eval harness](#eval-harness)
- [PWA](#pwa)
- [Variables d'environnement](#variables-denvironnement)
- [Configuration Supabase](#configuration-supabase)
- [Configuration Vercel](#configuration-vercel)
- [Setup local](#setup-local)
- [Build & déploiement](#build--déploiement)
- [Troubleshooting](#troubleshooting)
- [Dette technique connue](#dette-technique-connue)
- [Roadmap restante](#roadmap-restante)

## Stack

| Couche | Choix | Notes |
|---|---|---|
| Framework | Next.js 14 (App Router) | Une seule codebase front+back |
| Style | Tailwind CSS | Mobile-first |
| DB cloud + Auth | Supabase | RLS strict, magic link, EU region |
| DB locale (offline) | IndexedDB via Dexie 4 | Source de vérité pendant le log |
| LLM | Claude Sonnet 4.5 (via `@anthropic-ai/sdk`) | Qualité du français, prompts contraints |
| Hébergement | Vercel | Cron jobs natifs, deploy GitHub-based |
| PWA | `next-pwa` | Service worker auto-généré |
| TS runner (scripts) | `tsx` | Pour le harness d'évaluation |

## Arborescence

```
latch/
├── app/
│   ├── api/
│   │   └── checkin/route.ts        # Cron handler — génère le check-in matin
│   ├── auth/
│   │   └── callback/route.ts       # Échange magic-link code → session
│   ├── login/page.tsx              # Magic link form
│   ├── layout.tsx                  # Metadata + manifest + theme color
│   ├── page.tsx                    # State machine idle → active → done
│   └── globals.css
├── lib/
│   ├── supabase/
│   │   ├── client.ts               # createBrowserClient
│   │   ├── server.ts               # createServerClient (pour Server Components)
│   │   └── middleware.ts           # Refresh session + auth gate
│   ├── hooks/
│   │   └── useNightMode.ts         # Détection heure 21h-7h
│   ├── db.ts                       # Dexie schema (table feedings)
│   ├── sync.ts                     # IndexedDB → Supabase upsert
│   ├── prompts.ts                  # Prompts 1 et 2 (PRD §5)
│   └── feeding-stats.ts            # Formatters pour les payloads LLM
├── public/
│   ├── manifest.json
│   ├── icon-192.png                # Placeholder L blanc sur fond noir
│   └── icon-512.png
├── scripts/
│   └── evals.ts                    # Harness eval (10 fixtures)
├── supabase/
│   └── schema.sql                  # Tables + RLS + trigger profile
├── docs/
│   ├── FUNCTIONAL.md
│   └── TECHNICAL.md                # ← ce fichier
├── middleware.ts                   # Top-level Next.js middleware
├── next.config.mjs                 # next-pwa wrapper
├── vercel.json                     # Cron config
└── package.json
```

## Architecture

```
                ┌────────────────────────┐
                │  Browser (PWA installée│
                │   ou onglet Safari)    │
                └────────────┬───────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
         ┌────▼────┐                  ┌─────▼──────┐
         │ IndexedDB│ ◄─── source ─►  │  Next.js   │
         │  (Dexie) │     of truth    │  on Vercel │
         └────┬─────┘                 └─────┬──────┘
              │                             │
              │   sync.ts (upsert by         │
              │   user_id, client_id)       │
              │                             │
              │                       ┌─────▼──────┐
              └──────────────────────►│  Supabase  │
                                      │  Postgres  │
                                      │  + Auth    │
                                      └─────▲──────┘
                                            │
                            ┌───────────────┴───────────┐
                            │  Vercel Cron (hourly)     │
                            │  /api/checkin             │
                            │  → service-role client    │
                            │  → Claude Sonnet 4.5      │
                            │  → insert morning_checkins│
                            └───────────────────────────┘
```

**Idées-clés :**

- **Local-first.** L'utilisateur peut logger sans connexion ni compte. La sync est best-effort et idempotente.
- **Sync idempotente** : chaque tétée a un `client_id` UUID généré côté client. Le serveur a une contrainte `unique (user_id, client_id)` → `upsert` ne dupe jamais.
- **Cron côté serveur** : utilise la `service_role_key` Supabase qui bypass RLS pour pouvoir lire et écrire sur tous les utilisateurs.
- **Auth client-side** : le browser client utilise la `anon_key` + RLS, l'utilisateur ne voit que ses propres données.

## Schéma de données

Source : `supabase/schema.sql`. Quatre tables, toutes avec RLS strict.

```sql
profiles (id pk, baby_name, baby_birth_date, timezone, created_at)
   id : uuid -> auth.users(id)
   trigger : on_auth_user_created → insert profile auto

feedings (
  id pk uuid,
  user_id -> auth.users(id),
  client_id uuid,                            -- généré côté client (Dexie)
  started_at, ended_at timestamptz,
  side text in ('left','right','both'),
  mood_emoji text nullable,
  note text default '',
  unique (user_id, client_id)                -- pour upsert idempotent
)

morning_checkins (
  id, user_id, for_date date, message text, read_at timestamptz nullable,
  unique (user_id, for_date)                 -- 1 check-in / jour / user
)

ai_questions (
  id, user_id, question text, response text nullable, asked_at
)
```

**Politique RLS** :

- `profiles`, `feedings`, `ai_questions` : SELECT/INSERT/UPDATE/DELETE seulement sur `user_id = auth.uid()`
- `morning_checkins` : SELECT et UPDATE pour le user (read_at). **Pas de policy INSERT** — seul le cron (service_role) écrit.

## Routes

| Path | Type | Auth | Rôle |
|---|---|---|---|
| `/` | page client | requise | State machine idle/active/done + carte check-in |
| `/login` | page client | publique | Saisie email → `signInWithOtp` |
| `/auth/callback` | route handler | publique | Échange code → session, redirige vers `/` |
| `/api/checkin` | route handler | header `Bearer $CRON_SECRET` | Cron horaire, filtre tz, génère check-in |

`middleware.ts` redirige toute requête non-authentifiée vers `/login`, sauf `/login`, `/auth/*`, et les assets PWA (`manifest.json`, `sw.js`, `workbox-*.js`, icônes).

## Auth flow

```
User → /login → tape email → signInWithOtp({email, emailRedirectTo: /auth/callback})
                                          │
                                          ▼
                            Supabase envoie email magic link
                                          │
                                          ▼
                              User clique le lien
                                          │
                                          ▼
                       Browser → /auth/callback?code=...
                                          │
                                          ▼
                       Server : exchangeCodeForSession(code)
                                          │
                                          ▼
                          Cookies HTTP-only posés
                                          │
                                          ▼
                              Redirect → /
```

`@supabase/ssr` gère le refresh de session via le `middleware.ts` à chaque requête (cookies réécrits).

## Sync local → cloud

Code : `lib/sync.ts`

**Quand `syncPendingFeedings()` se déclenche :**

1. Au mount de `app/page.tsx` (ouverture de l'app)
2. Sur l'event `online` du navigateur (retour de connexion)
3. Après chaque save de tétée (`persistAndReset` → `void syncPendingFeedings()`)

**Ce qu'elle fait :**

```ts
1. Si offline → return 0
2. Récup user via supabase.auth.getUser() ; si non authed → return 0
3. Lit toutes les tétées Dexie, filtre celles avec synced=false
4. Construit le payload (snake_case fields), appelle :
     supabase.from('feedings').upsert(rows, { onConflict: 'user_id,client_id' })
5. Sur succès, marque chaque ligne synced=true dans Dexie
```

L'idempotence vient de la contrainte unique `(user_id, client_id)` côté Postgres : un même retry insère 0 ligne, met à jour 0 ligne (les valeurs sont les mêmes).

## Mode offline

L'app fonctionne **complètement** sans connexion ni compte :

- Le state machine de saisie (`idle → active → done`) ne touche que React + Dexie
- Pas de fetch dans le chemin critique
- Le service worker généré par `next-pwa` cache les assets (HTML, JS, CSS) pour qu'une réouverture sans réseau marche

Limitations connues :
- Le check-in matin n'est **pas dispo offline** (généré côté serveur)
- L'auth magic link nécessite forcément du réseau

## Prompts LLM

Fichier : `lib/prompts.ts`. Versionnés dans le repo, testés par `scripts/evals.ts`.

| Constante | Quand | Modèle | Max tokens |
|---|---|---|---|
| `MORNING_CHECKIN_SYSTEM` | Cron quotidien à 9h heure locale | claude-sonnet-4-5 | 256 |
| `ASK_QUESTION_SYSTEM` | Action « C'est normal ? » (V2) | claude-sonnet-4-5 | 512 |

Données envoyées au modèle (formatters dans `lib/feeding-stats.ts`) :

- **Check-in** : tétées des dernières 24h (heure, côté, durée, mood, note) + résumé 7 jours (moy. tétées/jour, durée moyenne, ratio gauche/droit)
- **Ask** : question utilisateur + historique 30 jours

## Cron du check-in matin

Config Vercel (`vercel.json`) :

```json
{
  "crons": [{ "path": "/api/checkin", "schedule": "0 * * * *" }]
}
```

Le cron tourne **toutes les heures (UTC)**. Le route handler filtre côté API : pour chaque profile, calcule l'heure locale via `Intl.DateTimeFormat` + `timezone`. Si l'heure locale = 9, génère le check-in (sauf s'il existe déjà pour ce `for_date`).

L'auth du cron : Vercel inject le header `Authorization: Bearer <CRON_SECRET>`. La route vérifie `process.env.CRON_SECRET`.

**Skip conditions** :

- Pas de `feedings` dans les dernières 24h → skip (pas de message vide)
- Check-in existe déjà pour aujourd'hui → skip (idempotence cron retry)

## Eval harness

```bash
npm run eval
```

Lance `scripts/evals.ts` qui :

1. Charge 10 fixtures (les 7 cas du PRD §5 + 3 ajouts)
2. Pour chaque fixture, formate les données comme le ferait le route handler
3. Appelle Claude avec le prompt 1 ou 2 selon le `kind`
4. Évalue heuristiquement : regex `mustInclude` / `mustNotInclude`
5. Affiche pass/fail par cas et un score final

**Bar à ship** : ≥ 18/20 (PRD §5). En attendant que les 10 derniers cas soient ajoutés (cas réels du créateur), bar provisoire à 8/10.

Si un cas fail, soit le prompt est faux, soit l'heuristique est trop stricte. Itérer le prompt avant l'heuristique.

## PWA

- `public/manifest.json` : nom Latch, display standalone, orientation portrait, theme #000
- `public/icon-192.png` & `icon-512.png` : placeholders (L blanc, fond noir)
- `next.config.mjs` wrap avec `next-pwa` : génère `public/sw.js` et `public/workbox-*.js` au build
- Le service worker est désactivé en dev (`disable: process.env.NODE_ENV === 'development'`)
- `app/layout.tsx` lie le manifest et expose `viewport.themeColor`

**Installation iOS** : Safari uniquement → Partager → Sur l'écran d'accueil. Chrome iOS ne peut pas installer une PWA (limitation Apple).

## Variables d'environnement

Fichier : `.env.local` (jamais commité, listé dans `.gitignore`).

| Variable | Usage | Côté |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Endpoint Supabase | client + serveur |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Auth anon (passe RLS) | client + serveur |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypass RLS (cron) | serveur uniquement |
| `ANTHROPIC_API_KEY` | Claude API | serveur uniquement |
| `CRON_SECRET` | Auth header injecté par Vercel Cron | serveur uniquement |

Sur Vercel : Settings → Environment Variables. Toutes les vars doivent exister en `Production` (et idéalement `Preview`).

## Configuration Supabase

À faire **une fois** par déploiement (manuel via dashboard) :

1. **Schéma** : SQL Editor → coller `supabase/schema.sql` → Run
2. **Auth → URL Configuration** :
   - Site URL : `https://<vercel-domain>`
   - Redirect URLs (allow-list) : `https://<vercel-domain>/auth/callback`
3. **Auth → Email Templates** (optionnel) : personnaliser le template magic link
4. **Auth → Providers → Email** : vérifier que « Enable email confirmations » est activé

Le SMTP par défaut de Supabase est limité à ~4 emails/h en free tier. Avant la beta externe → migrer vers Resend (3000 emails/mois gratuits).

## Configuration Vercel

À faire **une fois** par déploiement :

1. **Environment Variables** : ajouter les 5 vars listées plus haut (incluant `CRON_SECRET` que tu génères toi-même, ex `openssl rand -hex 32`)
2. **Cron Jobs** : activé automatiquement par `vercel.json`. Vérifier dans le dashboard → Cron Jobs qu'il apparaît.
3. **Custom domain** (optionnel) : Project Settings → Domains

## Setup local

```bash
git clone https://github.com/Flow-bear/latch.git
cd latch
npm install
cp .env.local.example .env.local   # ou créer manuellement
npm run dev                         # http://localhost:3000
```

Pour tester le magic link en local : il faut que `NEXT_PUBLIC_SITE_URL` (ou `window.location.origin`) corresponde à une URL whitelistée dans Supabase. Le plus simple est de tester l'auth uniquement en prod.

## Build & déploiement

```bash
npm run build      # Vérifie types + génère sw.js
npm run lint       # ESLint
npm run eval       # Tourne les évals LLM (consomme des credits Anthropic)
```

**Push to deploy** : tout push sur `main` déclenche un déploiement Vercel. Les artefacts PWA générés (`public/sw.js`, `public/workbox-*.js`) ne sont pas commités (gitignore).

## Troubleshooting

| Symptôme | Cause probable | Fix |
|---|---|---|
| Magic link redirige vers localhost en prod | Site URL Supabase mal configurée | Auth → URL Configuration |
| `auth/callback` retourne `?error=auth` | Code expiré ou déjà consommé | Redemander un nouveau magic link |
| Aucune tétée dans Supabase malgré logs locaux | User non-authed, ou RLS bloque | Vérifier `auth.uid()` correspond bien à `user_id` |
| Cron `/api/checkin` retourne 401 | `CRON_SECRET` manquant ou différent | Vercel env vars + redeploy |
| Cron retourne `{generated: 0}` toujours | Aucun profile ou heure locale ≠ 9 | Vérifier `profiles.timezone` cohérent |
| iPhone : impossible d'installer la PWA | Pas dans Safari, ou pas iOS 16.4+ | Safari only |
| Build fail sur `text-[#8B0000]` | Tailwind purge | Tailwind 3.4 supporte les arbitraires, pas un souci |
| Notification push ne s'affiche pas | Pas implémenté V1 | Voir [Roadmap](#roadmap-restante) |

## Dette technique connue

- **Pas de logout** dans l'UI. À ajouter quand un second user existe.
- **Pas de page « Tout mon historique »**. Pour V1 personnel, le besoin n'est pas démontré.
- **`auth/callback` ne gère que le flux PKCE (`code`)**. Si Supabase est configuré en mode legacy `token_hash`, ajouter une branche.
- **Côté `'both'`** existe en SQL mais pas en UI. Question ouverte du PRD §10.
- **Pas de timezone côté client** lors de la création du profil. Aujourd'hui hardcodée `Europe/Paris` (default SQL). À ajouter quand multi-user.
- **Service worker `next-pwa` est en mode strict** (skipWaiting). Une mise à jour de l'app peut écraser un service worker en cours sans warning.

## Roadmap restante

Ce qui n'a pas été livré dans la run A→D et qu'il reste à faire pour le V1 complet :

| Reste | Effort | Priorité |
|---|---|---|
| Action « C'est normal ? » (Prompt 2 + UI page `/ask`) | ½ jour | V1.5 |
| Push notifications iOS-PWA (VAPID, sw custom, table `push_subscriptions`) | 1-2 jours | V1.5 / V2 |
| Export PDF récap pour pédiatre (`react-pdf`) | 1 jour | V1.5 |
| Compléter le harness eval à 20 cas (10 ajoutés, 10 manquants) | ½ jour | Avant beta |
| Logout + page settings | ½ jour | Avant beta |
| Migration SMTP → Resend | ¼ jour | Avant beta |
| RGPD : DPA Supabase + chiffrement des `note` | 1 jour | Avant beta externe |
