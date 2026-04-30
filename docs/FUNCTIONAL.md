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
  - [Logger une tétée](#logger-une-tétée)
  - [Le matin](#le-matin)
- [Features](#features)
  - [Feature 1 — Log ultra-rapide](#feature-1--log-ultra-rapide)
  - [Feature 2 — Check-in du matin](#feature-2--check-in-du-matin)
  - [Mode nuit auto](#mode-nuit-auto)
  - [Authentification](#authentification)
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
3. Saisit son email → reçoit un magic link.
4. Tap sur le lien dans l'email → revient sur `/auth/callback` → home authentifié.
5. (Sur iPhone Safari) il peut **Ajouter à l'écran d'accueil** pour avoir Latch comme une app installée.

### Logger une tétée

À tout moment de la journée ou de la nuit :

1. Ouvre l'app → écran d'accueil. Un seul gros bouton **Démarrer tétée**.
2. Au-dessus du bouton, un texte indique le **côté suggéré** (gauche/droit), alterné automatiquement par rapport à la dernière tétée. Bouton « changer » pour forcer l'autre côté.
3. Tape le bouton → écran timer plein écran. Affiche le côté + le chrono. Un seul gros bouton **Stop**.
4. Tape Stop → écran ressenti :
   - 3 emojis 😊 / 😐 / 😣 (optionnel)
   - Champ texte libre (optionnel)
   - Bouton **Sauvegarder** ou **Skip**
5. Retour à l'accueil. Le côté suggéré a alterné.

La tétée est sauvegardée localement dans le navigateur (IndexedDB, Dexie). Quand l'app est connectée et l'utilisateur authentifié, elle est synchronisée vers Supabase en arrière-plan.

### Le matin

Chaque jour à 9h heure locale, un cron côté serveur :

1. Récupère les tétées des dernières 24h et les moyennes des 7 derniers jours.
2. Appelle Claude (Sonnet 4.5) avec un prompt très contraint (voir `lib/prompts.ts`).
3. Stocke un message court (2–3 phrases) dans la table `morning_checkins`.

Quand l'utilisateur ouvre l'app le matin, une **carte en haut de l'écran d'accueil** affiche ce message. Sous la carte, un disclaimer permanent rappelle que ces messages ne remplacent pas l'avis d'un professionnel de santé. Bouton **Lu** pour la masquer.

> Les push notifications ne sont **pas activées en V1**. L'utilisateur découvre la carte en ouvrant l'app le matin (ce qu'il fait de toute façon pour logger une tétée).

## Features

### Feature 1 — Log ultra-rapide

**Critère de réussite** : logger une tétée en **1 seul appui**, **moins de 3 secondes**, **sans regarder l'écran**.

Specs :

- Bouton de démarrage qui occupe ≥ 70 % de l'écran d'accueil
- Côté pré-sélectionné (alterne avec la dernière tétée)
- Pendant la tétée : écran sombre, gros chrono, un seul bouton Stop
- Champ ressenti optionnel après Stop, skipable
- Fonctionne **offline** : la tétée est sauvegardée localement et synchronisée plus tard

### Feature 2 — Check-in du matin

**Critère de réussite** : chaque matin à 9h, **une carte de 3 lignes max**, écrite comme un humain, qui contextualise la nuit.

Specs :

- Génération automatique côté serveur via cron Vercel
- Texte produit par Claude, ton chaleureux mais sobre, jamais alarmiste, jamais médical
- Bouton **C'est normal ?** au pied de la carte (V2 — voir [TECHNICAL.md → Roadmap](./TECHNICAL.md#roadmap-restante))
- Disclaimer permanent : *« Ces messages ne remplacent pas l'avis d'un professionnel de santé. »*

Le prompt et les règles de comportement attendu sont versionnés dans `lib/prompts.ts` et testés par un harness d'évaluation (`scripts/evals.ts`).

### Mode nuit auto

Entre **21h et 7h** (heure locale du device), l'app passe automatiquement en mode nuit :

- Fond noir partout
- Texte rouge sombre `#8B0000` (pas de blanc qui éblouit à 3h du matin)
- Boutons en outline rouge sombre, pas de remplissage clair

Aucune action utilisateur requise. Le hook `useNightMode` recalcule l'heure toutes les minutes et au retour de l'app au premier plan.

### Authentification

- **Magic link uniquement** (pas de mot de passe en V1)
- Email envoyé via le SMTP par défaut de Supabase (limité à ~4 emails/h en free tier — suffisant pour usage perso)
- Session persistante via cookies HTTP-only (gérés par `@supabase/ssr`)
- Le middleware redirige vers `/login` toute requête non authentifiée

Pas de logout V1 — c'est un compromis assumé pour la simplicité de l'usage perso. Pour se déconnecter : effacer les cookies du navigateur.

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
- Onboarding multi-étapes
- Compte multi-utilisateurs / partage temps réel co-parent
- Mot de passe (magic link uniquement)
- App native iOS / Android (PWA pour MVP)
- Intégration boutons volume physiques
- Push notifications (reportées V2 — voir [TECHNICAL.md → Roadmap](./TECHNICAL.md#roadmap-restante))

## Disclaimer

Latch n'est **pas un dispositif médical**. Les messages générés par l'IA sont indicatifs et ne remplacent en aucun cas l'avis d'une sage-femme, d'un pédiatre, d'un médecin ou d'une consultante en lactation. En cas de doute sur la santé du bébé ou du parent, consulter un professionnel.
