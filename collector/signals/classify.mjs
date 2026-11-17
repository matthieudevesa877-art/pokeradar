// Classement d'un texte de signalement (tweet, annonce Dealabs, alerte) : enseigne, lieu, produit, type.
// Fonctions pures, testées dans tests/signals.test.mjs.

export const RETAILERS = [
  ['E.Leclerc', /\b(e\.?\s?leclerc|leclerc|espace culturel)\b/i, true],
  ['Auchan', /\bauchan\b/i, true],
  ['Carrefour', /\bcarrefour\b/i, true],
  ['Cultura', /\bcultura\b/i, true],
  ['Fnac', /\bfnac\b/i, true],
  ['Micromania', /\bmicromania\b/i, true],
  ['King Jouet', /\bking\s?jouet\b/i, true],
  ['JouéClub', /\bjou[ée]\s?club\b/i, true],
  ['La Grande Récré', /\b(la\s)?grande\s?r[ée]cr[ée]\b/i, true],
  ['Smyths', /\bsmyths?\b/i, true],
  ['Monoprix', /\bmonoprix\b/i, true],
  ['Intermarché', /\bintermarch[ée]\b/i, true],
  ['Super U', /\b(super|hyper|march[ée])\s?u\b|\bcoursesu\b/i, true],
  ['Lidl', /\blidl\b/i, true],
  ['Action', /\baction\.com\b|\bchez action\b|\baction\s*\(magasin|\bmagasin action\b/i, true],
  ['B&M', /\bb\s?&\s?m\b/i, true],
  ['Maison de la Presse', /\bmaison de la presse\b/i, true],
  ['Relay', /\brelay\b/i, true],
  ['Cora', /\bcora\b/i, true],
  ['Géant Casino', /\bg[ée]ant\b|\bcasino\b/i, true],
  ['Boulanger', /\bboulanger\b/i, true],
  ['Darty', /\bdarty\b/i, true],
  ['Toys R Us', /\btoys\s?["“]?r["”]?\s?us\b/i, true],
  ['Picwic', /\bpicwic\b/i, true],
  ['Amazon', /\bamazon\b/i, true],
  ['Cdiscount', /\bcdiscount\b/i, true],
  ['Pokémon Center', /\bpok[ée]mon\s?center\b/i, true],
  ['Philibert', /\bphilibert\b/i, false],
  ['UltraJeux', /\bultra\s?jeux\b/i, false],
  ['CardNexus', /\bcard\s?nexus\b/i, false]
];

// Communes et centres commerciaux d'Île-de-France fréquents dans les signalements -> département.
const IDF_PLACES = {
  '75': ['Paris', 'Bercy', 'Châtelet', 'Les Halles', 'Montparnasse', 'Italie 2', 'Beaugrenelle', 'Saint-Lazare', 'Gare du Nord', 'Gare de Lyon', 'Batignolles', 'Bastille', 'Oberkampf', 'République', 'Rennes-Raspail', 'Rue de Rennes', 'Montparnasse-Bienvenüe', 'Opéra', 'Saint-Michel', 'Odéon', 'Forum des Halles', 'Bercy 2'],
  '77': ['Meaux', 'Melun', 'Chelles', 'Torcy', 'Serris', "Val d'Europe", 'Marne-la-Vallée', 'Pontault-Combault', 'Claye-Souilly', 'Collégien', 'Bay 2', 'Carré Sénart', 'Lieusaint', 'Savigny-le-Temple', 'Villiers-en-Bière', 'Fontainebleau', 'Lagny', 'Montévrain', 'Bussy-Saint-Georges'],
  '78': ['Versailles', 'Vélizy', 'Plaisir', 'Chambourcy', 'Saint-Germain-en-Laye', 'Poissy', 'Les Mureaux', 'Mantes', 'Parly 2', 'Le Chesnay', 'Trappes', 'Coignières', 'Sartrouville', 'Montesson', 'Saint-Quentin-en-Yvelines', 'Élancourt', 'Rambouillet', 'Houilles', 'Orgeval', 'Conflans'],
  '91': ['Évry', 'Corbeil', 'Massy', 'Les Ulis', 'Ulis 2', 'Brétigny', 'Sainte-Geneviève-des-Bois', 'Villebon', 'Palaiseau', 'Savigny-sur-Orge', 'Athis-Mons', 'Juvisy', 'Ris-Orangis', 'Viry-Châtillon', 'Montgeron', 'Brunoy', 'Étampes', 'Arpajon', 'Mennecy', 'Fleury-Mérogis', 'Évry 2'],
  '92': ['Suresnes', 'Puteaux', 'La Défense', 'Courbevoie', 'Nanterre', 'Rueil', 'Rueil-Malmaison', 'Levallois', 'Neuilly', 'Boulogne', 'Issy', 'Issy-les-Moulineaux', 'Clamart', 'Montrouge', 'Gennevilliers', 'Colombes', 'Asnières', 'Clichy', 'Châtillon', 'Antony', 'Sceaux', 'Bagneux', 'Meudon', 'Sèvres', 'Saint-Cloud', 'Garches', 'Vanves', 'Malakoff', 'Fontenay-aux-Roses', 'Le Plessis-Robinson', 'Châtenay-Malabry', 'Villeneuve-la-Garenne', 'Bois-Colombes', 'La Garenne-Colombes', 'Vaucresson', 'Ville-d\'Avray', 'Marnes-la-Coquette', 'Chaville', 'Bourg-la-Reine', 'So Ouest', 'Westfield Les 4 Temps', '4 Temps', 'Quatre Temps', 'Qwartz', 'Cœur Défense'],
  '93': ['Saint-Denis', 'Aubervilliers', 'Pantin', 'Bobigny', 'Montreuil', 'Rosny', 'Rosny 2', 'Noisy-le-Grand', 'Aulnay', 'Le Blanc-Mesnil', 'Drancy', 'Bondy', 'Villepinte', 'Saint-Ouen', 'Épinay', 'Sevran', 'Livry-Gargan', 'Le Raincy', 'Gagny', 'Clichy-sous-Bois', 'Pierrefitte', 'Stains', 'La Courneuve', 'Le Bourget', 'Tremblay', "O'Parinor", 'Aéroville', 'Montfermeil', 'Neuilly-sur-Marne', 'Noisy-le-Sec', 'Romainville', 'Bagnolet', 'Les Lilas'],
  '94': ['Créteil', 'Vitry', 'Ivry', 'Thiais', 'Villejuif', 'Fontenay-sous-Bois', 'Vincennes', 'Saint-Maur', 'Champigny', 'Chennevières', 'Orly', 'Belle Épine', 'Créteil Soleil', 'Rungis', 'Choisy', 'Maisons-Alfort', 'Alfortville', 'Charenton', 'Nogent', 'Le Perreux', 'Bry-sur-Marne', 'Villiers-sur-Marne', 'Sucy', 'Boissy', 'Bonneuil', 'Cachan', 'Arcueil', 'Gentilly', "L'Haÿ-les-Roses", 'Chevilly-Larue', 'Villeneuve-Saint-Georges', 'Kremlin-Bicêtre', 'Joinville'],
  '95': ['Cergy', 'Pontoise', 'Osny', 'Argenteuil', 'Sarcelles', 'Franconville', 'Ermont', 'Montigny-lès-Cormeilles', 'Herblay', 'Éragny', 'Art de Vivre', 'Gonesse', 'Garges', 'Goussainville', 'Saint-Gratien', 'Enghien', 'Taverny', 'Saint-Ouen-l\'Aumône', 'Persan', 'Domont', 'Montmorency', 'Bezons', 'Cormeilles', 'Sannois', 'Eaubonne', 'Roissy']
};

const OTHER_REGIONS = /\b(lyon|marseille|toulouse|bordeaux|nantes|lille|strasbourg|nice|montpellier|rennes|reims|grenoble|dijon|angers|n[îi]mes|tours|perpignan|toulon|metz|nancy|rouen|caen|orl[ée]ans|limoges|clermont|brest|le mans|amiens|besan[çc]on|mulhouse|avignon|pau|bayonne|la rochelle|poitiers|annecy|belgique|bruxelles|suisse|gen[èe]ve|luxembourg)\b/i;

const fold = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PLACE_PATTERNS = Object.entries(IDF_PLACES).flatMap(([dept, places]) =>
  places.map(place => [place, dept, new RegExp(`(^|[^a-z])${escape(fold(place))}([^a-z]|$)`)]));

export function retailerOf(text) {
  for (const [name, pattern, big] of RETAILERS) if (pattern.test(text)) return { retailer: name, big };
  return { retailer: '', big: false };
}

export function placeOf(text) {
  const folded = fold(text);
  // « (92) », « 92 - », « dans le 92 », code postal 92150
  const dept = /(?:\(|\bdans le |\bdept\.? |\bd[ée]partement )(75|77|78|91|92|93|94|95)\)?|\b(75|77|78|91|92|93|94|95)\d{3}\b/.exec(text);
  let best = null;
  for (const [place, d, pattern] of PLACE_PATTERNS) {
    if (pattern.test(folded) && (!best || place.length > best.place.length)) best = { place, dept: d };
  }
  // « Paris » seul est trop vague dans un titre national (« Pokémon Paris 2026 ») : on exige un contexte magasin.
  if (best?.place === 'Paris' && !/(magasin|rayon|boutique|fnac|cultura|micromania|monoprix|carrefour|auchan|leclerc|centre|gare)/i.test(text)) best = null;
  if (best) return { zone: 'IDF', place: best.place, dept: best.dept };
  if (dept) return { zone: 'IDF', place: '', dept: dept[1] ?? dept[2] };
  if (OTHER_REGIONS.test(text)) return { zone: 'Autre région', place: OTHER_REGIONS.exec(text)[1], dept: '' };
  return { zone: '', place: '', dept: '' };
}

const TCG = /\b(booster|boosters|display|etb|coffret|pok[ée]\s?box|tri\s?pack|tripack|blister|upc|ultra[- ]premium|collection premium|deck|cartes? pok[ée]mon|jcc|tcg|bundle|mini[- ]?bo[îi]tes?|duo\s?pack|duopack|coffret dresseur|dresseur d.[ée]lite|classeur)\b/i;
const NOT_TCG = /\b(lego|peluche|pok[ée]mon go|switch|nintendo|jeu vid[ée]o|livre|tome|manga|bd|puzzle|t-?shirt|sweat|mug|pyjama|costume|d[ée]guisement|montre|lampe|sac|trousse|cartable|figurine de combat|epic battle|squishmallow|jazwares|funko|paillettes|vinyle|porte-cl[ée]s)\b/i;

export function isTcg(text) {
  if (TCG.test(text)) return !NOT_TCG.test(text) || /\b(booster|cartes?|etb|display|jcc|tcg)\b/i.test(text);
  return false;
}

export const TARGETS = [
  ['30 ans', /30\s*(ans|e|ème|th)\b|30e anniversaire|30[èe]me anniversaire|anniversaire|celebration|c[ée]l[ée]bration|(?<!m[ée]ga-)(nymphali|amphinobi|noctali|mentali)-?ex|m[ée]tamorph|\bupc (noctali|mentali)|collection (figurine )?mewtwo|collection (figurine )?mew\b|duopack [ée]voli|lot journ[ée]e|lot soir[ée]e|coffret journ[ée]e|coffret soir[ée]e/i],
  ['Règne Delta', /r[èe]gne\s+delta|delta\s+(species|esp[èe]ces)/i],
  ['Méga-Évolution', /m[ée]ga[- ]?[ée]volution|h[ée]ros transcendants|chaos ascendant|flammes? fantasmagoriques?/i],
  ['Évolutions Prismatiques', /[ée]volutions? prismatiques?/i]
];

export function targetsOf(text) {
  return TARGETS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

const IN_STORE = /\b(en magasin|en rayon|rayons?|arrivages?|instore|in-store|retrait|drive|click\s?&\s?collect|vu (au|chez|à)|vus (au|chez|à)|trouv[ée]s? (au|chez|à)|dispo (au|chez|à)|magasin de|dans mon|au leclerc|au carrefour|à l.auchan|file d.attente|queue|ouverture)\b/i;

export function kindOf(text) {
  return IN_STORE.test(text) ? 'magasin' : 'en ligne';
}

export function classify(text) {
  const { retailer, big } = retailerOf(text);
  const place = placeOf(text);
  const targets = targetsOf(text);
  const tcg = isTcg(text) || (targets.includes('30 ans') && /(coffret|collection|pok[ée]s?box|upc)/i.test(text) && !NOT_TCG.test(text));
  return { retailer, big, ...place, targets, tcg, kind: kindOf(text) };
}

// Prix public maximum (TTC, avec ~15 % de marge) par type de produit : au-dessus, c'est de la revente.
// Les plus spécifiques d'abord. Base : prix Amazon vendu par Amazon et prix publics relevés en novembre 2026.
export const PUBLIC_PRICE_CAPS = [
  [/ultra[- ]?premium|\bupc\b/i, 260],
  [/pr[ée]sentoir|display|36 boosters/i, 230],
  [/lot (journ[ée]e|soir[ée]e)|5 mini[- ]?bo[îi]tes/i, 85],
  [/dresseur d.[ée]lite|\betb\b/i, 70],
  [/m[ée]tamorph|collection premium|coffret premium|super[- ]premium|\bspc\b/i, 65],
  [/classeur/i, 60],
  [/figurine/i, 50],
  [/bundle|lot de 6|6 boosters/i, 45],
  [/poster/i, 38],
  [/pok[ée]\s?box/i, 35],
  [/coffret|collection/i, 35],
  [/deck/i, 30],
  [/tri\s?pack|3 boosters/i, 25],
  [/duo\s?pack|blister|2 boosters/i, 17],
  [/mini[- ]?(bo[îi]te|tin)/i, 18],
  [/booster/i, 8]
];

export function publicPriceCap(title) {
  return PUBLIC_PRICE_CAPS.find(([pattern]) => pattern.test(title))?.[1] ?? null;
}

// true : au prix public ; false : au-dessus (revente) ; null : prix ou type inconnu.
export function isPublicPrice(title, price) {
  const cap = publicPriceCap(title);
  if (!cap || !Number.isFinite(price) || price <= 0) return null;
  return price <= cap;
}

// Un signal mérite une alerte : du JCC, une cible (30 ans, Règne Delta) ou l'Île-de-France en magasin,
// et jamais une offre de revente au-dessus du prix public.
export function isImportant(signal) {
  if (!signal.tcg || signal.publicPrice === false || signal.preorder) return false;
  if (signal.catalogId?.startsWith('upc-') && signal.verdict === 'prix boutique') return true;
  if (!signal.big) return false;
  const target = signal.targets.includes('30 ans') || signal.targets.includes('Règne Delta');
  if (signal.kind === 'magasin') return signal.zone === 'IDF' || target;
  // En ligne : seulement les produits qui valent le déplacement ou la revente (ETB, UPC, coffrets, displays, bundles…).
  const valuable = (publicPriceCap(signal.title) ?? 0) >= 25;
  return target && valuable && (signal.publicPrice === true || (signal.big && signal.publicPrice !== false));
}
