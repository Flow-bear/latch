# Latch — Instructions Claude

## Workflow obligatoire avant déploiement

**Toute modification touchant l'UI rendue (`app/**/*.tsx`, `app/globals.css`, `tailwind.config.ts`) doit suivre ce cycle, à chaque fois, sans exception :**

1. Modifier le code.
2. `npm run build` — vérifier que TS et Next compilent sans erreur.
3. `node scripts/visual-preview.mjs` — produit 7 PNGs dans `scripts/test-screens/preview-*.png`.
4. **Présenter les screenshots concernés** au user (au moins les états directement modifiés, en day + night quand pertinent).
5. **Attendre la validation visuelle explicite** ("ok", "valide", "go", etc.) avant tout `git push`.
6. Si validé : commit + push sur `main` (déploie automatiquement sur Vercel prod).
7. Si rejet ou demande de retouche : itérer, refaire screenshots, re-présenter. Pas de push entre temps.

**Ce qui peut être fait en autonomie complète, sans demander :**
- Édition de fichiers, refactor, ajout de tests, lecture de doc, débogage local.
- `npm run build`, `npm run dev`, `node scripts/*.mjs`.
- `git add`, `git commit` (sans push).
- Création/exécution de scripts de test, screenshots, exploration du repo.

**Ce qui demande toujours validation user, même en mode bypass :**
- `git push origin main` (= déploiement prod).
- Toute opération `git` destructive : `reset --hard`, `push --force`, suppression de branche, amend de commit déjà poussé.
- `--no-verify`, `--force` sur un push.
- Modification du schéma Supabase, migration de DB, opérations sur la DB de prod.
- Suppression de fichiers committés ou de larges portions de code sans rapport avec la tâche.

## Discipline produit

Latch est un MVP solo, scope strict, propriétaire = utilisatrice actuelle (allaitement en cours). Les features explicitement out-of-scope dans `docs/FUNCTIONAL.md` ne reviennent pas par la petite porte. En cas de doute sur un changement qui élargit la portée, demander avant d'implémenter.

## Outillage de test visuel

- Script : `scripts/visual-preview.mjs`
- Doc complète : `docs/TECHNICAL.md` § Tests E2E (workflow + gotchas Windows : zombie `next start`, cache `next-pwa`)
- Pré-requis : `.env.local` présent (contient `SUPABASE_SERVICE_ROLE_KEY` pour minter une session OTP)
- Output : `scripts/test-screens/preview-*.png` (day/night × open/collapsed/no-checkin + day/night login)
