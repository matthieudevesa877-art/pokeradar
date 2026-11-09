"""PokéRadar: auditable local Pokémon TCG watchlist and opportunity engine.

This software NEVER claims retail stock is confirmed merely from a web page.
Price quotes are classified as ASK or SOLD, never silently interchanged.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import statistics
import time
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

BASE = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv('POKERADAR_DB', str(BASE / 'pokeradar.db')))
PARIS = ZoneInfo('Europe/Paris')
USER_AGENT = 'PokeRadarPersonalWatch/0.4 (+manual research; respectful low-frequency monitoring)'
API_BASE = 'https://api.pokeindex.fr'


def now() -> datetime:
    return datetime.now(PARIS)


def iso() -> str:
    return now().isoformat(timespec='seconds')


class _ManagedConnection(sqlite3.Connection):
    """Commit/rollback and always close on `with connect()` exit."""
    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            return super().__exit__(exc_type, exc_val, exc_tb)
        finally:
            self.close()


def connect() -> sqlite3.Connection:
    db = sqlite3.connect(DB_PATH, factory=_ManagedConnection)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys = ON')
    db.execute('PRAGMA busy_timeout = 5000')
    return db


def init_db() -> None:
    with connect() as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'FR',
            variant TEXT NOT NULL DEFAULT 'scellé', reprint_risk TEXT NOT NULL DEFAULT 'inconnu',
            demand INTEGER NOT NULL DEFAULT 3 CHECK(demand BETWEEN 1 AND 5),
            notes TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS stores (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '',
            travel_minutes INTEGER, phone TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS offers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id TEXT NOT NULL REFERENCES products(id),
            store_id TEXT NOT NULL REFERENCES stores(id),
            url TEXT NOT NULL DEFAULT '',
            mode TEXT NOT NULL DEFAULT 'manual' CHECK(mode IN ('manual','html')),
            price_selector TEXT NOT NULL DEFAULT '', stock_selector TEXT NOT NULL DEFAULT '',
            in_text TEXT NOT NULL DEFAULT 'en stock|en rayon|disponible',
            out_text TEXT NOT NULL DEFAULT 'rupture|indisponible|non disponible|plus disponible|épuisé',
            seller_verified INTEGER NOT NULL DEFAULT 0,
            last_price REAL, last_status TEXT NOT NULL DEFAULT 'inconnu',
            last_checked TEXT, last_method TEXT NOT NULL DEFAULT '',
            UNIQUE(product_id, store_id, url)
        );
        CREATE TABLE IF NOT EXISTS quotes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id TEXT NOT NULL REFERENCES products(id),
            quote_date TEXT NOT NULL, price REAL NOT NULL CHECK(price > 0),
            source TEXT NOT NULL, basis TEXT NOT NULL CHECK(basis IN ('ASK','SOLD')),
            recorded_at TEXT NOT NULL,
            UNIQUE(product_id, quote_date, source, basis)
        );
        CREATE TABLE IF NOT EXISTS checks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            offer_id INTEGER NOT NULL REFERENCES offers(id),
            checked_at TEXT NOT NULL, status TEXT NOT NULL, price REAL,
            method TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS restock_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            offer_id INTEGER NOT NULL REFERENCES offers(id),
            observed_at TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('new_available','restock'))
        );
        CREATE TABLE IF NOT EXISTS alerts (
            event_id INTEGER NOT NULL REFERENCES restock_events(id),
            channel TEXT NOT NULL, sent_at TEXT NOT NULL,
            PRIMARY KEY(event_id, channel)
        );
        ''')
        from intelligence import ensure_schema
        ensure_schema(db)
        from sourcing import ensure_schema as ensure_sourcing_schema
        ensure_sourcing_schema(db)
        from raffles import ensure_schema as ensure_raffles_schema
        ensure_raffles_schema(db)
        db.execute("INSERT OR IGNORE INTO products(id,name,language,reprint_risk,demand,notes) VALUES (?,?,?,?,?,?)",
                   ('etb-30-ans', 'ETB 30e anniversaire', 'FR', 'élevé', 5, 'Exemple de suivi : identifiant API public'))
        db.execute("INSERT OR IGNORE INTO products(id,name,language,reprint_risk,demand,notes) VALUES (?,?,?,?,?,?)",
                   ('etb-chaos-ascendant', 'ETB Chaos Ascendant', 'FR', 'moyen', 3, 'Exemple de suivi : identifiant API public'))
        db.execute("INSERT OR IGNORE INTO stores(id,name,address) VALUES (?,?,?)",
                   ('fnac-parly2', 'Fnac Parly 2', 'Le Chesnay-Rocquencourt'))
        db.execute("INSERT OR IGNORE INTO stores(id,name,address) VALUES (?,?,?)",
                   ('fnac-defense', 'Fnac La Défense', 'La Défense'))


def add_product(product_id: str, name: str, language='FR', variant='scellé', risk='inconnu', demand=3, notes='', api_enabled=False):
    with connect() as db:
        db.execute('''INSERT INTO products(id,name,language,variant,reprint_risk,demand,notes,api_enabled)
                      VALUES (?,?,?,?,?,?,?,?)''',
                   (product_id.strip(), name.strip(), language, variant, risk, int(demand), notes,
                    int(api_enabled)))


def add_store(store_id: str, name: str, address='', travel_minutes=None, phone='', notes=''):
    with connect() as db:
        db.execute('INSERT INTO stores(id,name,address,travel_minutes,phone,notes) VALUES (?,?,?,?,?,?)',
                   (store_id.strip(), name.strip(), address.strip(), travel_minutes, phone.strip(), notes))


def add_offer(product_id: str, store_id: str, url='', mode='manual', price=None,
              stock_selector='', price_selector='', in_text='en stock|en rayon|disponible',
              out_text='rupture|indisponible|non disponible|plus disponible|épuisé', seller_verified=False):
    if mode not in ('manual','html'):
        raise ValueError('Mode non reconnu')
    broad = {'*','body','html','main','div','span','#app','#root','.container','.content'}
    if mode == 'html' and (not url.startswith('https://') or not stock_selector.strip()
                           or stock_selector.strip().casefold() in broad):
        raise ValueError('Le scan HTML exige une URL HTTPS et un sélecteur CSS spécifique au stock')
    with connect() as db:
        cur = db.execute('''INSERT INTO offers(product_id,store_id,url,mode,last_price,
                         stock_selector,price_selector,in_text,out_text,seller_verified)
                         VALUES (?,?,?,?,?,?,?,?,?,?)''',
                         (product_id,store_id,url.strip(),mode,price,stock_selector.strip(),
                          price_selector.strip(),in_text,out_text,int(seller_verified)))
        return cur.lastrowid


def save_quote(product_id: str, price: float, source: str, basis='ASK', date=None):
    if float(price) <= 0 or basis not in ('ASK', 'SOLD'):
        raise ValueError('Prix ou type de cotation invalide')
    date = date or now().date().isoformat()
    with connect() as db:
        db.execute('''INSERT INTO quotes(product_id,quote_date,price,source,basis,recorded_at)
                      VALUES (?,?,?,?,?,?)
                      ON CONFLICT(product_id,quote_date,source,basis)
                      DO UPDATE SET price=excluded.price, recorded_at=excluded.recorded_at''',
                   (product_id,date,float(price),source,basis,iso()))


def market_sync(include_history=False) -> list[str]:
    """Authorized paid API; bounded to one GET per enabled product/day.

    History calls are separately gated to avoid surprise charges. Failed
    requests are also tracked today, to prevent a 20-minute credit-draining loop.
    """
    key = os.getenv('POKEINDEX_API_KEY', '').strip()
    if not key:
        return ['Clé POKEINDEX_API_KEY absente : aucune cotation externe téléchargée.']
    session = requests.Session()
    session.headers.update({'Authorization': f'Bearer {key}', 'User-Agent': USER_AGENT})
    logs=[]
    today=now().date().isoformat()
    with connect() as db:
        products=db.execute('SELECT id,name FROM products WHERE api_enabled=1 ORDER BY name').fetchall()
    if not products:
        return ['Aucun produit autorisé pour l’API : active-le dans Configuration. Aucun crédit consommé.']
    for product in products:
        pid=product['id']
        with connect() as db:
            already=db.execute("""SELECT status FROM api_pulls WHERE provider=? AND product_id=?
                   AND endpoint=? AND request_date=?""",('pokeindex',pid,'price',today)).fetchone()
        if already:
            logs.append(f'{pid} : requête prix du jour déjà tentée ({already["status"]})')
        else:
            state='error'
            try:
                resp=session.get(f'{API_BASE}/v1/products/{pid}/price',timeout=18)
                resp.raise_for_status()
                data=resp.json()
                if data.get('currency')!='EUR':
                    raise ValueError('Monnaie inattendue')
                price=data.get('price')
                qdate=data.get('date')
                if price is None or not qdate:
                    raise ValueError('Prix ou date manquants')
                if float(price)<=0:
                    raise ValueError('Prix non positif')
                save_quote(pid,float(price),f"Pokéindex:{data.get('source','inconnu')}",'ASK',qdate)
                state='success'
                logs.append(f'{pid} : {price} € (ASK {qdate}, prix affiché, non vendu)')
            except (requests.RequestException,ValueError,TypeError,KeyError) as exc:
                logs.append(f'{pid} : échec prix ({type(exc).__name__}: {str(exc)[:95]})')
            finally:
                with connect() as db:
                    db.execute("""INSERT OR IGNORE INTO api_pulls
                        (provider,product_id,endpoint,request_date,status)
                        VALUES (?,?,?,?,?)""",('pokeindex',pid,'price',today,state))
            time.sleep(1.0)
        if include_history:
            if os.getenv('POKERADAR_APPROVE_HISTORY_CREDITS','').casefold()!='oui':
                logs.append(f'{pid} : historique NON importé, définir POKERADAR_APPROVE_HISTORY_CREDITS=oui dans .env')
                continue
            with connect() as db:
                already_history=db.execute("""SELECT status FROM api_pulls WHERE provider=? AND product_id=?
                   AND endpoint=? AND request_date=?""",('pokeindex',pid,'history90',today)).fetchone()
            if already_history:
                logs.append(f'{pid} : import historique déjà tenté aujourd’hui ({already_history["status"]})')
                continue
            state='error'
            try:
                start=(now().date()-timedelta(days=90)).isoformat()
                h=session.get(f'{API_BASE}/v1/products/{pid}/history',
                      params={'from':start},timeout=25)
                h.raise_for_status()
                response=h.json()
                if response.get('currency')!='EUR' or not isinstance(response.get('prices'),list):
                    raise ValueError('Historique ou devise inattendus')
                points=0
                for point in response['prices']:
                    if point.get('price') and point.get('date'):
                        save_quote(pid,float(point['price']),
                             'Pokéindex:historique:'+str(point.get('source','inconnu')),
                             'ASK',point['date'])
                        points+=1
                state='success'
                logs.append(f'{pid} : {points} points historiques importés (crédits payants)')
            except (requests.RequestException,ValueError,TypeError,KeyError) as exc:
                logs.append(f'{pid} : échec historique ({type(exc).__name__}: {str(exc)[:95]})')
            finally:
                with connect() as db:
                    db.execute("""INSERT OR IGNORE INTO api_pulls
                        (provider,product_id,endpoint,request_date,status)
                        VALUES (?,?,?,?,?)""",('pokeindex',pid,'history90',today,state))
            time.sleep(1.0)
    return logs


def _parse_euro(text: str) -> float | None:
    """Parses conventional French merchant prices, not arbitrary digit strings."""
    match = re.search(r'(?<!\d)(\d{1,3}(?:[\s\u00a0\u202f.]\d{3})*|\d+)\s*[,\.]\s*(\d{2})\s*€?',text)
    if match:
        whole = re.sub(r'[\s\u00a0\u202f.]','',match.group(1))
        return float(f'{whole}.{match.group(2)}')
    match = re.search(r'(?<!\d)(\d{1,5})\s*€',text)
    return float(match.group(1)) if match else None


def _robots_allow(url: str) -> bool:
    """Respect public robots rules; fail closed on network errors / 403.

    Requests timeouts are essential: a slow robots server must not freeze the
    entire watch loop indefinitely. No CAPTCHA or anti-bot bypass.
    """
    p = urlparse(url)
    host=(p.hostname or '').lower()
    if p.scheme != 'https' or not host or host in ('localhost','127.0.0.1','::1') or host.endswith('.local'):
        return False
    # Never fetch literal internal IPv4 targets from the local web UI.
    try:
        import ipaddress
        ip=ipaddress.ip_address(host)
        if not ip.is_global:
            return False
    except ValueError:
        pass
    try:
        r=requests.get(f'{p.scheme}://{p.netloc}/robots.txt',
                       headers={'User-Agent':USER_AGENT},timeout=8,allow_redirects=False)
        if r.status_code==404:
            return True  # no robots file published; site terms still apply
        if r.status_code!=200:
            return False
        parser=RobotFileParser()
        parser.parse(r.text.splitlines())
        return parser.can_fetch(USER_AGENT,url)
    except (requests.RequestException,ValueError):
        return False


def scan_one_html(offer: sqlite3.Row) -> tuple[str,float|None,str]:
    url = offer['url']
    if not _robots_allow(url):
        return ('inconnu', None, 'robots.txt non vérifiable ou interdit')
    try:
        r = requests.get(url, headers={'User-Agent': USER_AGENT, 'Accept-Language':'fr-FR,fr;q=0.9'}, timeout=17)
        if r.status_code in (403, 429):
            return ('inconnu', None, f'accès HTTP {r.status_code}; pas de contournement')
        r.raise_for_status()
        soup = BeautifulSoup(r.text, 'html.parser')
        stock = soup.select_one(offer['stock_selector'])
        if stock is None:
            return ('inconnu', None, 'bloc stock CSS introuvable (site dynamique ?)')
        content = stock.get_text(' ', strip=True).casefold()
        # Match whole words/phrases, never "disponible" inside "indisponible".
        # Conflicting in-stock/out-of-stock text => unknown, not a fake positive.
        def matches(words):
            return any(re.search(r'(?<!\w)'+re.escape(w.strip().casefold())+r'(?!\w)',
                                 content) for w in words.split('|') if w.strip())
        matches_yes = matches(offer['in_text'])
        matches_no = matches(offer['out_text'])
        if matches_no and matches_yes:
            # A negative phrase may contain a positive word ("non disponible").
            negatives=[x.strip().casefold() for x in offer['out_text'].split('|') if x.strip()]
            without_negative=content
            for word in sorted(negatives,key=len,reverse=True):
                without_negative=re.sub(r'(?<!\w)'+re.escape(word)+r'(?!\w)',
                                        ' ',without_negative)
            matches_yes=any(re.search(r'(?<!\w)'+re.escape(w.strip().casefold())+r'(?!\w)',
                                      without_negative) for w in offer['in_text'].split('|') if w.strip())
        status = 'disponible' if matches_yes and not matches_no else (
                 'indisponible' if matches_no and not matches_yes else 'inconnu')
        price = None
        if offer['price_selector']:
            price_node = soup.select_one(offer['price_selector'])
            if price_node:
                price = _parse_euro(price_node.get_text(' ', strip=True))
        return (status, price, 'HTML public / indication non garantie')
    except (requests.RequestException, ValueError) as exc:
        return ('inconnu', None, f'erreur de lecture ({type(exc).__name__})')


def record_check(offer_id: int, status: str, price: float | None, method: str) -> tuple[str,int|None]:
    """Persist observations without allowing an inconclusive scan to erase known state.

    last_checked tracks every attempt; last_status_at is the last meaningful
    observation and MUST be used for freshness in the opportunity engine.
    """
    if status not in ('disponible','indisponible','inconnu'):
        raise ValueError('Statut invalide')
    if price is not None and (not isinstance(price,(int,float)) or not 0 < price < 10_000_000):
        raise ValueError('Prix invalide')
    when = iso()
    price_old=None
    stock_effective=None
    with connect() as db:
        old = db.execute('SELECT last_status,last_price FROM offers WHERE id=?',(offer_id,)).fetchone()
        if not old:
            raise ValueError('Offre introuvable')
        price_old=old['last_price']
        stock_effective=old['last_status'] if status=='inconnu' else status
        if status == 'inconnu':
            db.execute("""UPDATE offers SET last_price=?,last_checked=?,last_method=? WHERE id=?""",
                (price if price is not None else old['last_price'],when,method,offer_id))
        else:
            db.execute("""UPDATE offers SET last_status=?,last_price=?,last_checked=?,
                last_method=?,last_status_at=?,last_known_method=? WHERE id=?""",
                (status,price if price is not None else old['last_price'],when,method,
                 when,method,offer_id))
        db.execute('INSERT INTO checks(offer_id,checked_at,status,price,method) VALUES (?,?,?,?,?)',
                   (offer_id,when,status,price,method))
        kind = 'restock' if old['last_status'] == 'indisponible' and status == 'disponible' else (
               'new_available' if old['last_status'] == 'inconnu' and status == 'disponible' else None)
        event_id = None
        if kind:
            event_id = db.execute("""INSERT INTO restock_events(offer_id,observed_at,type)
                                     VALUES (?,?,?)""",(offer_id,when,kind)).lastrowid
    if price is not None and price_old is not None:
        from intelligence import log_price_drop
        log_price_drop(offer_id,price_old,price,status)
    return (kind or 'inchangé',event_id)


def scan_html_offers() -> list[str]:
    with connect() as db:
        offers = db.execute("SELECT * FROM offers WHERE mode='html' ORDER BY id").fetchall()
    logs = []
    for offer in offers:
        last = offer['last_checked']
        if last:
            try:
                if now() - datetime.fromisoformat(last) < timedelta(minutes=20):
                    logs.append(f"Offre #{offer['id']} : contrôle précédent trop récent, ignorée")
                    continue
            except ValueError:
                pass
        status, price, method = scan_one_html(offer)
        change,event_id = record_check(offer['id'], status,price,method)
        logs.append(f"Offre #{offer['id']} : {status}, {price if price else '?'} € ({method})")
        if event_id:
            logs += send_alert(event_id)
        time.sleep(1.0)
    from intelligence import send_price_drop_alerts
    logs.extend(send_price_drop_alerts())
    return logs


def manually_check(offer_id: int, status: str, price: float | None = None, confirmed=False):
    method = 'confirmation téléphonique ou réservation' if confirmed else 'saisie manuelle non confirmée'
    change,event_id = record_check(offer_id,status,price,method)
    logs = [f'Offre #{offer_id} : {change}']
    if event_id:
        logs.extend(send_alert(event_id))
    from intelligence import send_price_drop_alerts
    logs.extend(send_price_drop_alerts())
    return logs


def latest_price(product_id: str, basis: str) -> dict|None:
    with connect() as db:
        rows = db.execute('''SELECT quote_date,price,source,recorded_at FROM quotes
              WHERE product_id=? AND basis=? ORDER BY quote_date DESC LIMIT 20''',(product_id,basis)).fetchall()
    if not rows:
        return None
    # For comparable product and basis, conservative best available ASK price on newest observation date.
    newest = rows[0]['quote_date']
    samples = [r for r in rows if r['quote_date'] == newest]
    price = min(float(r['price']) for r in samples) if basis == 'ASK' else statistics.median(float(r['price']) for r in samples)
    return {'price':price,'date':newest,'sources':[r['source'] for r in samples]}


def age_days(date_str: str|None) -> int:
    if not date_str:
        return 100000
    try:
        return (now().date() - datetime.fromisoformat(date_str).date()).days
    except ValueError:
        return 100000


def trend_30d(product_id: str) -> float|None:
    with connect() as db:
        rows = db.execute('''SELECT quote_date,MIN(price) as price FROM quotes
                  WHERE product_id=? AND basis='ASK' AND quote_date>=?
                  GROUP BY quote_date ORDER BY quote_date''',
                  (product_id,(now().date()-timedelta(days=30)).isoformat())).fetchall()
    if len(rows) < 7 or age_days(rows[-1]['quote_date']) > 3:
        return None
    early = [r['price'] for r in rows[:max(3,len(rows)//3)]]
    late = [r['price'] for r in rows[-max(3,len(rows)//3):]]
    if statistics.median(early)<=0:
        return None
    return (statistics.median(late)/statistics.median(early)-1)*100


def evaluate_offer(offer: sqlite3.Row, fee_pct=5, haircut_pct=15,
                   fixed_cost=3, max_minutes=60, min_margin_pct=20) -> dict:
    """Simulation prudente, même avec ventes vérifiées : aucun rendement garanti."""
    from intelligence import sales_stats
    product_id=offer['product_id']
    asking=latest_price(product_id,'ASK')
    legacy_sold=latest_price(product_id,'SOLD')
    sample=sales_stats(product_id,90)
    market_fresh = asking is not None and 0 <= age_days(asking['date']) <= 7
    sample_recent = sample['count']>=3 and 0 <= age_days(sample['last_sale'])<=30
    expected_sale = None
    # ASK values are listed prices, not guaranteed completed sale values.
    if market_fresh:
        expected_sale = asking['price']*(1-haircut_pct/100)
    if sample['count']>=3 and sample['cautious'] is not None:
        conservative_verified = sample['cautious']*.95  # allowance for sample uncertainty
        expected_sale = min(expected_sale,conservative_verified) if expected_sale is not None else conservative_verified
    buy = offer['last_price']
    margin = None
    net = None
    max_buy = None
    if expected_sale is not None:
        max_buy = round((expected_sale*(1-fee_pct/100)-fixed_cost)/(1+min_margin_pct/100),2)
    if buy is not None and buy>0 and expected_sale is not None:
        net = expected_sale*(1-fee_pct/100)-fixed_cost
        margin = 100*(net-buy)/buy
    observed_at = offer['last_status_at']
    try:
        hours_since_stock = max(0,(now()-datetime.fromisoformat(observed_at)).total_seconds()/3600) if observed_at else None
    except (ValueError,TypeError):
        hours_since_stock=None
    recent_check=hours_since_stock is not None and hours_since_stock<=24
    accessible=offer['travel_minutes'] is not None and 0<=offer['travel_minutes']<=max_minutes
    known_method=offer['last_known_method']
    stock_quality = ('appel / retrait déclaré' if 'confirmation téléphonique' in known_method else
                     'signal HTML non garanti' if 'HTML' in known_method else
                     'saisie manuelle' if known_method else 'aucune preuve récente')
    risk_penalty={'élevé':20,'moyen':10,'faible':0,'inconnu':13}.get(offer['reprint_risk'],13)
    trend=trend_30d(product_id)
    # Heuristic for ranking, not a forecast or probabilistic investment score.
    score = round(max(0,min(100,
        (max(-25,min(40,margin or 0))*1.1 if margin is not None else 0)
        + offer['demand']*5 + max(-10,min(10,(trend or 0)/2))
        - risk_penalty + (12 if sample_recent else (4 if sample['count']>=3 else 0)))))
    why=[]
    if not asking and not sample['count']:
        why.append('aucune référence de marché')
    if asking and not market_fresh:
        why.append('prix demandé trop ancien (>7 jours)')
    if sample['count']<3:
        why.append('moins de 3 ventes conclues vérifiées sur 90 jours')
    elif not sample_recent:
        why.append('échantillon de ventes peu récent')
    if legacy_sold is not None:
        why.append('anciennes cotations SOLD non auditées exclues du prix prudent')
    if not recent_check or offer['last_status'] != 'disponible':
        why.append('absence de signal de stock disponible de moins de 24h')
    if known_method.startswith('HTML'):
        why.append('stock HTML non confirmé par le commerçant')
    if not accessible:
        why.append('trajet inconnu ou hors limite')
    if not offer['seller_verified']:
        why.append('identité du vendeur officiel non vérifiée')
    if offer['reprint_risk'] in ('élevé','inconnu'):
        why.append('risque de réimpression élevé ou inconnu')
    viable=(margin is not None and margin>=min_margin_pct and recent_check
            and offer['last_status']=='disponible' and accessible and offer['seller_verified']
            and (market_fresh or sample_recent))
    label='POTENTIEL : APPELER / RÉSERVER' if viable else 'SURVEILLER / VÉRIFIER'
    if margin is not None and margin < 0:
        label='MARGE NÉGATIVE ESTIMÉE'
    if not market_fresh and sample['count']<3:
        label='DONNÉES INSUFFISANTES'
    confidence=('moyenne' if sample_recent and sample['count']>=5 and
                sample['source_count']>=2 and market_fresh else 'faible')
    return {
       'id':offer['id'],'product_id':product_id,'product':offer['product_name'],
       'store':offer['store_name'],'url':offer['url'],'status':offer['last_status'],
       'checked':offer['last_checked'],'stock_known_at':observed_at,
       'stock_age_hours':round(hours_since_stock,1) if hours_since_stock is not None else None,
       'stock_quality':stock_quality,'method':offer['last_method'],'buy':buy,
       'reference_ask':asking['price'] if asking else None,
       'ask_date':asking['date'] if asking else None,
       'reference_sold':sample['median'],'sold_date':sample['last_sale'],
       'verified_sales_90d':sample['count'], 'unchecked_sales':sample['unchecked_count'],
       'legacy_sold_unverified':legacy_sold['price'] if legacy_sold else None,
       'expected_sale':round(expected_sale,2) if expected_sale is not None else None,
       'net_sale':round(net,2) if net is not None else None,'max_buy':max_buy,
       'estimated_gain':round(net-buy,2) if net is not None and buy is not None else None,
       'margin':round(margin,1) if margin is not None else None,
       'trend_30d':round(trend,1) if trend is not None else None,
       'score':score,'label':label,'confidence':confidence,
       'reasons':why,'travel_minutes':offer['travel_minutes']}


def opportunities(max_minutes=60,min_margin_pct=20,fee_pct=5,haircut_pct=15,fixed_cost=3) -> list[dict]:
    with connect() as db:
        rows=db.execute('''SELECT o.*,p.name as product_name,p.reprint_risk,p.demand,
                   s.name as store_name,s.travel_minutes FROM offers o
                   JOIN products p ON p.id=o.product_id
                   JOIN stores s ON s.id=o.store_id ORDER BY p.name''').fetchall()
    return sorted([evaluate_offer(o,fee_pct,haircut_pct,fixed_cost,max_minutes,min_margin_pct)
                   for o in rows],key=lambda o:(o['margin'] is not None,o['score']),reverse=True)


def forecast_slots(offer_id:int) -> dict:
    from intelligence import exposure_forecast
    return exposure_forecast(offer_id)


def send_alert(event_id: int) -> list[str]:
    """Optional Telegram/Discord notifications; once per event and channel."""
    with connect() as db:
        row = db.execute('''SELECT e.*,o.last_price,o.url,o.last_method,p.name as product_name,
                     s.name as store_name FROM restock_events e
                     JOIN offers o ON o.id=e.offer_id
                     JOIN products p ON p.id=o.product_id
                     JOIN stores s ON s.id=o.store_id WHERE e.id=?''',(event_id,)).fetchone()
    if not row:
        return ['Événement introuvable']
    msg = (f"🔎 PokéRadar : {'RESTOCK OBSERVÉ' if row['type']=='restock' else 'DISPONIBILITÉ SIGNALÉE'}\n"
           f"{row['product_name']} · {row['store_name']}\n"
           f"Prix affiché : {row['last_price'] if row['last_price'] else '?'} €\n"
           f"Source : {row['last_method']} · {row['observed_at']}\n"
           f"{row['url']}\n⚠️ Stock non garanti : vérifie / réserve avant déplacement.")
    channels=[]
    if os.getenv('DISCORD_WEBHOOK_URL'):
        channels.append(('discord',os.getenv('DISCORD_WEBHOOK_URL')))
    if os.getenv('TELEGRAM_BOT_TOKEN') and os.getenv('TELEGRAM_CHAT_ID'):
        channels.append(('telegram',os.getenv('TELEGRAM_BOT_TOKEN')))
    logs=[]
    for channel,credential in channels:
        with connect() as db:
            if db.execute('SELECT 1 FROM alerts WHERE event_id=? AND channel=?',(event_id,channel)).fetchone():
                continue
        try:
            if channel=='discord':
                r=requests.post(credential,json={'content':msg},timeout=12)
            else:
                r=requests.post(f'https://api.telegram.org/bot{credential}/sendMessage',
                     json={'chat_id':os.getenv('TELEGRAM_CHAT_ID'),'text':msg},timeout=12)
            r.raise_for_status()
            with connect() as db:
                db.execute('INSERT OR IGNORE INTO alerts(event_id,channel,sent_at) VALUES (?,?,?)',
                           (event_id,channel,iso()))
            logs.append(f'Alerte {channel} envoyée')
        except requests.RequestException as exc:
            logs.append(f'Alerte {channel} NON envoyée : {type(exc).__name__}')
    if not channels:
        logs.append('Aucun canal de notification configuré')
    return logs


def snapshot_counts() -> dict:
    with connect() as db:
        result={}
        for name in ('products','stores','offers','quotes','restock_events'):
            result[name]=db.execute(f'SELECT COUNT(*) as n FROM {name}').fetchone()['n']
        return result


def export_report(path: str|Path, **kwargs):
    data={'generated_at':iso(),'note':'Prix demandés ≠ prix effectivement vendus. Stock non garanti.',
          'opportunities':opportunities(**kwargs)}
    Path(path).write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
    return path
