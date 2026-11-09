# 🔎 PokéRadar v0.4 — application complète, tirages & invitations, prix et stocks

**Où voir l'application ?** Il y a **deux interfaces différentes** et elles n'ont pas les mêmes données :

| Accès | Fichier / adresse | Fonctions |
| --- | --- | --- |
| **Application complète Mac** | Lancer `bash start_mac.sh` puis ouvrir **http://localhost:8501** | 11 onglets Streamlit, analyse des prix, base SQLite, stocks locaux, scans HTML compatibles, opportunités, liens, tirages |
| **Portail mobile autonome** | Ouvrir `pokeradar_portail_mobile_v04.html` | 5 sections : accueil, tirages, 27 sources, stocks **saisis manuellement sur téléphone**, calculateur simple |
| **Même application Mac sur iPhone** | Mac lancé + même réseau Wi‑Fi : « Network URL » affichée par Streamlit, à ouvrir dans Safari | Interface Streamlit et base du Mac. Accès selon réglages de pare-feu/réseau ; ne pas exposer sur Internet sans protection. |

⚠️ **Le portail HTML mobile n'est PAS connecté au serveur Mac et ne récupère aucun stock ou prix en direct.** Les données saisies dans ce portail restent dans le navigateur (localStorage), sans synchronisation automatique. Utiliser « Exporter JSON » pour sauvegarder les saisies mobiles. Les 11 onglets de l'application complète sont : **Accueil, Tirages & invitations, Opportunités, Où acheter, Prix & ventes, Stocks locaux, Où appeler, Sorties / annonces, Réassorts, Découverte API et Configuration**.

## Nouveau : 🎟️ Tirages, invitations et ventes réservées

Le nouvel onglet rassemble les pages **officielles** de Fnac, Micromania et Amazon (quand connues), une veille des prochaines inscriptions et, séparément, des concours de lots à gagner. **Le logiciel ne remplit aucun formulaire, ne se connecte à aucun compte et ne promet aucune disponibilité.** Il permet :

- D'ouvrir directement un lien de vente réservée ou une recherche d'invitations, avec conditions et **date limite de l'annonce**.
- De distinguer **clos**, **à vérifier**, **à surveiller** et **ouvert signalé**, sans considérer une fiche produit comme une inscription confirmée.
- De mémoriser dans SQLite son propre état (`Non inscrit`, `Inscrit`, `Invitation reçue`, `Gagné`, `Non retenu`, `Commandé`) sans stocker de mot de passe.
- D'ajouter une inscription découverte manuellement avec une URL HTTPS et une éventuelle date de clôture.
- D'exporter un `.ics` des **futures dates limites précises que tu as renseignées** : importable dans Calendrier, mais non équivalent à une notification automatique.

**Photo des annonces vérifiées le 6 novembre 2026, susceptible de changer :**

1. **Fnac+**, vente Pokémon du 6 novembre : inscriptions closes le **3 novembre**. Lien d'inscription historique : <https://animation.fnac.com/zn/pokemon-6nov> ; conditions Fnac+ : <https://www.fnac.com/choisir-carte>.
2. **Micromania Premium/Ultimate**, vente coffrets 30 ans : inscription signalée le 2 novembre, clôture du mercredi **4 novembre à 14h** rapportée par des sites de veille. Lien historique : <https://www.micromania.fr/inscription-vente-reservee-bww83mkjeimn8jbp.html> ; règles de la carte : <https://www.micromania.fr/aide.html?thematic=megacarte-fidelite>.
3. **Amazon.fr**, invitations Pokémon 30 ans et Règne Delta : consulter <https://www.amazon.fr/s?k=B0H8SZV8L7%7CB0H8T3CLB1%7CB0H8T7N9NK%7CB0H8T2SL51%7CB0H8SZN9HV%7CB0H8STQ82Z%7CB0H8SVLTJ9%7CB0H8T4N6PP&rh=p_6%3AA1X6FK5RDHNB96> ; si le bouton **Demander une invitation** apparaît pour un produit, il faut l'utiliser manuellement. Aucune ouverture actuelle de ce bouton n'a été vérifiée. La vague du 6 novembre a été annoncée close.
4. **Prochaine vague à surveiller**, UPC 30 ans Mentali / figurine Mewtwo : report de sortie au **27 novembre** selon les relevés des enseignes (à revérifier), **pas** une clôture d'inscription. Répertoire de veille : <https://radarstock.fr/pokemon/tirages/>.
5. **Concours cadeaux** (à distinguer des droits d'achat) : <https://cardpeer.com/fr/concours>, <https://www.pokemon-france.com/jeu-concours/>, et <https://lecoindutcg.com/pages/concours-30-ans> (ce dernier nécessite une commande admissible ; vérifier le règlement avant tout achat).

**Sources du catalogue initial** : pages des enseignes, <https://radarstock.fr/pokemon/tirages/>, <https://teapawt.net/AlertEtGo/status/2117242299113509250> et règlement du commerçant. Les sites peuvent fermer ou modifier les formulaires : le statut d'une campagne archivée n'est pas un stock.

## Lancement sur Mac

1. Extraire entièrement `pokeradar_bot_v04.zip` ; entrer dans le dossier `pokeradar_bot_v04`.
2. Installer Python 3.11+ si nécessaire depuis <https://www.python.org/downloads/>.
3. Ouvrir Terminal dans ce dossier et exécuter `bash start_mac.sh` (connexion internet requise pour installer les dépendances lors du premier lancement).
4. Ouvrir **http://localhost:8501** dans Safari/Chrome (si l'adresse affichée par le Terminal est différente, utiliser celle du Terminal).
5. Dans **Configuration**, ajouter l'article et son magasin. Puis dans **Stocks locaux**, renseigner une vérification. Dans **Tirages & invitations**, ouvrir les formulaires et enregistrer son statut d'inscription. Tout est local tant que tu n'actives pas d'intégration externe.

**Mise à jour depuis v0.3** : fermer l'app, sauvegarder `pokeradar.db`, copier ce fichier dans le dossier v0.4. Le schéma est migré sans effacer les données déjà saisies. Ne partage pas `.env` ni `pokeradar.db`.

## Capacités et limites du stock

- La **liste des magasins locaux** et les observations n'inventent jamais du stock. Le premier lancement ne remplit aucune disponibilité « en stock ».
- **Mode manuel** : appeler ou vérifier le retrait d'un produit exact, puis inscrire le statut, le prix et la date. La disponibilité peut expirer.
- **Scan HTML** : uniquement pour une URL configurée, publiquement accessible, autorisée par `robots.txt`, avec un sélecteur de stock exact. Pas de bypass des CAPTCHAs, ni des pages JavaScript protégées.
- Il n'existe pas à ce stade de **connexion API universelle Fnac, Amazon, Micromania ni aux inventaires magasins**. Aucune alerte de loterie ou de stock n'est garantie sans source accessible et configuration.
- Les alertes Discord/Telegram sont disponibles pour les changements de stock **détectés par un scan configuré**. Le suivi des tirages est manuel (et export `.ics` pour une échéance), pas une veille temps réel des nouveaux formulaires.

## Tests

`python -m unittest discover -s tests -v` : **39 tests automatisés** passent en environnement hors ligne, dont les tests du classement des tirages, du suivi privé, de la non-confusion invitations/stock, des dates limites et du portail HTML. Le portail mobile a également été testé dans Chromium pour les 5 sections, le rendu des 7 fiches et l'enregistrement d'une disponibilité. L'installation et l'exécution de Streamlit sur Mac n'ont pas été testées de bout en bout dans cet environnement (bibliothèque non disponible ici).

---

## Documentation v0.3 conservée (fonctions de marché, prix et sourcing)

### Fonctionnalités historiques

**Bot Python local et testable.** L’application sait comparer les prix d'annonces et les ventes prouvées, simuler une marge, suivre des offres en magasins, détecter des baisses de prix, enregistrer les réassorts et envoyer des notifications (Discord ou Telegram). **Elle n’a ni accès à un inventaire universel des magasins ni certitude sur les prochains réassorts.** Les pages JavaScript protégées et les niveaux de stock internes des commerçants ne sont pas accessibles sans intégration autorisée.

## Lancer sur Mac

1. Installer Python **3.11+** si nécessaire : <https://www.python.org/downloads/>.
2. Dézipper `pokeradar_bot_v03.zip` puis ouvrir le **Terminal** dans le sous-dossier `pokeradar_bot_v03`.
3. Lancer : `bash start_mac.sh`
4. Dans le navigateur, ouvrir l'URL locale affichée par Streamlit, généralement **http://localhost:8501**.

La version v0.3 avait neuf onglets : **Opportunités**, **Où acheter**, **Prix & ventes**, **Stocks locaux**, **Où appeler**, **Sorties / annonces**, **Réassorts**, **Découverte API**, **Configuration**. Le premier démarrage crée automatiquement une base SQLite personnelle (`pokeradar.db`). Deux produits et deux magasins sont préchargés **comme exemples**, sans cotes, prix ni disponibilités fictifs. Les temps de trajet sont volontairement inconnus : saisis tes durées réelles depuis Suresnes.

**Mise à jour d’une v0.1 / v0.2 déjà utilisée** : arrête l’ancienne application, sauvegarde sa base `pokeradar.db`, copie cette base dans le nouveau dossier avant le premier démarrage. PokéRadar ajoute ses nouvelles tables et colonnes sans supprimer les données existantes. Ne copie pas ton ancien `.env` dans une archive publique.

## NOUVEAU v0.3 : 🛒 Où acheter — 27 sources (sans API)

L'onglet **Où acheter** transforme le nom exact d'un article de ta liste en liens de recherche sur **27 services** :

- **Amazon.fr, Fnac, Cultura, Micromania, Cdiscount**.
- **King Jouet, JouéClub, Smyths Toys, La Grande Récré**.
- **E.Leclerc, Carrefour, Auchan, Monoprix, Intermarché**.
- **Playin, Parkage, UltraJeux** (boutiques spécialisées TCG).
- **Cardmarket, eBay, Vinted, Leboncoin, Rakuten, StockX** (marchés secondaires, vérifier le vendeur et l'authenticité).
- **TCG Trackers, CardAround, Dealabs, Pokémon officiel** (veilles, bons plans et annonces, **pas** des magasins promettant du stock).

**Comment l'utiliser :**

1. Ouvre « Où acheter » et choisis ton produit. Affine les mots-clés (ex. `Pokémon ETB ME06 Règne Delta FR`). Pour les conditionnements précis, entre l'**EAN/UPC/GTIN** et coche « Chercher avec le code EAN ».
2. Sélectionne une ou plusieurs catégories ; les enseignes avec magasins physiques sont filtrables. Utilise les liens **Chercher le produit** / **Page officielle** / **Magasins près de Suresnes**. Si une boutique n'a pas de moteur de recherche à URL stable, le bot ouvre **Google limité à son domaine** : c'est indiqué explicitement.
3. Après avoir inspecté une **fiche produit exacte**, enregistre son URL, son prix, la livraison, le nombre d'articles identiques et le vendeur (enseigne / tiers / particulier / inconnu). Indique le stock seulement si la fiche l'affiche, sans le qualifier de réservation certaine.
4. Les offres ajoutées sont classées selon la **marge simulée après livraison et frais de revente**, avec alertes sur les vendeurs tiers, les prix au-dessus du prix public indicatif saisi, l'état du scellé, la langue, le nombre d'unités et la fraîcheur du relevé. Exporte le comparatif CSV si besoin. Toute nouvelle saisie de la même URL actualise son prix et conserve l'historique.
5. Le bouton **« Télécharger les liens pour téléphone (HTML) »** génère un portail autonome avec recherche de produit et liens vers les 27 sources. Une copie de démonstration est incluse (`pokeradar_liens_mobile.html`) : elle ne nécessite aucune API ni le serveur Python et ne récupère aucun prix à ton insu.

**Limite décisive :** ces liens sont **des moyens d'accéder** aux marchands, pas un scanner omniscient. La v0.3 **ne lit pas automatiquement les prix ou les stocks Amazon/Fnac** depuis cette nouvelle section ; les comparatifs viennent des observations que tu saisis. Pour un scan HTML de disponibilités publiques et autorisées sur une fiche exacte, l'ancien module « Configuration → Nouvelle fiche à surveiller » reste disponible, avec sélecteur spécifique et règles robots.txt. Ne te fie jamais à une recherche générale pour un stock local.

**Prudence :** ne jamais assimiler prix affiché, prix final d'une vente, estimation de revente ou offre « en stock ». Vérifier langue FR/EN/JP, quantité par lot, scellé, expéditeur, vendeur officiel, frais, limites d'achat et retrait possible avant paiement ou déplacement. Le prix public indicatif est **renseigné par toi**, non certifié automatiquement. Aucun achat automatique n'est effectué.

## Premiers résultats sans API

1. Dans **Configuration**, sélectionne un magasin, saisis sa durée de trajet, ajoute un produit exact puis une offre : prix d'achat réel et URL de la fiche en magasin.
2. Dans **Prix & ventes**, ajoute le prix d'annonce `ASK` observé (source + date). Le score et le prix d'achat maximal apparaîtront dans **Opportunités**.
3. Pour améliorer la confiance, ajoute **des transactions réellement conclues**, avec référence unique et lien HTTPS de preuve. Ne coche « vérifiée » que si tu as contrôlé la transaction et son **prix réellement payé**. Une annonce « Vendue » n'est pas suffisante si le prix final est inconnu.
4. Dans **Stocks locaux**, saisis le résultat de ton appel ou d’une réservation, en choisissant avec soin si l’information est confirmée ou non. Enregistre le prix magasin constaté.
5. Consulte **Où appeler** : liste priorisée à partir des offres *que tu as renseignées*, avec gains par minute de trajet si le modèle a assez d'informations. Aucune ligne n'affirme qu’un stock est réellement présent.

### Import CSV de ventes

Le modèle `modele_ventes.csv` utilise ces colonnes (UTF-8, séparateur `;`, `,` également accepté pour les champs séparateurs) :

```csv
product_id;sale_date;price;source;sale_ref;evidence_url;reviewed;notes
```

Les dates sont au format `AAAA-MM-JJ`, les prix en EUR, `sale_ref` doit désigner **une transaction unique**, sans nom ni coordonnées de l'acheteur. `reviewed=oui` est accepté seulement si le lien de preuve est HTTPS. Les doublons sont ignorés, les identifiants produits inconnus sont rejetés et un rapport indique les erreurs. Pour un import CLI :

```bash
python bot.py --import-sales mon_fichier.csv
```

**Limites :** il s'agit de ton échantillon vérifié, pas d’un volume exhaustif du marché. Les anciennes saisies `SOLD` de la v0.1, sans preuve liée à une transaction, ne sont **pas traitées comme des ventes vérifiées** par le nouveau modèle.

## Analyse des opportunités

- Référence de revente prudente : le prix d’annonce frais de décote (15 % par défaut), plafonné si possible par une estimation plus prudente issue d’au moins 3 ventes vérifiées de moins de 90 jours.
- Prix d’achat maximum : `(revente prudente × (1 - frais variables) - frais fixes) / (1 + marge cible)`.
- Marge simulée : `(encaissement net estimé - achat) / achat`.
- Confiance **moyenne** seulement si au moins 5 transactions vérifiées sur 90 jours, au moins 2 sources, plusieurs transactions récentes et prix d’annonces actualisés. Aucun « haut degré de certitude » automatisé ne peut remplacer le risque réel de revente.
- Score /100 **heuristique**, tenant compte de marge, intérêt subjectif, tendance ASK 30j, risque manuel de réimpression et qualité des ventes. Il **ne s'agit pas d’un rendement prédit**.
- Scénarios de conservation **1 / 3 / 5 ans** : évolution hypothétique -15 %, 0 %, +15 % par an, et coûts de stockage. Ce sont des **tests de sensibilité**, pas des prévisions de croissance.

Le calcul ne déduit pas automatiquement tous les coûts : déplacements, assurance, impôts, immobilisation du capital, éventuelle TVA, retours, frais propres à une plateforme et coût d'opportunité doivent être renseignés ou pris en compte par l'utilisateur.

## API Pokéindex : prix marché FR (PAYANTE)

Documentation vérifiée : <https://xn--pokindex-d1a.fr/api-pokemon/docs>. API `https://api.pokeindex.fr`, authentification Bearer. Prix plancher du scellé français, avec **prix demandés**, non transactions finalisées. Les relevés journaliers coûtent en général **1 crédit par produit** et l’historique **1 crédit par point renvoyé** (vérifier le fournisseur avant utilisation). L’accès et les droits de réutilisation dépendent du plan.

1. Copier `.env.example` vers `.env`, remplir `POKEINDEX_API_KEY`.
2. Dans l’onglet **Configuration**, **activer explicitement** chaque produit à suivre avec son véritable identifiant Pokéindex (par défaut, tous sont désactivés).
3. Pour une seule passe : `python bot.py --once`. Chaque produit activé n'est interrogé **qu'une seule fois par jour de Paris**, même si la réponse est en erreur ou contient une cotation datée d'hier. Une tentative apparaît dans la base `api_pulls` pour éviter la consommation accidentelle en boucle.
4. Pour l’historique 90j, définir `POKERADAR_APPROVE_HISTORY_CREDITS=oui` dans `.env`, puis lancer `python bot.py --once --history` ; il existe un coût potentiellement important en crédits par produit et par jour d’historique.
5. **Découverte API** dans le tableau de bord : un bouton affiche le coût estimé (par nombre de produits) et lance une consultation volontaire du catalogue. Cela ne cherche **pas** des stocks magasins.

Terminal : `python bot.py --discover 10 --confirm-api-cost` pour une découverte volontaire de 10 produits. Il n’existe **pas** de lancement payant automatique du catalogue. Les prix d'une annonce et le prix de sortie ne suffisent pas pour qualifier une bonne affaire.

## Scanner la disponibilité locale

- **Mode manuel (fiable selon preuve)** : sélectionne une fiche magasin exacte et enregistre un appel / une réservation préparée. Le logiciel ne passe pas l'appel pour toi et ne crée aucune réservation.
- **Mode HTML public** : configure l'URL exacte, un **sélecteur CSS très ciblé du stock pour le magasin sélectionné** (et éventuellement le sélecteur du prix). Le scanner vérifie `robots.txt` avant toute requête, ne contourne ni CAPTCHA ni authentification, et s'arrête en cas de blocage ou d'absence de bloc exploitable.
- **Erreur / inconnu** : une page introuvable ou incertaine ne détruit plus le dernier état connu et **ne déclenche pas de faux « nouveau réassort »** lors de la vérification suivante. Le dernier signal de stock connu garde son propre horodatage (`last_status_at`). Si ce signal devient vieux, l'opportunité est signalée comme à revérifier.
- **Baisse de prix d'au moins 10 %** : déclenche un événement et éventuellement une alerte uniquement lorsqu'une lecture explicite indique aussi « disponible ». Alertes de baisse et alertes de stock dédoublonnées avec historique SQLite. Un prix vu sur une page n'est pas une promesse de vente.

Une Fnac permet officiellement de consulter le statut « en rayon » ou « indisponible » après avoir choisi le magasin : <https://www.fnac.com/aide?question=comment-verifier-la-disponibilite-d-un-produit-en-magasin>. Cela ne signifie pas que la page expose le statut dans son HTML accessible à un robot. Il faut souvent **appeler ou réserver le retrait**.

## Calendrier annonces et réassorts

Dans **Sorties / annonces**, saisis une date, le produit concerné, le type de signal (`sortie`, `réassort annoncé`, `réimpression annoncée`) et une URL HTTPS attestant l'annonce. Sans annonce sourcée, aucune date n'est créée.

Dans **Réassorts**, un classement par jour/créneau de 3h n'apparaît qu'après **8 retours en stock sur 4 jours et 30 contrôles concluants** ; il est pondéré par le nombre de contrôles du créneau. Il s'agit de **fréquences historiques de détection** (fortement biaisées par l'heure des scans), et **en aucun cas d’une probabilité prédictive ou d’un stock futur confirmé**.

## Alertes Discord ou Telegram

Dans `.env`, configurer l'un ou l'autre :

```dotenv
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
TELEGRAM_BOT_TOKEN=token_secret
TELEGRAM_CHAT_ID=id_conversation
```

La première notification « disponibilité signalée », les transitions `indisponible → disponible` et les baisses de prix explicitement constatées sont envoyées si un canal est configuré. Le tableau de bord contient un formulaire de contrôle manuel. Les alertes restent à confirmer auprès du commerçant.

Pour une veille persistante sur **TON ordinateur allumé** :

```bash
python bot.py --loop
```

Une passe est lancée toutes les 20 min, et la cotation API payante est limitée à un essai par produit et par jour. Sans URL HTML autorisée ni clé API configurée, cette boucle ne découvre pas de nouveaux stocks. Elle n'est pas hébergée par ChatGPT.

Exporter uniquement le rapport : `python bot.py --report`, fichier `analyse_pokeradar.json`. Exporter la liste d'appels : `python bot.py --calls` (CSV sur la sortie standard).

## Confidentialité et usage responsable

- La base personnelle `pokeradar.db` et le fichier `.env` **ne doivent pas être partagés**. Ils ne sont pas fournis dans le ZIP initial.
- Ne publie pas Streamlit sur Internet sans authentification et protocole sécurisé.
- Respecte les conditions d'accès et licences des vendeurs et fournisseurs de données, et les éventuelles limites d’achat par client.
- Les stocks changent sans préavis. Même une réservation / confirmation téléphonique doit être reconfirmée avant déplacement.
- Pour une activité de revente habituelle, vérifie les obligations légales et fiscales applicables.

## Tests

Les 28 tests automatisés (dont 11 nouveaux scénarios de sourcing) vérifient aussi les domaines des URL, le calcul de coût par unité, la conservation des historiques d’offres, la non-confusion du prix public avec un prix de vente, et la sécurité des exports CSV / HTML.


```bash
python -m unittest discover -s tests -v
```

Aucune API, webhook ni page commerçante ne doit être appelée pendant les tests : le trafic externe est simulé.

Projet personnel indépendant : aucune affiliation à Nintendo, The Pokémon Company, Pokéindex ou les magasins cités.
