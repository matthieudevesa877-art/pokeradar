"""Optional advanced PokéRadar features: evidence, sale samples, alerts, planning.

No sold transaction is manufactured. A sale is verified only when the person
importing it explicitly attests to having checked an actual completed sale.
"""
from __future__ import annotations

import csv
import io
import json
import math
import os
import statistics
from collections import Counter
from datetime import date, datetime, timedelta
from urllib.parse import urlparse

import requests

import core


def ensure_schema(db):
    """Idempotent migrations from v0.1, preserving existing SQLite data."""
    cols = {r['name'] for r in db.execute('PRAGMA table_info(offers)')}
    if 'last_status_at' not in cols:
        db.execute('ALTER TABLE offers ADD COLUMN last_status_at TEXT')
        # Legacy timestamps describe a recent reading but not its reliability.
        db.execute("""UPDATE offers SET last_status_at=last_checked
                      WHERE last_status IN ('disponible','indisponible')""")
    if 'last_known_method' not in cols:
        db.execute("ALTER TABLE offers ADD COLUMN last_known_method TEXT NOT NULL DEFAULT ''")
        db.execute("UPDATE offers SET last_known_method=last_method WHERE last_status_at IS NOT NULL")
    product_cols={r['name'] for r in db.execute('PRAGMA table_info(products)')}
    if 'api_enabled' not in product_cols:
        db.execute('ALTER TABLE products ADD COLUMN api_enabled INTEGER NOT NULL DEFAULT 0')
    db.executescript('''
        CREATE TABLE IF NOT EXISTS verified_sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id TEXT NOT NULL REFERENCES products(id),
            sale_date TEXT NOT NULL, price REAL NOT NULL CHECK(price > 0),
            source TEXT NOT NULL, sale_ref TEXT NOT NULL,
            evidence_url TEXT NOT NULL DEFAULT '',
            reviewed INTEGER NOT NULL DEFAULT 0 CHECK(reviewed IN (0,1)),
            notes TEXT NOT NULL DEFAULT '', recorded_at TEXT NOT NULL,
            UNIQUE(product_id,source,sale_ref)
        );
        CREATE INDEX IF NOT EXISTS idx_sales_recent
             ON verified_sales(product_id,sale_date,reviewed);
        CREATE TABLE IF NOT EXISTS calendar_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id TEXT NOT NULL REFERENCES products(id),
            event_date TEXT NOT NULL,
            event_type TEXT NOT NULL CHECK(event_type IN ('sortie','réassort annoncé','réimpression annoncée')),
            source_url TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            recorded_at TEXT NOT NULL,
            UNIQUE(product_id,event_date,event_type,source_url)
        );
        CREATE TABLE IF NOT EXISTS price_drop_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            offer_id INTEGER NOT NULL REFERENCES offers(id),
            observed_at TEXT NOT NULL,
            old_price REAL NOT NULL, new_price REAL NOT NULL,
            state_at_detection TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS price_drop_alerts (
            event_id INTEGER NOT NULL REFERENCES price_drop_events(id),
            channel TEXT NOT NULL, sent_at TEXT NOT NULL,
            PRIMARY KEY(event_id,channel)
        );
        CREATE TABLE IF NOT EXISTS api_pulls (
            provider TEXT NOT NULL, product_id TEXT NOT NULL, endpoint TEXT NOT NULL,
            request_date TEXT NOT NULL, status TEXT NOT NULL,
            PRIMARY KEY(provider,product_id,endpoint,request_date)
        );
    ''')


def _is_https(url):
    p = urlparse(url or '')
    return p.scheme == 'https' and bool(p.hostname)


def add_sale(product_id: str, sale_date: str, price: float, source: str,
             sale_ref: str, evidence_url: str = '', reviewed: bool = False,
             notes: str = '') -> bool:
    """Sale references must be unique. Reviewed means manually attested proof.

    The price is the actual final known transaction amount; do not use active
    listing prices or best-offer crossed-out values.
    """
    try:
        d = date.fromisoformat(sale_date)
    except (ValueError, TypeError) as exc:
        raise ValueError('Date de vente invalide : AAAA-MM-JJ') from exc
    if d > core.now().date() or d < date(1996, 1, 1):
        raise ValueError('Date de vente hors plage')
    if not (math.isfinite(float(price)) and float(price) > 0):
        raise ValueError('Prix de vente invalide')
    if not source.strip() or not sale_ref.strip():
        raise ValueError('Source et identifiant unique de transaction obligatoires')
    if reviewed and not _is_https(evidence_url):
        raise ValueError('Vente vérifiée : lien HTTPS de preuve nécessaire')
    if evidence_url and not _is_https(evidence_url):
        raise ValueError('Lien de preuve HTTPS requis')
    with core.connect() as db:
        cursor = db.execute('''INSERT OR IGNORE INTO verified_sales
            (product_id,sale_date,price,source,sale_ref,evidence_url,reviewed,notes,recorded_at)
            VALUES (?,?,?,?,?,?,?,?,?)''',
            (product_id.strip(),sale_date,float(price),source.strip(),sale_ref.strip(),
             evidence_url.strip(),int(reviewed),notes.strip(),core.iso()))
        return cursor.rowcount == 1


def sales_stats(product_id: str, days: int = 90) -> dict:
    threshold = (core.now().date() - timedelta(days=days)).isoformat()
    with core.connect() as db:
        rows = db.execute('''SELECT sale_date,price,source,evidence_url FROM verified_sales
            WHERE product_id=? AND sale_date>=? AND sale_date<=? AND reviewed=1
            ORDER BY sale_date DESC''',
            (product_id,threshold,core.now().date().isoformat())).fetchall()
        unchecked = db.execute('''SELECT COUNT(*) n FROM verified_sales
            WHERE product_id=? AND reviewed=0''',(product_id,)).fetchone()['n']
    prices=[float(r['price']) for r in rows]
    # Conservative price reference: for 5+ samples choose the 25th percentile
    # by nearest-rank; for 1-4 samples, use the minimum. These are *samples*.
    cautious = sorted(prices)[max(0,math.ceil(.25*len(prices))-1)] if prices else None
    return {
        'count':len(rows),'unchecked_count':unchecked,
        'median':round(statistics.median(prices),2) if prices else None,
        'cautious':round(cautious,2) if cautious is not None else None,
        'source_count':len({r['source'].casefold() for r in rows}),
        'last_sale':rows[0]['sale_date'] if rows else None,
        'range_days':days,
        'scope':'échantillon saisi et vérifié, pas volume de marché',
    }


def import_sales_csv(data: bytes | str) -> dict:
    """Import exact product IDs; no fuzzy matching or silent proof acceptance.

    Columns product_id,sale_date,price,source,sale_ref,evidence_url,reviewed,notes
    reviewed must be explicit 'oui', 'true', '1' or 'yes'.
    """
    text = data.decode('utf-8-sig') if isinstance(data,bytes) else data.lstrip('\ufeff')
    if len(text) > 3_000_000:
        raise ValueError('CSV trop volumineux (max 3 Mo)')
    first = next((r for r in text.splitlines() if r.strip()),'')
    delimiter = ';' if first.count(';') > first.count(',') else ','
    reader = csv.DictReader(io.StringIO(text),delimiter=delimiter)
    mandatory = {'product_id','sale_date','price','source','sale_ref','evidence_url','reviewed'}
    if not reader.fieldnames or not mandatory.issubset(set(reader.fieldnames)):
        raise ValueError('Colonnes obligatoires : '+', '.join(sorted(mandatory)))
    with core.connect() as db:
        known = {r['id'] for r in db.execute('SELECT id FROM products')}
    report={'imported':0,'duplicates':0,'rejected':0,'errors':[]}
    for lineno,row in enumerate(reader,start=2):
        if lineno>2002:
            report['errors'].append('Limite de 2000 lignes atteinte')
            break
        try:
            pid=(row.get('product_id') or '').strip()
            if pid not in known:
                raise ValueError('Identifiant produit absent du catalogue local')
            raw=(row.get('price') or '').strip().replace(' ','').replace(',','.')
            reviewed=(row.get('reviewed') or '').strip().casefold() in ('1','true','oui','yes')
            inserted=add_sale(pid,(row.get('sale_date') or '').strip(),float(raw),
                  row.get('source') or '',row.get('sale_ref') or '',
                  row.get('evidence_url') or '',reviewed,row.get('notes') or '')
            report['imported' if inserted else 'duplicates'] += 1
        except Exception as exc:
            # Includes SQLite foreign-key failures, but never prints private rows.
            report['rejected']+=1
            if len(report['errors'])<25:
                report['errors'].append(f'Ligne {lineno}: {str(exc)[:100]}')
    return report


def add_calendar_event(product_id: str, event_date: str, event_type: str,
                       source_url: str, notes: str = ''):
    try:
        date.fromisoformat(event_date)
    except ValueError as exc:
        raise ValueError('Date événement invalide') from exc
    if event_type not in ('sortie','réassort annoncé','réimpression annoncée'):
        raise ValueError('Type événement invalide')
    if not _is_https(source_url):
        raise ValueError('Source HTTPS obligatoire pour les annonces')
    with core.connect() as db:
        db.execute('''INSERT OR IGNORE INTO calendar_events
            (product_id,event_date,event_type,source_url,notes,recorded_at)
            VALUES (?,?,?,?,?,?)''',
            (product_id,event_date,event_type,source_url,notes,core.iso()))


def upcoming_events(days=90) -> list[dict]:
    a=core.now().date()
    b=a+timedelta(days=days)
    with core.connect() as db:
        return [dict(r) for r in db.execute('''SELECT e.event_date,p.name product,
                 e.event_type,e.source_url,e.notes FROM calendar_events e
                 JOIN products p ON e.product_id=p.id
                 WHERE e.event_date>=? AND e.event_date<=?
                 ORDER BY e.event_date''',(a.isoformat(),b.isoformat())).fetchall()]


def exposure_forecast(offer_id: int) -> dict:
    """Historical frequency normalized by number of checks per time slot.

    Not a calibrated forward probability: stock events observed during a scan
    may have occurred since the previous scan.
    """
    with core.connect() as db:
        events=db.execute('''SELECT observed_at FROM restock_events
             WHERE offer_id=? AND type='restock' ''',(offer_id,)).fetchall()
        checks=db.execute('''SELECT checked_at FROM checks
             WHERE offer_id=? AND status IN ('disponible','indisponible')''',(offer_id,)).fetchall()
    dates={datetime.fromisoformat(e['observed_at']).date() for e in events}
    if len(events)<8 or len(dates)<4 or len(checks)<30:
        return {'count':len(events),'checks':len(checks),'status':'données insuffisantes', 'slots':[]}
    denominator=Counter()
    numerator=Counter()
    for c in checks:
        t=datetime.fromisoformat(c['checked_at']).astimezone(core.PARIS)
        denominator[(t.weekday(),t.hour//3)] += 1
    for e in events:
        t=datetime.fromisoformat(e['observed_at']).astimezone(core.PARIS)
        numerator[(t.weekday(),t.hour//3)] += 1
    eligible=[(key,n,denominator[key]) for key,n in numerator.items() if denominator[key]>=5]
    slots=[]
    for (wd,block),n,exposure in sorted(eligible,key=lambda x:(x[1]/x[2],x[1]),reverse=True)[:5]:
        slots.append({'jour':['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'][wd],
           'heure':f'{block*3:02d}h–{block*3+3:02d}h',
           'retours_observes':n,'controles_dans_ce_creneau':exposure,
           'taux_pour_100_controles':round(100*n/exposure,1)})
    return {'count':len(events),'checks':len(checks),'slots':slots,
        'status':('Fréquences observées par créneau de 3 h (PAS des probabilités futures)'
                  if slots else 'Historique présent mais trop peu de contrôles par créneau')}


def log_price_drop(offer_id, old_price, new_price, status, threshold_pct=10):
    if not old_price or not new_price or old_price<=0 or new_price<=0:
        return None
    if status != 'disponible' or new_price > old_price*(1-threshold_pct/100):
        return None
    with core.connect() as db:
        return db.execute('''INSERT INTO price_drop_events
           (offer_id,observed_at,old_price,new_price,state_at_detection)
           VALUES (?,?,?,?,?)''',
           (offer_id,core.iso(),old_price,new_price,status)).lastrowid


def send_price_drop_alerts() -> list[str]:
    """Persistent outbox: retry transient failed notifications next pass."""
    channels=[]
    if os.getenv('DISCORD_WEBHOOK_URL'):
        channels.append(('discord',os.getenv('DISCORD_WEBHOOK_URL')))
    if os.getenv('TELEGRAM_BOT_TOKEN') and os.getenv('TELEGRAM_CHAT_ID'):
        channels.append(('telegram',os.getenv('TELEGRAM_BOT_TOKEN')))
    if not channels:
        return []
    logs=[]
    with core.connect() as db:
        events=db.execute('''SELECT e.*,p.name product,s.name store,o.url
             FROM price_drop_events e JOIN offers o ON e.offer_id=o.id
             JOIN products p ON o.product_id=p.id JOIN stores s ON o.store_id=s.id
             ORDER BY e.id LIMIT 100''').fetchall()
    for event in events:
        change=round(100*(event['new_price']/event['old_price']-1),1)
        message=(f"🔎 PokéRadar — BAISSE DE PRIX SIGNALÉE ({change} %)\n"
            f"{event['product']} · {event['store']}\n"
            f"{event['old_price']:.2f} € → {event['new_price']:.2f} €\n"
            f"{event['url']}\n"
            '⚠️ Prix et disponibilité à reconfirmer. Ce n’est pas un conseil d’achat.')
        for channel,token in channels:
            with core.connect() as db:
                if db.execute('SELECT 1 FROM price_drop_alerts WHERE event_id=? AND channel=?',
                              (event['id'],channel)).fetchone():
                    continue
            try:
                if channel=='discord':
                    resp=requests.post(token,json={'content':message},timeout=12)
                else:
                    resp=requests.post(f'https://api.telegram.org/bot{token}/sendMessage',
                         json={'chat_id':os.getenv('TELEGRAM_CHAT_ID'),'text':message},timeout=12)
                resp.raise_for_status()
                with core.connect() as db:
                    db.execute('INSERT OR IGNORE INTO price_drop_alerts VALUES (?,?,?)',
                               (event['id'],channel,core.iso()))
                logs.append(f"Baisse #{event['id']} : notification {channel} envoyée")
            except requests.RequestException:
                logs.append(f"Baisse #{event['id']} : échec {channel}, réessai futur")
    return logs


def call_queue(max_minutes=60):
    """Places to contact, not places with confirmed stock."""
    with core.connect() as db:
        rows=db.execute('''SELECT o.id,p.name product,s.name store,s.phone,s.address,
            s.travel_minutes,o.url,o.last_price,o.last_status,o.last_status_at,
            o.last_known_method FROM offers o
            JOIN products p ON p.id=o.product_id JOIN stores s ON s.id=o.store_id
            WHERE s.travel_minutes IS NOT NULL AND s.travel_minutes<=?''',
            (max_minutes,)).fetchall()
    computed={v['id']:v for v in core.opportunities(max_minutes=max_minutes)}
    data=[]
    for r in rows:
        op=computed[r['id']]
        data.append({'id':r['id'],'produit':r['product'],'magasin':r['store'],
          'adresse':r['address'],'tel':r['phone'],'trajet_min':r['travel_minutes'],
          'prix_magasin':r['last_price'],'max_achat':op['max_buy'],
          'marge_estimee':op['margin'],'statut_historique':r['last_status'],
          'dernier_signal':r['last_status_at'],'preuve':r['last_known_method'],
          'url':r['url'],
          'gain_par_minute': (round(max(0,op['estimated_gain'])/max(r['travel_minutes'],1),2)
                    if op['estimated_gain'] is not None else None),
          'priorite':('1 - appeler' if op['margin'] is not None and
                 op['margin']>=20 else '2 - vérifier')})
    return sorted(data,key=lambda r:(r['priorite'],
                 -(r['gain_par_minute'] if r['gain_par_minute'] is not None else -1),
                  r['trajet_min']))


def export_call_csv(max_minutes=60):
    buf=io.StringIO()
    columns=['id','produit','magasin','adresse','tel','trajet_min','prix_magasin',
             'max_achat','marge_estimee','statut_historique','dernier_signal',
             'preuve','url','gain_par_minute','priorite']
    writer=csv.DictWriter(buf,fieldnames=columns,delimiter=';')
    writer.writeheader()
    for row in call_queue(max_minutes):
        # Stop formula injection on CSV opened in spreadsheet apps.
        clean={k:("'"+str(v) if isinstance(v,str) and v.lstrip().startswith(('=','+','-','@'))
                  else v) for k,v in row.items()}
        writer.writerow(clean)
    return buf.getvalue().encode('utf-8-sig')


def catalog_discovery(limit=10):
    """Opt-in paid catalog lookup. Never auto-call during regular scheduling."""
    key=os.getenv('POKEINDEX_API_KEY','').strip()
    if not key:
        raise ValueError('Clé API manquante')
    if not 1<=limit<=50:
        raise ValueError('Limite 1–50 produits; 1 crédit par produit environ')
    resp=requests.get(f'{core.API_BASE}/v1/products',
         headers={'Authorization':f'Bearer {key}','User-Agent':core.USER_AGENT},
         params={'limit':limit,'offset':0},timeout=25)
    resp.raise_for_status()
    data=resp.json()
    if not isinstance(data.get('data'),list):
        raise ValueError('Réponse API catalogue inattendue')
    results=[]
    for item in data['data']:
        p=item.get('price')
        retail=item.get('retailPrice')
        discount=round(100*(1-p/retail),1) if isinstance(p,(int,float)) and isinstance(retail,(int,float)) and retail>0 else None
        results.append({'id':item.get('id'),'produit':item.get('name'),
          'type':item.get('type'),'prix_annonce':p,'prix_public_sortie':retail,
          'ecart_vs_prix_sortie_pct':discount,'date_releve':item.get('date')})
    return results


def historical_risk(product_id: str, days: int = 90) -> dict:
    """Historical ASK trend and volatility, without asserting predictiveness."""
    threshold=(core.now().date()-timedelta(days=days)).isoformat()
    with core.connect() as db:
        rows=db.execute('''SELECT quote_date,MIN(price) as price FROM quotes
            WHERE product_id=? AND basis='ASK' AND quote_date>=?
            GROUP BY quote_date ORDER BY quote_date''',(product_id,threshold)).fetchall()
    if len(rows)<7:
        return {'samples':len(rows),'change_pct':None,'daily_volatility_pct':None,
                'note':'Moins de 7 jours cotés : pas de tendance fiable'}
    price=[float(r['price']) for r in rows]
    change=100*(price[-1]/price[0]-1) if price[0]>0 else None
    # Real time intervals matter when prices are observed irregularly.
    changes=[]
    for old,new in zip(rows,rows[1:]):
        day_gap=(date.fromisoformat(new['quote_date'])-date.fromisoformat(old['quote_date'])).days
        if day_gap>0 and old['price']>0 and new['price']>0:
            changes.append(100*math.log(new['price']/old['price'])/day_gap)
    deviation=statistics.stdev(changes) if len(changes)>=3 else None
    return {'samples':len(rows),'change_pct':round(change,1) if change is not None else None,
            'daily_volatility_pct':round(deviation,2) if deviation is not None else None,
            'first':rows[0]['quote_date'],'last':rows[-1]['quote_date'],
            'note':'Variations de prix affichés, non des rendements d’investissement.'}


def holding_scenarios(buy_price, current_prudent_sale, fee_pct=5, fixed_cost=3,
                      annual_storage_cost=2, scenarios=None):
    """Deterministic stress test, emphatically not a forecast.

    Growth rates are user hypothetical assumptions; platform fees and storage
    costs are simplistic estimates and exclude taxes and capital costs.
    """
    if buy_price is None or current_prudent_sale is None or buy_price<=0 or current_prudent_sale<=0:
        return []
    scenarios=scenarios or [('Baisse hypothétique',-.15),('Stable',0.),('Hausse hypothétique',.15)]
    data=[]
    for label,rate in scenarios:
        if rate<=-1:
            raise ValueError('Taux de croissance inférieur à -100%')
        for years in (1,3,5):
            sell=current_prudent_sale*(1+rate)**years
            net_receipt=sell*(1-fee_pct/100)-fixed_cost
            holding_cost=years*annual_storage_cost
            gain=net_receipt-buy_price-holding_cost
            roi=100*gain/(buy_price+holding_cost)
            data.append({'scénario':label,'croissance_annuelle_hypothétique':f'{rate:+.0%}',
                         'durée_années':years,'vente_brute_supposée_eur':round(sell,2),
                         'gain_net_simulé_eur':round(gain,2),
                         'roi_total_simulé_pct':round(roi,1)})
    return data
