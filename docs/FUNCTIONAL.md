# Latch — Documentation fonctionnelle

> Ce que fait l'app, pour qui, et comment on mesure que ça marche.
> Pour les détails de code et déploiement, voir [`TECHNICAL.md`](./TECHNICAL.md).

## Sommaire

- [Vue d'ensemble](#vue-densemble)
- [Pour qui](#pour-qui)
- [Promesse](#promesse)
- [Critères de succès](#critères-de-succès)
- [Parcours utilisateur](#parcours-utilisateur)
  - [Premier lancement](#premier-lancement)
  - [Onboarding (1ère connexion)](#onboarding-1ère-connexion)
  - [Logger une tétée](#logger-une-tétée)
  - [Le matin](#le-matin)
  - [Consulter et modifier l'historique](#consulter-et-modifier-lhistorique)
  - [Modifier son profil](#modifier-son-profil)
- [Features](#features)
  - [Feature 1 — Log ultra-rapide](#feature-1--log-ultra-rapide)
  - [Feature 2 — Check-in du matin](#feature-2--check-in-du-matin)
  - [Onboarding 7 étapes](#onboarding-7-étapes)
  - [Historique éditable](#historique-éditable)
  - [Mode nuit auto](#mode-nuit-auto)
  - [Authentification](#authentification)
- [Charte graphique](#charte-graphique)
- [Hors scope V1](#hors-scope-v1)
- [Disclaimer](#disclaimer)

## Vue d'ensemble

Latch est une PWA qui permet à un parent qui allaite de logger ses tétées en moins de 3 secondes et de recevoir chaque matin un message contextualisé sur les dernières 24h.

L'app est conçue pour **remplacer Apple Notes** (le vrai concurrent), pas Huckleberry ou les autres apps de tracking. Elle ne fait que deux choses, mais elle les fait excellemment.

## Pour qui

- Parent qui allaite, premier ou deuxième enfant, 0–9 mois post-partum
- Sur smartphone (iPhone ou Android), à l'aise avec les apps de productivité (Notes, Notion)
- N'utilise pas d'app de tracking parce que toutes lui ont semblé pires que rien

**Hors cible MVP** : parent qui biberonne uniquement, parent qui veut tout suivre (sommeil, couches, poids), parent en quête de communauté ou de conseils.

## Promesse

> *L'app d'allaitement qui remplace ton bloc-notes papier — pas Huckleberry. Aussi rapide à logger qu'une note manuscrite, mais qui te dit chaque matin si tout va bien.*

## Critères de succès

**Validation perso (V1)** — sur 14 jours d'usage par le créateur :

- [ ] 100 % des tétées loggées via l'app
- [ ] Moyenne &lt; 5 secondes par log
- [ ] Le check-in du matin rassure ou fait sourire ≥ 5 matins / 14
- [ ] Pas d'envie de revenir à Notes après 14 jours

**Validation externe (V2, dans 2-3 mois)** — sur 5 testeurs beta :

- [ ] 4/5 utilisent l'app ≥ 5 jours sur 7 après 2 semaines
- [ ] 4/5 disent qu'ils paieraient (4–7 €/mois hypothèse)
- [ ] NPS ≥ 40

Si une ligne de la validation perso est rouge à J14, on repense le produit avant tout élargissement.

## Parcours utilisateur

### Premier lancement

1. L'utilisateur ouvre l'URL de l'app (depuis Vercel ou domaine custom).
2. Redirigé vers `/login` (pas de session).
3. Saisit son email → reçoit un email Latch contenant **un code à 6 chiffres** et un lien magique.
4. Deux options pour s'authentifier :
   - **Code 6 chiffres** : tape les 6 chiffres directement dans l'app (plus rapide, recommandé sur mobile)
   - **Magic link** : clique le lien dans l'email → revient sur `/auth/callback` → home authentifié
5. À sa première session, l'utilisateur est automatiquement redirigé vers `/onboarding` (voir section suivante) avant de pouvoir accéder à l'accueil.
6. (Sur iPhone Safari) il peut **Ajouter à l'écran d'accueil** pour avoir Latch comme une app installée.

### Onboarding (1ère connexion)

7 étapes courtes, une question par écran, transition simple, barre de progression « Étape X sur 7 » en haut. À chaque étape, la progression est sauvegardée côté serveur (`user_onboarding_progress`) — si l'utilisateur ferme l'onglet à l'étape 4, il reprend à l'étape 4 avec ses données pré-remplies.

| Étape | Question | Champ profil |
|---|---|---|
| 1 | Quand est né bébé ? (date) | `baby_birth_date` |
| 2 | C'est ton premier enfant ? | `is_first_child` |
| 3 | Comment se passe l'allaitement aujourd'hui ? (Exclusif / Mixte) | `feeding_type` |
| 4 | Tu allaites depuis quand ? (date, pré-remplie avec date de naissance) | `breastfeeding_start_date` |
| 5 | Comment décrirais-tu le rythme des tétées ? (5 options qualitatives) | `current_rhythm` |
| 6 | As-tu un suivi par sage-femme ou conseillère en lactation ? (oui/non) | `has_professional_support` |
| 7 | Quelque chose à partager ? (préoccupation, ressenti, prénom bébé — tous optionnels) | `current_concern`, `general_feeling`, `baby_name` |

Étapes 1–5 obligatoires. Étapes 6–7 optionnelles (bouton « Passer » discret). Au tap final « Terminer », le profil est validé (`onboarded_at = now()`) et la ligne de progression supprimée. Redirection vers `/`.

Tant que `onboarded_at` est `NULL`, le middleware redirige toute requête authentifiée vers `/onboarding`. Une fois onboardé, accéder à `/onboarding` redirige vers `/` (modification = passer par `/settings`).

### Logger une tétée

À tout moment de la journée ou de la nuit :

1. Ouvre l'app → écran d'accueil. Un **bouton circulaire central** « Démarrer » (240 px de diamètre).
2. Au-dessus du bouton, **deux boutons GAUCHE / DROIT côte à côte**. Le côté suggéré (alterné depuis la dernière tétée) est en saumon plein ; l'autre en outline. Tap = sélection instantanée, pas de confirmation.
3. Tape Démarrer → écran timer plein écran. Affiche le côté + le chrono. Un seul **bouton circulaire Stop** (140 px).
4. Tape Stop → écran ressenti :
   - 3 emojis 😊 / 😐 / 😣 (optionnel)
   - Champ texte libre « Une note pour toi-même… » (optionnel)
   - Boutons **Sauvegarder** ou **Skip**
5. Retour à l'accueil. Le côté suggéré a alterné.

La tétée est sauvegardée localement dans le navigateur (IndexedDB, Dexie). Quand l'app est connectée et l'utilisateur authentifié, elle est synchronisée vers Supabase en arrière-plan.

### Le matin

Chaque jour vers **9-10h heure de Paris** (cron à 8h UTC), un job côté serveur :

1. Récupère les tétées des dernières 24h et les moyennes des 7 derniers jours pour chaque utilisateur **onboardé**.
2. Appelle Claude (Sonnet 4.5) avec un prompt **enrichi du profil utilisateur** (voir `lib/prompts.ts → buildMorningCheckinSystem`) : prénom du bébé, âge formaté en français, premier enfant ou non, type d'allaitement, durée de l'allaitement, rythme déclaré, suivi pro, préoccupation et ressenti. Le prompt adapte le ton (plus rassurant pour un premier enfant, plus direct si suivi pro, etc.).
3. Stocke un message court (2-3 phrases, max 50 mots) dans la table `morning_checkins`.

Quand l'utilisateur ouvre l'app le matin, une **carte en haut de l'écran d'accueil** affiche ce message. Sous la carte, un disclaimer permanent rappelle que ces messages ne remplacent pas l'avis d'un professionnel de santé.

Bouton **Lu** → la carte se replie en une **bande compacte** d'une ligne `✓ Check-in du matin lu` avec un chevron pour rouvrir. L'état replié est persisté en `localStorage` avec la date du jour comme clé, donc survit au refresh. Le lendemain matin, un nouveau check-in s'affiche déplié.

> Les push notifications ne sont **pas activées en V1**. L'utilisateur découvre la carte en ouvrant l'app le matin (ce qu'il fait de toute façon pour logger une tétée).

### Consulter et modifier l'historique

Icône **liste en haut à gauche** de l'accueil → page `/historique`.

- Liste antéchronologique des tétées, groupées par jour (`Aujourd'hui`, `Hier`, `Mardi 28 avril`…) avec le compte à droite (`6 tétées` / `1 tétée`).
- Chaque ligne : heure de début, indicateur visuel du côté (●● avec saumon = côté actif, atténué = inactif, les 2 = `both`), texte du côté, durée, mood emoji.
- Pagination 30 par 30, bouton « Charger plus » en bas.
- Tap sur une ligne → **bottom sheet** d'édition : pickers datetime début / fin (fin optionnelle), 3 boutons côté (Gauche / Droit / Les deux), 4 boutons ressenti (😊 😐 😣 + Aucun), note (max 200 chars), bouton Enregistrer + bouton Supprimer (rouge sobre, confirmation native).
- **FAB `+` en bas à droite** → même bottom sheet en mode ajout, pré-rempli avec début = il y a 30 min, fin = maintenant. L'utilisateur doit choisir un côté.
- Mutations optimistes : suppression et modification se reflètent instantanément, rollback en cas d'erreur réseau.
- Mode hors-ligne : bandeau « Hors ligne — historique limité aux tétées en attente de sync » + édition désactivée (lecture seule du cache Dexie).

### Modifier son profil

Icône **engrenage en haut à droite** de l'accueil → page `/settings`.

- Formulaire scrollable reprenant tous les champs de l'onboarding, pré-remplis.
- Bouton « Enregistrer » en bas (sticky), validation client (champs obligatoires, longueurs, dates pas dans le futur).
- Section « Avancé » en bas avec un bouton rouge sobre **« Recommencer l'onboarding »** : confirme via `window.confirm`, efface les champs collectés en onboarding (`onboarded_at`, type allaitement, rythme, etc.) en gardant `baby_name` et `baby_birth_date`, puis redirige vers `/onboarding`.

## Features

### Feature 1 — Log ultra-rapide

**Critère de réussite** : logger une tétée en **1 seul appui**, **moins de 3 secondes**, **sans regarder l'écran**.

Specs :

- Bouton circulaire central (240 px) — visible et atteignable au pouce, **taille jamais réduite** quel que soit l'état de la carte check-in
- Deux boutons GAUCHE / DROIT au-dessus, sélection instantanée (côté suggéré pré-actif)
- Pendant la tétée : fond sombre/clair selon l'heure, gros chrono, un seul bouton Stop circulaire
- Champ ressenti optionnel après Stop, skipable
- Fonctionne **offline** : la tétée est sauvegardée localement et synchronisée plus tard

### Feature 2 — Check-in du matin

**Critère de réussite** : chaque matin, **une carte de 2-3 phrases courtes (max 50 mots)**, écrite comme un humain qui te connaît, qui contextualise la nuit.

Specs :

- Génération automatique côté serveur via cron Vercel (1 firing/jour à 8h UTC ≈ 9-10h Paris), uniquement pour les utilisateurs **onboardés**
- Texte produit par Claude (Sonnet 4.5), ton chaleureux mais sobre, jamais alarmiste, jamais médical
- **Prompt enrichi du profil** : adapte le ton selon premier enfant / suivi pro / âge bébé / rythme déclaré / préoccupation enregistrée à l'inscription
- Disclaimer permanent : *« Ces messages ne remplacent pas l'avis d'un professionnel de santé. »*
- Bouton **Lu** → carte se replie en bande compacte une ligne, état persisté en localStorage, auto-réaffichage le lendemain
- Hauteur de la carte capée (`max-h-36`) avec scroll interne pour ne jamais pousser le bouton Démarrer hors viewport
- Bouton **C'est normal ?** au pied de la carte (V2 — voir [TECHNICAL.md → Roadmap](./TECHNICAL.md#roadmap-restante))

Le prompt et les règles de comportement attendu sont versionnés dans `lib/prompts.ts` (`buildMorningCheckinSystem(profile)`) et testés par un harness d'évaluation (`scripts/evals.ts`).

### Onboarding 7 étapes

**Critère de réussite** : nouvel utilisateur arrive sur l'accueil avec un profil complet, sans frustration, en moins de 90 secondes.

Specs :

- 7 étapes courtes, une question par écran, barre de progression `Étape X sur 7`
- Validation par étape, boutons Précédent / Suivant toujours visibles en bas
- Reprise après abandon : progression sauvegardée à chaque transition (`user_onboarding_progress`), restaurée au retour
- Étapes 1-5 obligatoires (date naissance bébé, premier enfant, type allaitement, début allaitement, rythme), étapes 6-7 optionnelles (suivi pro, ressentis libres + prénom bébé)
- Validation finale : tous les champs obligatoires présents → `onboarded_at = now()` → redirection `/`
- Middleware gate : tant que `onboarded_at` IS NULL, toute requête authentifiée hors `/onboarding` et `/auth/*` → redirection `/onboarding`

### Historique éditable

**Critère de réussite** : retrouver, corriger, ou ajouter une tétée passée en moins de 10 secondes.

Specs :

- Page `/historique` accessible via icône liste en haut à gauche de l'accueil
- Liste antéchronologique groupée par jour, libellés en français (`Aujourd'hui`, `Hier`, `Mardi 28 avril`)
- En-tête de jour avec compte de tétées à droite (`6 tétées` / `1 tétée` / `Aucune tétée`)
- Ligne : heure, indicateur visuel du côté (deux points filled/faded), texte côté, durée, mood emoji
- Pagination 30 par 30, bouton « Charger plus »
- Édition via bottom sheet : pickers datetime, 3 côtés, 4 ressentis, note 200 chars, bouton Supprimer rouge sobre avec confirmation native
- Ajout via FAB `+` en bas à droite, même bottom sheet en mode vide
- Mutations optimistes (UI mise à jour avant confirmation serveur, rollback sur erreur)
- Mode offline : lecture seule du cache local (Dexie), édition désactivée, bandeau d'info

### Mode nuit auto

Entre **21h et 7h** (heure locale du device), l'app bascule automatiquement en mode nuit :

- Fond **espresso chaud** `#1a1410` (pas noir pur — moins agressif sur l'œil dilaté à 3h du mat)
- Texte **crème doux** `#d4b896` (pas blanc, pas rouge militaire — chaleureux et lisible)
- Accent **caramel** `#c89878` pour les boutons d'action
- Boutons circulaires en outline, pas de remplissage clair qui éblouit

Aucune action utilisateur requise. Le hook `useNightMode` recalcule l'heure toutes les minutes et au retour de l'app au premier plan.

### Authentification

Deux flux disponibles dans le même email :

- **Code OTP 6 chiffres** : copie-colle ou tape directement dans l'app, en 2 étapes (email → code). Recommandé sur mobile car évite le switch d'app.
- **Magic link** : clique le lien dans l'email → revient sur `/auth/callback` → home authentifié.

Email envoyé via **Resend** (3000 emails/mois free tier). Template personnalisé qui met en avant le code 6 chiffres en gros et le lien en dessous.

Session persistante via cookies HTTP-only (gérés par `@supabase/ssr`). Le middleware redirige vers `/login` toute requête non authentifiée.

Pas de logout dans l'UI V1 — assumé pour la simplicité de l'usage perso. Pour se déconnecter : effacer les cookies du navigateur.

## Charte graphique

Esthétique **intimiste, calme, feutrée** — pensée pour des yeux fatigués à 3h du matin et des soirées tranquilles avec bébé. Pas une app de productivité.

**Mode jour** :
- Fond crème `#f7f2e9` (linen, pas blanc clinique)
- Texte brun chaud `#2c241e`
- Accent terracotta `#b07050` (boutons, liens d'action)

**Mode nuit (21h-7h)** :
- Fond espresso `#1a1410`
- Texte crème doux `#d4b896`
- Accent caramel `#c89878`

**Typographie** :
- Geist Sans (chargée localement) pour tout le texte
- Geist Mono pour les chiffres du timer (alignement tabulaire)
- Wordmark Latch en `tracking-[0.32em]` uppercase — éditorial, pas tech-y
- Generous letter-spacing sur les libellés UI (`GAUCHE`, `BONJOUR`, `DIMANCHE 3 MAI`, `AUJOURD'HUI`) pour l'élégance

**Formes** :
- Bouton principal de démarrage : **cercle 240 px**, outline 2 px, texte centré
- Bouton Stop : cercle 140 px, même style
- Cards (check-in matin, ressenti) : `rounded-3xl`
- CTAs secondaires : `rounded-full`
- Inputs : `rounded-3xl`

**Animations** :
- Aucune. Tout en `transition-colors` discret. Pas de pulse, pas de spinner décoratif.

## Hors scope V1

Liste explicitement bannie pour résister au scope creep :

- Suivi sommeil bébé
- Suivi couches
- Suivi poids / taille / courbes de croissance
- Tirage / stockage du lait maternel
- Sevrage
- Forum communauté / messagerie
- Notifications de rappel « il est temps d'allaiter »
- Gamification, badges, streaks
- Compte multi-utilisateurs / partage temps réel co-parent
- Mot de passe (magic link / OTP uniquement)
- App native iOS / Android (PWA pour MVP)
- Intégration boutons volume physiques
- Push notifications (reportées V2 — voir [TECHNICAL.md → Roadmap](./TECHNICAL.md#roadmap-restante))

## Disclaimer

Latch n'est **pas un dispositif médical**. Les messages générés par l'IA sont indicatifs et ne remplacent en aucun cas l'avis d'une sage-femme, d'un pédiatre, d'un médecin ou d'une consultante en lactation. En cas de doute sur la santé du bébé ou du parent, consulter un professionnel.
