# PokéRadar

Carnet de veille Pokémon JCC pour iPhone et ordinateur. Le dossier `app/` contient la PWA autonome. Le dossier `legacy/v04/` contient le bot, le tableau de bord, le portail mobile et les tests de l’archive v0.4 récupérée dans la bibliothèque ChatGPT. `tools/import_v04.py` relie la base historique au carnet web.

## Ouvrir sur ordinateur

Avec Node.js 20 ou plus récent, ouvre ce dossier dans Codex et lance `npm start`. Ouvre ensuite `http://localhost:4173/` dans ton navigateur. Aucune dépendance à installer.

## Installer sur iPhone

1. Publie le contenu du dossier `app/` sur un hébergeur statique HTTPS. Le serveur doit servir les fichiers `.mjs` comme JavaScript et laisser `sw.js` accessible dans le même dossier que `index.html`.
2. Ouvre l’adresse HTTPS dans Safari, touche **Partager**, puis **Sur l’écran d’accueil**. Active **Ouvrir comme app web** si l’option s’affiche.
3. Importe ton carnet depuis **Mes données** si tu avais déjà effectué des relevés sur un autre appareil.

Le premier chargement prépare l’accès hors ligne. Les pages marchandes et les sources externes nécessitent Internet. À chaque publication qui modifie les fichiers de l’interface mis en cache, incrémente la version `CACHE` dans `app/sw.js`. Recharge la page si une ancienne version est encore visible.

## Actualiser la veille publique

Le tableau **Boutiques → Offres 30 ans** lit `app/veille.json` à l’ouverture, au retour dans l’app, toutes les cinq minutes lorsqu’elle est visible et via **Actualiser**. En cas d’erreur, il conserve la dernière version valide chargée sur cet appareil. Les disponibilités et invitations datées à l’heure sont marquées **À revérifier** après six heures. Les relevés dont seule la journée est connue s’affichent directement avec cette mention.

Pour publier un nouveau relevé, mets à jour les offres dans `veille.json` après lecture de la fiche du vendeur. Garde les identifiants stables. Renseigne `observedAt` en UTC, `price` en euros hors port et `status` parmi `available`, `invitation`, `unavailable` et `unknown`. Les mises à jour de tirages et de sorties s’ajoutent à `campaigns` et `releases` avec les identifiants du catalogue pour remplacer une entrée existante. Les prix, stocks et tirages personnels restent dans le carnet de l’appareil.

Le bouton recharge le dernier relevé publié. Le projet a encore besoin d’une source ou d’un collecteur pour vérifier les boutiques et écrire de nouvelles observations sans intervention. Les règles de stock lisent les observations publiques récentes et les relevés personnels. Les règles de prix utilisent les offres de ton carnet dont le prix livré est connu.

## Collecteur automatique (`collector/`)

Il relit chaque fiche de `app/veille.json`, met à jour statut, prix et retraits, puis publie le fichier d'un seul coup après validation.

- `npm run collect` : un passage. `npm run collect:dry` : essai à blanc, rien n'est publié. `npm run collect:watch` : un passage toutes les ~15 min.
- `npm run add -- https://… [--product "Nom"]` : suit une nouvelle fiche (lit la page, détecte le site, ajoute l'entrée).
- Sites lus : Amazon.fr (invitation, vendu par Amazon), Le Coin des Barons, UltraJeux (avec les magasins en retrait), Variantes, Za Warudo, et tout site qui publie des données produit JSON-LD. Fnac, Cultura et Smyths refusent les robots (HTTP 403) : ils ne sont pas lus et ne sont jamais présentés comme vérifiés.
- Fiabilité : une fiche n'est marquée « rupture » que si la page l'affiche explicitement. Si le contrôle échoue (refus, délai, page ambiguë, contradiction), l'ancienne observation et sa date sont conservées et l'appli la marque « À revérifier ». Une vague de ruptures sur un site entier est traitée comme une page cassée et ignorée. Délai de politesse entre deux requêtes d'un même site, pause d'un site après deux refus, un seul collecteur à la fois (verrou).
- Journal : `collector/logs/AAAA-MM-JJ.jsonl`, une ligne JSON par contrôle, événement et passage (30 jours conservés). Santé par site : `app/sante.json`. Historique des réassorts, ruptures, changements de prix et nouveaux retraits : `app/evenements.json`. Les deux s'affichent dans **Boutiques → Offres 30 ans**.
- Tests : `npm test` couvre chaque lecteur de page, les règles de conservation et le garde-fou.

## Reprendre les données v0.4

- **Portail mobile.** Sur le navigateur où tu avais saisi tes stocks, ouvre le portail d’origine et choisis **Mes disponibilités → Exporter JSON**. Importe ce fichier dans **Mes données**. Si l’ancien portail et la nouvelle app partagent la même origine web, la reprise se fait automatiquement au premier lancement. Les données du portail restent intactes.
- **Bot Mac.** L’archive récupérée contient le code et les tests, sans base utilisateur. Si une base existe ailleurs, lance `python tools/import_v04.py CHEMIN/Vers/pokeradar.db pokeradar-sauvegarde-v04.json` puis importe le fichier créé dans **Mes données**. Le script lit la base en lecture seule et récupère les vérifications, cotations, offres en ligne, ventes, participations, tirages personnalisés et annonces du calendrier. La base d’origine reste l’archive de la configuration des scans, des métadonnées et des journaux d’envoi.
- **Entre appareils.** L’export JSON regroupe stocks, prix, règles, tirages suivis et calendrier importé. L’import fusionne par identifiant et s’interrompt si deux entrées de même identifiant diffèrent. Le stockage reste propre au navigateur et à l’adresse web. Pense à exporter avant un changement d’adresse ou de navigateur.

## Surveillance v0.4

Le moteur et le tableau de bord d’origine restent dans `legacy/v04/`. Leur [guide](legacy/v04/README.md) couvre les scans HTML configurés, l’analyse des réassorts et les canaux Discord/Telegram. Sous Windows, ajoute `tzdata` aux dépendances du bot Python pour le fuseau Europe/Paris.

La PWA fonctionne de façon autonome avec son carnet local. Le bot peut exporter ses relevés vers ce carnet avec le pont SQLite. Les scans ont besoin de pages compatibles configurées. Les alertes du bot ont besoin d’un canal configuré. L’accès Pokéindex utilise une clé et des crédits selon les réglages du bot. Le déploiement du dossier `app/` sert l’interface et son catalogue, sans exécuter le bot en arrière-plan.

## Lire les données

- **Marché.** Les relevés portent une date, un type de prix et un lien. La médiane utilise les ventes réalisées saisies, hors livraison. Le meilleur prix utilise les offres relevées avec livraison connue. Les deux indicateurs apparaissent quand les résultats concernent une seule référence. La simulation calcule le gain après frais saisis et le prix de revente à l’équilibre.
- **Stocks.** Les vérifications sont manuelles et datées. Après 24 heures, une disponibilité signalée passe à « Relevé à actualiser ». La recherche géographique ouvre une carte des magasins autour de la ville choisie.
- **Tirages.** Les campagnes datées passent dans les archives après leur échéance. Les rappels calendrier sont des fichiers `.ics` à ajouter à ton calendrier. Les dates indicatives de sortie sont séparées des clôtures d’inscription.
- **Alertes.** Les règles sont évaluées dans l’app sur les relevés récents. Pour un réassort détecté en externe, l’app renvoie vers les canaux collectifs Telegram et Discord de [Radar Stock](https://radarstock.fr/alertes/pokemon/). Les règles personnelles s’affichent à l’ouverture de PokéRadar.

L’annonce de Règne Delta provient de [Pokémon](https://www.pokemon.com/fr/actualites/jcc-pokemon-apercu-des-produits-mega-evolution-regne-delta). La vente Fnac+ du 13 novembre provient du [formulaire officiel](https://animation.fnac.com/zn/5dep5kjf6), consulté le 7 novembre 2026. Les dates indicatives de Mentali et Mewtwo proviennent du [calendrier Radar Stock](https://radarstock.fr/calendrier/pokemon/).

## Vérifier le projet

Lance `npm test`. Les tests couvrent notamment le format d’export v0.4, la fusion sans écrasement, les liens, l’expiration des relevés, le calcul des marges et les fichiers de la PWA. Pour rejouer les 39 tests d’origine, installe les dépendances du bot puis lance `python -m unittest discover -s tests` depuis `legacy/v04/`.
