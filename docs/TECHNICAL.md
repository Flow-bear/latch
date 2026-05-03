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
- [Tests E2E](#tests-e2e)
- [PWA](#pwa)
- [Variables d'environnement](#variables-denvironnement)
- [Configuration Supabase](#configuration-supabase)
- [Configuration Vercel](#configuration-vercel)
- [Configuration Resend](#configuration-resend)
- [Setup local](#setup-local)
- [Build & déploiement](#build--déploiement)
- [Troubleshooting](#troubleshooting)
- [Dette technique connue](#dette-technique-connue)
- [Roadmap restante](#roadmap-restante)

## Stack

| Couche | Choix | Notes |
|---|---|---|
| Framework | Next.js 14 (App Router) | Une seule codebase front+back |
| Style | Tailwind CSS | Mobile-first, palette warm intimate |
| DB cloud + Auth | Supabase (Frankfurt EU) | RLS strict, magic link + OTP, custom SMTP via Resend |
| DB locale (offline) | IndexedDB via Dexie 4 | Source de vérité pendant le log |
| LLM | Claude Sonnet 4.5 (`@anthropic-ai/sdk`) | Qualité du français, prompts contraints |
| SMTP | Resend (free tier 3000/mois) | Sender `onboarding@resend.dev` (à migrer vers domaine vérifié avant beta) |
| Hébergement | Vercel Hobby | Cron quotidien (limite Hobby), deploy GitHub-based |
| PWA | `next-pwa` | Service worker auto-généré |
| Tests E2E | Playwright + scripts ad-hoc | `npm run` non utilisé, scripts dans `scripts/` |

## Arborescence

```
latch/
├── app/
│   ├── api/
│   │   └── checkin/route.ts        # Cron handler — génère le check-in matin
│   ├── auth/
│   │   └── callback/route.ts       # Échange magic-link code → session
│   ├── login/page.tsx              # Email + OTP code 2-step (ou magic link)
│   ├── layout.tsx                  # Metadata + manifest + theme color
│   ├── page.tsx                    # State machine idle → active → done
│   └── globals.css
├── lib/
│   ├── supabase/
│   │   ├── client.ts               # createBrowserClient
│   │   ├── server.ts               # createServerClient (Server Components)
│   │   └── middleware.ts           # Refresh session + auth gate
│   ├── hooks/
│   │   └── useNightMode.ts         # Détection 21h-7h
│   ├── db.ts                       # Dexie schema (table feedings, v2)
│   ├── sync.ts                     # IndexedDB → Supabase upsert
│   ├── prompts.ts                  # Prompts 1 et 2 (PRD §5)
│   └── feeding-stats.ts            # Formatters pour les payloads LLM
├── public/
│   ├── manifest.json               # PWA, theme #1a1410
│   ├── icon-192.png / icon-512.png # Placeholders L blanc / fond noir
├── scripts/
│   ├── apply-schema.mjs            # Apply supabase/schema.sql via Mgmt API
│   ├── evals.ts                    # Harness eval LLM (10 fixtures)
│   ├── e2e-login.mjs               # Test UI login (Playwright)
│   ├── e2e-feeding.mjs             # Test data path REST (auth, RLS, sync)
│   ├── e2e-browser.mjs             # Test UI authentifié end-to-end
│   └── visual-preview.mjs          # Screenshots day+night avant deploy
├── supabase/
│   └── schema.sql                  # Tables + RLS + trigger profile auto
├── docs/
│   ├── FUNCTIONAL.md
│   └── TECHNICAL.md                # ← ce fichier
├── middleware.ts                   # Top-level Next.js middleware
├── next.config.mjs                 # next-pwa wrapper
├── vercel.json                     # Cron daily 8 UTC
└── package.json                    # scripts: dev, build, lint, eval
```

## Architecture

```
                ┌────────────────────────┐
                │  Browser (PWA installée│
                │  ou onglet Safari)     │
                └────────────┬───────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
         ┌────▼─────┐                  ┌────▼───────┐
         │ IndexedDB│ ◄─── source ─►   │  Next.js   │
         │  (Dexie) │     of truth     │  on Vercel │
         └────┬─────┘                  └────┬───────┘
              │                             │
              │   sync.ts (upsert by        │
              │   user_id, client_id)       │
              │                             │
              │                       ┌─────▼──────┐
              └──────────────────────►│  Supabase  │
                                      │  Postgres  │
                                      │  + Auth    │
                                      └─────▲──────┘
                                            │
                            ┌───────────────┴───────────┐
                            │  Vercel Cron (daily 8UTC) │
                            │  /api/checkin             │
                            │  → service-role client    │
                            │  → Claude Sonnet 4.5      │
                            │  → insert morning_checkins│
                            └───────────────────────────┘

                                Auth emails:
                            Supabase Auth → Resend SMTP
                            → user inbox
```

**Idées-clés :**

- **Local-first.** L'utilisateur peut logger sans connexion ni compte. La sync est best-effort et idempotente.
- **Sync idempotente** : chaque tétée a un `client_id` UUID généré côté client. Le serveur a une contrainte `unique (user_id, client_id)` → `upsert` ne dupe jamais.
- **Cron côté serveur** : utilise la `service_role_key` Supabase qui bypass RLS pour pouvoir lire et écrire sur tous les utilisateurs.
- **Auth client-side** : le browser client utilise la `anon_key` + RLS, l'utilisateur ne voit que ses propres données.
- **Cookies SSR** : `@supabase/ssr` v0.10 stocke la session dans un cookie `sb-<ref>-auth-token` au format `base64-<base64url(JSON.stringify(session))>`, chunké si > 3180 bytes.

## Schéma de données

Source : `supabase/schema.sql`. Quatre tables, toutes avec RLS strict.

```sql
profiles (
  id uuid pk -> auth.users(id) on delete cascade,
  baby_name text, baby_birth_date date,
  timezone text default 'Europe/Paris',
  created_at timestamptz
)
   trigger on_auth_user_created → insert profile auto

feedings (
  id pk uuid default gen_random_uuid(),
  user_id -> auth.users(id) on delete cascade,
  client_id uuid,                       -- généré côté client (Dexie)
  started_at, ended_at timestamptz,
  side text check ('left'|'right'|'both'),
  mood_emoji text nullable,
  note text default '',
  unique (user_id, client_id)           -- pour upsert idempotent
)

morning_checkins (
  id, user_id, for_date date,
  message text, read_at timestamptz nullable,
  unique (user_id, for_date)            -- 1 check-in / jour / user
)

ai_questions (
  id, user_id, question text,
  response text nullable, asked_at
)
```

**Politique RLS** :

- `profiles`, `feedings`, `ai_questions` : SELECT/INSERT/UPDATE/DELETE seulement sur `user_id = auth.uid()` (`profiles.id` pour profiles)
- `morning_checkins` : SELECT et UPDATE pour le user (read_at). **Pas de policy INSERT** — seul le cron (service_role) écrit.

## Routes

| Path | Type | Auth | Rôle |
|---|---|---|---|
| `/` | client page | requise | State machine idle/active/done + carte check-in |
| `/login` | client page | publique | Email → OTP code 6 chiffres OU magic link |
| `/auth/callback` | route handler | publique | Échange `?code=` (PKCE) → session, redirige vers `/` |
| `/api/checkin` | route handler | header `Bearer $CRON_SECRET` | Cron quotidien, génère check-in pour tous les profiles |

`middleware.ts` redirige toute requête non-authentifiée vers `/login`, sauf `/login`, `/auth/*`, `/api/*` (les API gèrent leur propre auth), et les assets PWA.

## Auth flow

Deux chemins, **même email** envoyé par Resend :

```
User → /login → tape email → signInWithOtp({email, emailRedirectTo: /auth/callback})
                                          │
                                          ▼
                            Supabase → Resend SMTP → email avec :
                            • Code 6 chiffres en gros
                            • Magic link en dessous
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  │                                               │
        OPTION A — Code OTP                              OPTION B — Magic link
                  │                                               │
                  ▼                                               ▼
   /login step 'code' → tape les 6 chiffres        Click le lien dans l'email
   → verifyOtp({email, token, type: 'email'})      → /auth/callback?code=...
                  │                                               │
                  ▼                                               ▼
   Cookie SSR posé via createBrowserClient         Server : exchangeCodeForSession(code)
                  │                                               │
                  └───────────────────┬───────────────────────────┘
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

L'idempotence vient de la contrainte unique `(user_id, client_id)` côté Postgres.

## Mode offline

L'app fonctionne **complètement** sans connexion ni compte :

- Le state machine de saisie (`idle → active → done`) ne touche que React + Dexie
- Pas de fetch dans le chemin critique
- Le service worker généré par `next-pwa` cache les assets (HTML, JS, CSS) pour qu'une réouverture sans réseau marche

Limitations connues :
- Le check-in matin n'est **pas dispo offline** (généré côté serveur)
- L'auth nécessite forcément du réseau

## Prompts LLM

Fichier : `lib/prompts.ts`. Versionnés dans le repo, testés par `scripts/evals.ts`.

| Constante | Quand | Modèle | Max tokens |
|---|---|---|---|
| `MORNING_CHECKIN_SYSTEM` | Cron quotidien (8h UTC) | claude-sonnet-4-5 | 256 |
| `ASK_QUESTION_SYSTEM` | Action « C'est normal ? » (V2) | claude-sonnet-4-5 | 512 |

Données envoyées au modèle (formatters dans `lib/feeding-stats.ts`) :

- **Check-in** : tétées des dernières 24h (heure, côté, durée, mood, note) + résumé 7 jours (moy. tétées/jour, durée moyenne, ratio gauche/droit)
- **Ask** : question utilisateur + historique 30 jours

## Cron du check-in matin

Config Vercel (`vercel.json`) :

```json
{
  "crons": [{ "path": "/api/checkin", "schedule": "0 8 * * *" }]
}
```

Le cron tourne **une fois par jour à 8h UTC** = 9-10h Paris selon DST. Choix lié au plan Vercel **Hobby** qui ne permet qu'un cron quotidien max — pas de filtre par timezone côté handler. Pour passer en multi-user avec horaires locaux, upgrade Pro + restaurer le filtre `localHour === 9` dans `app/api/checkin/route.ts`.

L'auth du cron : Vercel inject le header `Authorization: Bearer <CRON_SECRET>`. La route vérifie `process.env.CRON_SECRET`.

**Skip conditions** :

- Pas de `feedings` dans les dernières 24h pour un user → skip ce user
- Check-in existe déjà pour aujourd'hui pour un user → skip (idempotence cron retry)

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

**Bar à ship** : ≥ 18/20 (PRD §5). En attendant que les 10 derniers cas soient ajoutés, bar provisoire à 8/10.

Si un cas fail, soit le prompt est faux, soit l'heuristique est trop stricte. Itérer le prompt avant l'heuristique.

## Tests E2E

Trois scripts complémentaires dans `scripts/`, lancés à la main avec `node scripts/<name>.mjs` :

| Script | Couvre | Output |
|---|---|---|
| `e2e-login.mjs` | Routing, UI publique login, formulaire, SMTP Resend | 9/9 ✅ + screenshots `1-login.png`, `2-filled.png`, `3-sent.png` |
| `e2e-feeding.mjs` | OTP admin, verifyOtp REST, upsert authentifié, RLS | 10/10 ✅ |
| `e2e-browser.mjs` | UI authentifiée full Playwright (cookie injection), state machine, sync IndexedDB → Supabase | 15/15 ✅ + screenshots `b1-idle.png` à `b4-mood.png` |

`visual-preview.mjs` build un prod local sur port 4101, monte une vraie session via OTP admin, et prend 7 screenshots dans `scripts/test-screens/preview-*.png` :
- `day-checkin-open` / `night-checkin-open` — carte BONJOUR dépliée (Supabase `morning_checkins` mocké via `page.route()`)
- `day-checkin-collapsed` / `night-checkin-collapsed` — bande compacte (localStorage `latch:checkin-collapsed:<date>` pré-set via `addInitScript`)
- `day-no-checkin` — sans carte (mock renvoie 406 PGRST116)
- `day-login` / `night-login` — page publique

Workflow : `npm run build && node scripts/visual-preview.mjs`. Lancer **toujours** après chaque modif d'`app/page.tsx` pour valider le rendu sans avoir à se connecter manuellement.

**Gotchas** (causes de screenshots vides ou stale, déjà fixés mais à savoir) :
- Le `next start` est spawn avec `shell: true` → sur Windows, `server.kill()` ne tue que le wrapper. Le node enfant survit, garde le port 4101, et sert l'**ancien** build au prochain run. Le script utilise `taskkill /F /T /PID` pour tuer l'arbre, et refuse de démarrer si 4101 est déjà occupé.
- `next-pwa` enregistre un service worker qui peut servir des chunks périmés. Le script crée le contexte Playwright avec `serviceWorkers: 'block'`.
- Toujours rebuild (`npm run build`) avant de relancer — sinon `next start` sert un build dont les chunks ne correspondent plus à `app/page.tsx` et la page ne hydrate pas.

Total **34/34** sur les 3 dimensions critiques.

**Cookie injection trick** (`e2e-browser.mjs` + `visual-preview.mjs`) : on évite la livraison d'email en mintant la session via admin + verifyOtp REST, puis en construisant le cookie SSR au format `base64-<base64url(session)>` (chunké si besoin via `createChunks` de `@supabase/ssr/dist/main/utils/chunker.js`).

## PWA

- `public/manifest.json` : nom Latch, display standalone, orientation portrait, theme `#1a1410`, background `#1a1410`
- `public/icon-192.png` & `icon-512.png` : placeholders (L blanc, fond noir)
- `next.config.mjs` wrap avec `next-pwa` : génère `public/sw.js` et `public/workbox-*.js` au build
- Le service worker est désactivé en dev (`disable: process.env.NODE_ENV === 'development'`)
- `app/layout.tsx` lie le manifest et expose `viewport.themeColor` avec media-query (cream `#f7f2e9` en light, espresso `#1a1410` en dark)

**Installation iOS** : Safari uniquement → Partager → Sur l'écran d'accueil. Chrome iOS ne peut pas installer une PWA (limitation Apple).

**Mise à jour de l'app** : `next-pwa` configuré avec `skipWaiting: true`. Le SW prend la nouvelle version au prochain chargement. Si bloqué : DevTools → Application → Service Workers → Unregister, puis F5.

## Variables d'environnement

Fichier : `.env.local` (jamais commité, listé dans `.gitignore`).

| Variable | Usage | Côté |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Endpoint Supabase | client + serveur |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Auth anon (passe RLS) | client + serveur |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypass RLS (cron, scripts admin) | serveur uniquement |
| `ANTHROPIC_API_KEY` | Claude API | serveur uniquement |
| `CRON_SECRET` | Auth header injecté par Vercel Cron (sans newline trailing) | serveur uniquement |

Sur Vercel : Settings → Environment Variables. Toutes les vars doivent exister en `Production` (et idéalement `Preview`).

## Configuration Supabase

Driveable via la Supabase Management API avec un Personal Access Token (`sbp_*`). Tout est scriptable.

**Schéma SQL** :
```bash
node scripts/apply-schema.mjs <project-ref> <pat>
```

**Auth URLs** (PATCH `/v1/projects/{ref}/config/auth`) :
- `site_url`: `https://<vercel-domain>`
- `uri_allow_list`: `https://<vercel-domain>/auth/callback,https://<vercel-domain>/**`

**SMTP** (Resend) :
- `smtp_host`: `smtp.resend.com`
- `smtp_port`: `"465"` (string!)
- `smtp_user`: `resend`
- `smtp_pass`: `re_...` (Resend API key)
- `smtp_admin_email`: `onboarding@resend.dev` (ou `noreply@<domaine-vérifié>`)
- `smtp_sender_name`: `Latch`
- `smtp_max_frequency`: `5` (number) — secondes entre 2 envois au même email

**Rate limits Auth** :
- `rate_limit_email_sent`: `100` (par projet par heure)

**Email template magic link** :
- `mailer_subjects_magic_link`: `Ton code Latch`
- `mailer_templates_magic_link_content`: HTML qui affiche `{{ .Token }}` en gros + lien `{{ .ConfirmationURL }}`

**OTP length** : `mailer_otp_length: 6` (default est 8 — incompatible avec input 6 chiffres)

## Configuration Vercel

Driveable via Vercel CLI (`npm install -g vercel`, `vercel login`).

```bash
vercel link --yes --project latch
echo -n "<random-hex>" > tmp.txt
cmd /c "vercel env add CRON_SECRET production < tmp.txt"  # sans newline !
vercel --prod --yes  # déploie
```

⚠️ **`CRON_SECRET` ne doit PAS contenir de newline trailing** — sinon le deploy fail avec "contains leading or trailing whitespace, which is not allowed in HTTP header values". PowerShell pipe ajoute un newline → utiliser `cmd /c "... < file"` avec `[System.IO.File]::WriteAllText` qui n'ajoute pas de newline.

**Cron Jobs** : activé automatiquement par `vercel.json`. Vérifier dans le dashboard → Cron Jobs qu'il apparaît avec schedule `0 8 * * *`.

## Configuration Resend

1. Créer un compte sur `resend.com` (l'email du compte = seul destinataire autorisé tant qu'aucun domaine n'est vérifié)
2. API Keys → Create → permissions "Sending access" suffisent, mettre dans Supabase auth config
3. **Avant beta externe** : Domains → Add domain → ajouter SPF/DKIM/return-path DNS → attendre vérif → changer `smtp_admin_email` en `noreply@<domain>`

## Setup local

```bash
git clone https://github.com/Flow-bear/latch.git
cd latch
npm install
# Créer .env.local avec les 5 vars (cf. plus haut)
npm run dev   # http://localhost:3000
```

Pour tester le magic link en local : il faut que `localhost:3000/auth/callback` soit whitelisté dans Supabase → Auth → URL Configuration. Plus simple : tester l'auth uniquement en prod.

## Build & déploiement

```bash
npm run build      # vérifie types + génère sw.js
npm run lint       # ESLint
npm run eval       # tourne les évals LLM (consomme du crédit Anthropic)
node scripts/e2e-browser.mjs  # full E2E (consomme un OTP admin)
```

**Push to deploy** : tout push sur `main` déclenche un déploiement Vercel auto. `vercel --prod --yes` permet de forcer un deploy depuis le local. Les artefacts PWA générés (`public/sw.js`, `public/workbox-*.js`) ne sont pas commités.

## Troubleshooting

| Symptôme | Cause probable | Fix |
|---|---|---|
| `email rate limit exceeded` au login | `rate_limit_email_sent` Supabase trop bas (default 2/h) | PATCH `/v1/projects/{ref}/config/auth` → 100 |
| `Error sending magic link email` | Resend rejette le destinataire (domaine non vérifié) | Utiliser l'email du compte Resend, ou vérifier un domaine |
| Token has expired or is invalid (sur OTP) | Code 8 chiffres reçu mais input 6 chiffres | Set `mailer_otp_length: 6` dans Supabase auth config |
| `email rate limit exceeded` même avec 100/h | `smtp_max_frequency` (60s par défaut) bloque les retries rapides | Set à 5 secondes |
| Deploy fail "CRON_SECRET contains whitespace" | Pipe PowerShell ajoute newline | Écrire en file UTF-8 sans BOM, `cmd /c < file` |
| Magic link redirige vers localhost en prod | Site URL Supabase mal configurée | Auth → URL Configuration |
| `auth/callback` retourne `?error=auth` | Code expiré ou déjà consommé, OU magic link `admin.generateLink` (implicit flow ≠ PKCE attendu) | Refaire un signInWithOtp depuis le formulaire |
| Aucune tétée dans Supabase malgré logs locaux | User non-authed, ou RLS bloque | Vérifier `auth.uid()` correspond bien à `user_id` |
| Cron `/api/checkin` retourne 401 | `CRON_SECRET` manquant ou différent ou avec whitespace | Re-add env var sans newline + redeploy |
| Cron retourne `{generated: 0}` toujours | Aucun profile, ou aucune feeding 24h | Vérifier que `profiles` contient l'user et que `feedings` a des lignes récentes |
| Hobby plan : "cron expression would run more than once per day" | Vercel Hobby = 1 cron/jour max | Schedule en `0 8 * * *` (daily) |
| iPhone : impossible d'installer la PWA | Pas dans Safari, ou pas iOS 16.4+ | Safari only |
| Browser sert vieille UI après deploy | Service worker cache | Hard refresh (Ctrl+Shift+R) ou DevTools → Service Workers → Unregister |
| Notification push ne s'affiche pas | Pas implémenté V1 | Voir [Roadmap](#roadmap-restante) |

## Dette technique connue

- **Pas de logout** dans l'UI. À ajouter quand un second user existe.
- **Pas de page « Tout mon historique »**. Pour V1 personnel, le besoin n'est pas démontré.
- **`auth/callback` ne gère que le flux PKCE (`code`)**. Si Supabase est configuré en mode legacy `token_hash`, ajouter une branche.
- **Côté `'both'`** existe en SQL mais pas en UI. Question ouverte du PRD §10.
- **Pas de timezone côté client** lors de la création du profil. Aujourd'hui hardcodée `Europe/Paris` (default SQL). À ajouter quand multi-user (et qu'on est sur Vercel Pro avec cron horaire).
- **Service worker `next-pwa` est en mode strict** (skipWaiting). Une mise à jour peut écraser un SW en cours sans warning.
- **Domaine Resend non vérifié**. Seul `alexandreschwerkolt@gmail.com` (email du compte) reçoit les magic links. Bloqueur pour beta externe.
- **Cron daily, pas hourly**. Le filtre timezone existe en code mais désactivé. Restaurer après upgrade Pro.

## Roadmap restante

| Reste | Effort | Priorité |
|---|---|---|
| Action « C'est normal ? » (Prompt 2 + UI page `/ask`) | ½ jour | V1.5 |
| Push notifications iOS-PWA (VAPID, sw custom, table `push_subscriptions`) | 1-2 jours | V1.5 / V2 |
| Export PDF récap pour pédiatre (`react-pdf`) | 1 jour | V1.5 |
| Compléter le harness eval à 20 cas (10 ajoutés, 10 manquants) | ½ jour | Avant beta |
| Logout + page settings | ½ jour | Avant beta |
| Vérifier domaine dans Resend + changer sender | ½ jour | Avant beta externe |
| Upgrade Vercel Pro + restaurer cron horaire timezone-aware | — (paid) | Avant beta multi-tz |
| RGPD : DPA Supabase + chiffrement des `note` | 1 jour | Avant beta externe |
