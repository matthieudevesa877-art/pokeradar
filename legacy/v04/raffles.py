"""PokéRadar — purchase access lotteries, invitation pages and optional giveaways.

Only manually verified references, no bot signup, no fake open/closed claims.
Information is a dated snapshot. Follow the retailer's own current conditions.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from urllib.parse import urlparse
import html
import re
import core

PARIS = ZoneInfo('Europe/Paris')
ENTRY_STATES = ('Non inscrit', 'Inscrit', 'Invitation reçue', 'Gagné', 'Non retenu', 'Commandé')
CATEGORIES = ('Accès à l’achat', 'À surveiller', 'Concours pour gagner')


@dataclass(frozen=True)
class Raffle:
    id: str
    brand: str
    title: str
    category: str
    method: str
    url: str
    requirements: str
    known_deadline: str = ''
    state: str = 'à vérifier'  # informational state, never inferred open from URL
    source_url: str = ''
    note: str = ''
    checked_on: str = '2026-11-06'


# First-party destinations are direct. Sources, deadlines and availability can expire.
# A dated closed signup stays archived to avoid advertising stale signups as live.
RAFFLES = (
    Raffle(
        'fnac-2026-11-06','Fnac','Vente réservée Pokémon du 6 novembre','Accès à l’achat',
        'Tirage Fnac+', 'https://animation.fnac.com/zn/pokemon-6nov',
        'Adhésion Fnac+ et numéro d’adhérent', '2026-11-03T00:00:00+01:00','clos',
        'https://radarstock.fr/pokemon/tirages/',
        'Archives de la vente du 6 novembre : inscriptions demandées avant le 3 novembre. Attention : clôture exacte non précisée.',
    ),
    Raffle(
        'micro-2026-11-06','Micromania','UPC Noctali / figurine Mew / Métamorph (6 novembre)',
        'Accès à l’achat','Vente réservée après tirage',
        'https://www.micromania.fr/inscription-vente-reservee-bww83mkjeimn8jbp.html',
        'Mégacarte Premium ou Ultimate', '2026-11-04T14:00:00+01:00','clos',
        'https://teapawt.net/AlertEtGo/status/2117242299113509250',
        'Inscription signalée le 2 novembre ; l’échéance du mercredi 4 novembre à 14 h est rapportée par un site de veille, pas une lecture actuelle du formulaire.',
    ),
    Raffle(
        'amazon-invitation-30ans','Amazon.fr','Produits 30 ans et Règne Delta',
        'Accès à l’achat','Demander une invitation',
        'https://www.amazon.fr/s?k=B0H8SZV8L7%7CB0H8T3CLB1%7CB0H8T7N9NK%7CB0H8T2SL51%7CB0H8SZN9HV%7CB0H8STQ82Z%7CB0H8SVLTJ9%7CB0H8T4N6PP&rh=p_6%3AA1X6FK5RDHNB96',
        'Compte Amazon gratuit ; demander une invitation sur chaque fiche éligible',
        '','à vérifier','https://radarstock.fr/pokemon/tirages/',
        'La campagne du 6 novembre était signalée terminée ; des fiches peuvent rouvrir. Aucun bouton Invitation n’est confirmé actuellement.',
    ),
    Raffle(
        'mentali-2026-11-27','Fnac / Micromania / Amazon','UPC Journée Mentali et figurine Mewtwo',
        'À surveiller','Ouverture à venir : inscription non publiée',
        'https://radarstock.fr/pokemon/tirages/',
        'Selon les conditions qui seront annoncées par chaque enseigne', '', 'à surveiller',
        'https://radarstock.fr/pokemon/tirages/',
        'Sortie annoncée au 27 novembre sur les fiches relevées, à confirmer. Le 27 novembre n’est PAS une date de clôture d’inscription.',
    ),
    Raffle(
        'cardpeer-concours','Cardpeer','Concours réguliers de produits Pokémon',
        'Concours pour gagner','Tirages gratuits',
        'https://cardpeer.com/fr/concours',
        'Compte gratuit ; certains lots nécessitent Discord ou une annonce active',
        '', 'à vérifier', 'https://cardpeer.com/fr/concours',
        'Ce sont des cadeaux à gagner, PAS un droit d’acheter un produit collector.',
    ),
    Raffle(
        'pokemonfr-concours','Pokémon-France','Concours mensuels Pokémon',
        'Concours pour gagner','Jeu gratuit',
        'https://www.pokemon-france.com/jeu-concours/',
        'Compte membre ; une participation par concours et respect du règlement',
        '', 'à vérifier', 'https://www.pokemon-france.com/jeu-concours/',
        'Vérifier si le concours de ce mois est ouvert ; ce n’est pas une vente réservée.',
    ),
    Raffle(
        'coin-tcg-2026-11-10','Le Coin du TCG','Concours 30 ans avec commande',
        'Concours pour gagner','Tirage parmi les commandes éligibles',
        'https://lecoindutcg.com/pages/concours-30-ans',
        'Achat éligible selon règlement ; pas d’inscription gratuite annoncée',
        '2026-11-10T23:59:00+01:00','ouvert signalé',
        'https://lecoindutcg.com/pages/concours-30-ans',
        'Concours commercial (non lié à une autorisation d’achat). Les lots annoncés sur cette page peuvent changer.',
    ),
)

TRACKERS = (
    ('Radar Stock — tirages', 'https://radarstock.fr/pokemon/tirages/', 'Répertoire de tirages, non affilié aux enseignes'),
    ('Fnac+ — adhésion', 'https://www.fnac.com/choisir-carte', 'Vérifier conditions et prix actuels avant souscription'),
    ('Micromania — Mégacarte', 'https://www.micromania.fr/aide.html?thematic=megacarte-fidelite', 'Lire les règles Premium / Ultimate et les conditions'),
    ('Fnac — recherche Pokémon', 'https://www.fnac.com/SearchResult/ResultList.aspx?Search=pokemon%20jcc', 'Rechercher les fiches et ventes réservées Fnac'),
    ('Micromania — Pokémon', 'https://www.micromania.fr/search?q=Pokemon', 'Surveiller les annonces de l’enseigne'),
    ('Amazon — Pokémon JCC', 'https://www.amazon.fr/s?k=pokemon+jcc', 'Chercher le bouton « Demander une invitation »'),
    ('ChocoBonPlan — coffrets', 'https://www.chocobonplan.com/bons-plans/cartes-a-jouer/cartes-pokemon/coffret-ultra-premium-pokemon-30eme-anniversaire', 'Suivi de liens de vente, dates variables'),
)


def https_link(url: str) -> bool:
    try:
        p = urlparse(url.strip())
        return p.scheme == 'https' and bool(p.netloc) and bool(p.hostname) and not p.username and not p.password
    except (ValueError, AttributeError):
        return False


def ensure_schema(db) -> None:
    db.execute('''CREATE TABLE IF NOT EXISTS raffle_entries (
        raffle_id TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'Non inscrit',
        note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
    )''')
    db.execute('''CREATE TABLE IF NOT EXISTS custom_raffles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brand TEXT NOT NULL, title TEXT NOT NULL, method TEXT NOT NULL,
        url TEXT NOT NULL, requirements TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'Accès à l’achat',
        deadline TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    )''')


def status(entry: Raffle, when: datetime | None = None) -> str:
    """Only explicit verified catalogue states are automatic; no 'open' inference."""
    when = when or core.now()
    if when.tzinfo is None:
        raise ValueError('Date timezone requise')
    if entry.known_deadline:
        try:
            if when >= datetime.fromisoformat(entry.known_deadline):
                return 'clos'
        except ValueError:
            return 'à vérifier'
    # Catalogue may say open when checked; expiry not implied for no deadline.
    if entry.state == 'ouvert signalé' and entry.known_deadline:
        return 'ouvert signalé'
    return entry.state if entry.state != 'ouvert signalé' else 'à vérifier'


def listed(include_custom=True, when=None) -> list[dict]:
    with core.connect() as db:
        records = {r['raffle_id']:dict(r) for r in db.execute('SELECT * FROM raffle_entries')}
        added = db.execute('SELECT * FROM custom_raffles ORDER BY id DESC').fetchall() if include_custom else []
    cards=[]
    for item in RAFFLES:
        d=asdict(item)
        d['status']=status(item,when)
        d['participation']=records.get(item.id,{}).get('state','Non inscrit')
        d['personal_note']=records.get(item.id,{}).get('note','')
        cards.append(d)
    for row in added:
        key=f"custom-{row['id']}"
        deadline=row['deadline']
        item=Raffle(key,row['brand'],row['title'],row['category'],row['method'],row['url'],row['requirements'],deadline,
                    'à vérifier',row['url'],'Ajouté manuellement : statut non vérifié',row['created_at'][:10])
        d=asdict(item)
        d['status']=status(item,when)
        d['participation']=records.get(key,{}).get('state','Non inscrit')
        d['personal_note']=records.get(key,{}).get('note','')
        cards.append(d)
    return cards


def save_participation(raffle_id: str, state: str, note=''):
    if state not in ENTRY_STATES:
        raise ValueError('État d’inscription non reconnu')
    known = {r['id'] for r in listed()}
    if raffle_id not in known:
        raise ValueError('Tirage inconnu')
    note=' '.join(str(note).split())
    if len(note)>500:
        raise ValueError('Note trop longue (500 caractères)')
    with core.connect() as db:
        db.execute('''INSERT INTO raffle_entries(raffle_id,state,note,updated_at) VALUES(?,?,?,?)
                      ON CONFLICT(raffle_id) DO UPDATE SET state=excluded.state,
                      note=excluded.note,updated_at=excluded.updated_at''',(raffle_id,state,note,core.iso()))


def add_custom(brand,title,url,requirements='',method='Tirage au sort',deadline='',category='Accès à l’achat'):
    brand=' '.join(brand.split());title=' '.join(title.split())
    if not brand or not title or len(brand)>100 or len(title)>180:
        raise ValueError('Enseigne et nom du tirage obligatoires (100/180 caractères max)')
    if category not in CATEGORIES:
        raise ValueError('Catégorie inconnue')
    if not https_link(url) or len(url)>1500:
        raise ValueError('Un lien HTTPS valide est nécessaire')
    requirements=' '.join(requirements.split());method=' '.join(method.split())
    if len(requirements)>300 or len(method)>150:
        raise ValueError('Informations trop longues')
    if deadline:
        try:
            check=datetime.fromisoformat(deadline)
            if not check.tzinfo:
                raise ValueError()
        except ValueError:
            raise ValueError('Deadline attendue au format ISO avec fuseau') from None
    with core.connect() as db:
        cur=db.execute('''INSERT INTO custom_raffles(brand,title,method,url,requirements,category,deadline,created_at)
            VALUES(?,?,?,?,?,?,?,?)''',(brand,title,method,url,requirements,category,deadline,core.iso()))
        return cur.lastrowid


def deadline_ics(entries: list[dict] | None = None, now_dt=None) -> bytes:
    """Export known future raffle signup deadlines only. Not a reminder service."""
    entries=entries if entries is not None else listed()
    current=now_dt or core.now()
    lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//PokeRadar//Raffle deadline exporter//FR','CALSCALE:GREGORIAN','METHOD:PUBLISH']
    def esc(s):
        return str(s).replace('\\','\\\\').replace('\n','\\n').replace(',','\\,').replace(';','\\;')
    for r in entries:
        if not r['known_deadline']:
            continue
        try:
            d=datetime.fromisoformat(r['known_deadline'])
        except ValueError:
            continue
        if not d.tzinfo or d <= current or r['category']=='Concours pour gagner':
            continue
        utc=d.astimezone(timezone.utc)
        dt=utc.strftime('%Y%m%dT%H%M%SZ')
        lines+=['BEGIN:VEVENT',f"UID:pokeradar-{re.sub('[^A-Za-z0-9_-]','',str(r['id']))}@local",
                f"DTSTAMP:{current.astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}",
                f'DTSTART:{dt}',f'DTEND:{dt}',
                f"SUMMARY:{esc('Clôture tirage Pokémon — '+r['brand']+' — '+r['title'])}",
                f"DESCRIPTION:{esc(r['url'])}",'END:VEVENT']
    lines.append('END:VCALENDAR')
    return ('\r\n'.join(lines)+'\r\n').encode('utf-8')
