# École — Gestion des Points Scolaires

Application web sécurisée pour la gestion des points des élèves, réservée aux **enseignants** et à la **surveillance générale**.

## Fonctionnalités

- **Authentification** : mots de passe chiffrés (bcrypt), connexion directe
- **Affichage du mot de passe** : bouton œil sur les champs de mot de passe
- **Gestion des points** : score initial de 100 points, ajustements avec description obligatoire
- **Historique complet** : chaque modification enregistre l'auteur et le motif
- **Surveillance** : ajouter, modifier ou supprimer des élèves et des comptes enseignants
- **Interface moderne** : boutons rapides (+1, +5, +10, −1, −5, −10) pour ajuster les points

## Installation

```bash
cd ecole
npm install
npm run init-db
npm start
```

Ouvrez **http://localhost:3000** dans votre navigateur.

## Comptes de démonstration

| Rôle         | Utilisateur   | Mot de passe        |
|--------------|---------------|---------------------|
| Enseignant   | prof.martin   | Enseignant123!      |
| Enseignant   | prof.dubois   | Enseignant123!      |
| Surveillance | surveillance  | Surveillance123!    |

## Rôles

- **Enseignant** : consulter les élèves, modifier les points
- **Surveillance** : toutes les permissions enseignant + gestion des élèves et des comptes enseignants + journal complet

## Sécurité

- Chiffrement des mots de passe (bcrypt, 12 rounds)
- Authentification JWT avec expiration (8h)
- Limitation des tentatives de connexion (rate limiting)
- Les élèves n'ont **aucun accès** à l'application
