# École — Gestion des Points Scolaires

Application web sécurisée pour la gestion des points des élèves, réservée aux **enseignants** et à la **surveillance générale**.

## Fonctionnalités

- **Authentification** : mots de passe chiffrés (bcrypt), JWT
- **Gestion des points** : score initial de 100 points, ajustements avec description
- **Import élèves** : Excel, Word ou PDF depuis l’administration
- **Surveillance** : élèves, classes, comptes, journaux

## Installation locale

```bash
npm install
cp .env.example .env
npm run init-db
npm start
```

Ouvrez **http://localhost:3000**.

Sans `TURSO_DATABASE_URL`, la base locale `data/ecole.db` (libSQL) est utilisée.

### Comptes de démonstration

| Rôle         | Utilisateur   | Mot de passe        |
|--------------|---------------|---------------------|
| Enseignant   | prof.martin   | Enseignant123!      |
| Enseignant   | prof.dubois   | Enseignant123!      |
| Surveillance | surveillance  | Surveillance123!    |

## Déploiement sur Vercel

Vercel est **serverless** : le fichier SQLite local ne convient pas. Il faut une base **Turso** (SQLite hébergé).

### 1. Créer la base Turso

1. Compte sur [turso.tech](https://turso.tech)
2. Créer une base, récupérer l’URL et un token :

```bash
turso db create ecole
turso db show ecole --url
turso db tokens create ecole
```

### 2. Initialiser le schéma et les comptes

En local, pointez temporairement vers Turso puis lancez :

```bash
# dans .env
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
JWT_SECRET=un-secret-long-et-aleatoire

npm run init-db
```

### 3. Variables d’environnement Vercel

Dans le projet Vercel → **Settings → Environment Variables** :

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `JWT_SECRET` | oui | Secret JWT (différent du dev) |
| `TURSO_DATABASE_URL` | oui | URL Turso `libsql://...` |
| `TURSO_AUTH_TOKEN` | oui | Token Turso |
| `BLOB_READ_WRITE_TOKEN` | recommandé | Photos élèves via [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) |

### 4. Déployer

```bash
npx vercel
```

Ou connectez le dépôt GitHub à Vercel (Root Directory = racine du projet).

Le point d’entrée est `api/index.js` (Express exporté pour le runtime Node de Vercel).

## Rôles

- **Enseignant** : consulter les élèves, modifier les points
- **Surveillance** : toutes les permissions + gestion des élèves, comptes, import, journaux

## Sécurité

- Mots de passe bcrypt (12 rounds)
- JWT (8 h)
- Rate limiting sur la connexion
- Les élèves n’ont **aucun accès** à l’application
