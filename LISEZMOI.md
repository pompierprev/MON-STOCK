# Gestion – Comptes et stock (version Netlify)

Même site que la version serveur (comptes, stock, export Excel, impression),
adapté à Netlify : la page est dans `public/`, le serveur est une fonction
(`netlify/functions/api.mjs`) et les données sont dans Netlify Blobs.

## ATTENTION : publier ici REMPLACE l'ancien contenu du site
Si vous publiez sur oreeduparcsimandres.netlify.app, l'enquête de satisfaction
disparaît. Gardez-en une copie avant, ou créez un nouveau site Netlify.

## Publier (méthode conseillée : ligne de commande)

1. Installez Node.js (https://nodejs.org), puis dans un terminal :
   npm install -g netlify-cli
2. Dans ce dossier :
   npm install
   netlify login
   netlify link        (choisissez le site existant, ou "netlify init" pour un nouveau)
3. Publiez :
   netlify deploy --prod

Le glisser-déposer du dossier dans l'interface Netlify n'est pas conseillé :
la fonction a besoin que ses dépendances soient installées.

## Changer le code administrateur

Netlify > Site configuration > Environment variables > ajouter ADMIN_CODE
(valeur de votre choix), puis republier. Sans cette variable, le code par défaut
est 0102Pnosi. Changer le code déconnecte les sessions ouvertes.

## Données

Stockées dans Netlify Blobs (Netlify > Blobs), partagées entre tous vos appareils.
Utilisez « Tout exporter (Excel) » pour garder une sauvegarde.

## Sécurité

- Connexion par code, session de 12 h, blocage 15 min après 5 erreurs.
- Netlify fournit le HTTPS automatiquement.

## Mettre à jour le site avec GitHub (sans terminal)

1. Décompressez la nouvelle archive.
2. Sur github.com, ouvrez votre dépôt, cliquez sur « Add file » puis « Upload files ».
3. Glissez tout le contenu du dossier décompressé (les deux dossiers netlify et public,
   et les fichiers netlify.toml, package.json, LISEZMOI.md) : les fichiers de même nom sont remplacés.
4. Cliquez sur « Commit changes ». Netlify republie tout seul en 1 à 2 minutes.

## Règles du stock et des courses

- Stock : 4 familles fixes (Hygiène, Entretien, Alimentation, Boisson). Garage à gauche, maison à droite.
  Garage − : retire du garage et ajoute à la maison. Garage + : garage seulement.
  Maison + et − : maison seulement.
- Courses : FRESH (liste simple) et LECLERC (Hygiène, Entretien, Alimentation, Boisson).
- Ajout automatique aux courses : quand il ne reste qu'un exemplaire d'un produit au garage,
  il est ajouté à la liste LECLERC de la même famille (sans doublon). À zéro, rien n'est ajouté.
- Menus : deux semaines (dates « du … au … »), un menu par jour du lundi au dimanche,
  bouton « Effacer les menus » pour chaque semaine (les dates sont conservées).
