"""PokéRadar sourcing hub — safe merchant discovery + manually audited offers.

Search links are pointers to merchant searches, NOT proofs of availability or sale.
No external network request is made by this module.
"""
from __future__ import annotations

import csv
import io
import math
import re
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlencode, urlparse

import core
from intelligence import sales_stats


@dataclass(frozen=True)
class Source:
    id: str
    name: str
    group: str
    site: str
    domain: str
    strategy: str = 'google'  # native confirmed pattern, google site query, or category page
    local: bool = False
    warning: str = ''
    category_url: str = ''


# google fallback is explicit because internal query routes can be unstable.
# The domain restricts the site search; no claim is made that a product exists.
SOURCES = (
    Source('amazon','Amazon.fr','Grandes enseignes','https://www.amazon.fr','amazon.fr','amazon',False,
           'Attention aux vendeurs tiers, à la langue et aux produits reconditionnés.'),
    Source('fnac','Fnac','Grandes enseignes','https://www.fnac.com','fnac.com','fnac',True,
           'Vérifier « vendu par Fnac » et le retrait en magasin.'),
    Source('cultura','Cultura','Grandes enseignes','https://www.cultura.com','cultura.com','google',True,
           'Distinguer stock Cultura, marketplace et stock du magasin.'),
    Source('micromania','Micromania','Grandes enseignes','https://www.micromania.fr','micromania.fr','google',True),
    Source('kingjouet','King Jouet','Jouets & loisirs','https://www.king-jouet.com','king-jouet.com','google',True,
           'Contrôler le stock du magasin sélectionné.',
           'https://www.king-jouet.com/jeux-jouets-pokemon.htm'),
    Source('joueclub','JouéClub','Jouets & loisirs','https://www.joueclub.fr','joueclub.fr','google',True),
    Source('smyths','Smyths Toys','Jouets & loisirs','https://www.smythstoys.com/fr/fr-fr','smythstoys.com','google',True,
           'La disponibilité web ne confirme pas le magasin choisi.',
           'https://www.smythstoys.com/fr/fr-fr/jouets/jeux-de-societe-et-puzzles/cartes-a-collectionner/cartes-pokemon/c/SM1301061101'),
    Source('granderecre','La Grande Récré','Jouets & loisirs','https://www.lagranderecre.fr','lagranderecre.fr','google',True),
    Source('leclerc','E.Leclerc','Hypermarchés','https://www.e.leclerc','e.leclerc','google',True),
    Source('carrefour','Carrefour','Hypermarchés','https://www.carrefour.fr','carrefour.fr','google',True),
    Source('auchan','Auchan','Hypermarchés','https://www.auchan.fr','auchan.fr','google',True),
    Source('monoprix','Monoprix','Hypermarchés','https://www.monoprix.fr','monoprix.fr','google',True),
    Source('intermarche','Intermarché','Hypermarchés','https://www.intermarche.com','intermarche.com','google',True),
    Source('cdiscount','Cdiscount','Grandes enseignes','https://www.cdiscount.com','cdiscount.com','google',False,
           'Vérifier l’identité du vendeur marketplace.'),
    Source('playin','Playin','Boutiques TCG','https://www.play-in.com','play-in.com','google',True),
    Source('parkage','Parkage','Boutiques TCG','https://www.parkage.com','parkage.com','google',True),
    Source('ultrajeux','UltraJeux','Boutiques TCG','https://www.ultrajeux.com','ultrajeux.com','google',True),
    Source('cardmarket','Cardmarket','Marchés secondaires','https://www.cardmarket.com/fr/Pokemon','cardmarket.com','cardmarket',False,
           'Contrôler langue, édition, frais de port et réputation du vendeur.'),
    Source('ebay','eBay','Marchés secondaires','https://www.ebay.fr','ebay.fr','ebay',False,
           'Une annonce active n’est pas une vente réalisée.'),
    Source('vinted','Vinted','Marchés secondaires','https://www.vinted.fr','vinted.fr','vinted',False,
           'Attention aux contrefaçons et scellés reconditionnés.'),
    Source('leboncoin','Leboncoin','Marchés secondaires','https://www.leboncoin.fr','leboncoin.fr','leboncoin',True,
           'Rendez-vous et achat à sécuriser ; demander une preuve du scellé.'),
    Source('rakuten','Rakuten','Marchés secondaires','https://fr.shopping.rakuten.com','rakuten.com','google',False,
           'Vérifier les vendeurs tiers et les frais.'),
    Source('stockx','StockX','Marchés secondaires','https://stockx.com','stockx.com','google',False,
           'Comparer le total frais inclus et la langue du produit.'),
    Source('tcgtrackers','TCG Trackers','Veille & comparateurs','https://tcg-trackers.com/stock','tcg-trackers.com','category',False,
           'Signal externe à confirmer sur la boutique.'),
    Source('cardaround','CardAround (enseignes)','Veille & comparateurs','https://cardaround.fr/enseignes','cardaround.fr','category',True,
           'Annuaire ; aucune disponibilité confirmée pour un article.'),
    Source('dealabs','Dealabs','Veille & comparateurs','https://www.dealabs.com','dealabs.com','google',False,
           'Bon plan partagé ; vérifier date, vendeur et stock.'),
    Source('pokemon','Pokémon officiel','Sorties officielles','https://www.pokemon.com/fr','pokemon.com','google',False,
           'Annonces et informations, pas un magasin.'),
)
SOURCE_BY_ID = {s.id:s for s in SOURCES}
GROUPS = tuple(dict.fromkeys(s.group for s in SOURCES))


def clean_query(text: str, maxlen: int = 160) -> str:
    q = ' '.join(str(text).split())
    if not q or len(q) > maxlen:
        raise ValueError('Saisir un terme de recherche de 1 à 160 caractères')
    return q


def search_url(source_id: str, query: str) -> str:
    """Return HTTPS outbound search page (not product stock or an offer URL)."""
    source = SOURCE_BY_ID[source_id]
    q = clean_query(query)
    if source.strategy == 'amazon':
        return 'https://www.amazon.fr/s?' + urlencode({'k':q})
    if source.strategy == 'fnac':
        return 'https://www.fnac.com/SearchResult/ResultList.aspx?' + urlencode({'Search':q})
    if source.strategy == 'ebay':
        return 'https://www.ebay.fr/sch/i.html?' + urlencode({'_nkw':q})
    if source.strategy == 'cardmarket':
        return 'https://www.cardmarket.com/fr/Pokemon/Products/Search?' + urlencode({'searchString':q})
    if source.strategy == 'vinted':
        return 'https://www.vinted.fr/catalog?' + urlencode({'search_text':q})
    if source.strategy == 'leboncoin':
        return 'https://www.leboncoin.fr/recherche?' + urlencode({'text':q})
    if source.strategy == 'category':
        return source.site
    return 'https://www.google.com/search?' + urlencode({'q':f'site:{source.domain} {q}'})


def maps_url(source_id: str, town: str = 'Suresnes') -> str:
    src = SOURCE_BY_ID[source_id]
    if not src.local:
        raise ValueError('Cette source ne dispose pas de magasins locaux dans cet annuaire')
    return 'https://www.google.com/maps/search/?' + urlencode({'api':1,'query':f'{src.name} près de {clean_query(town, 90)}'})


def search_links(query: str, groups: list[str] | None = None, local_only: bool = False) -> list[dict]:
    q=clean_query(query)
    return [{'id':s.id,'Enseigne':s.name,'Catégorie':s.group,'Type de lien':
             ('Recherche directe' if s.strategy not in ('google','category') else
              'Recherche Google ciblée' if s.strategy=='google' else 'Page de veille'),
             'Recherche':search_url(s.id,q),'Site':s.site,'Magasins physiques':s.local,
             'Conseil':s.warning or 'Comparer prix, frais et disponibilité.',
             'Où près de moi':maps_url(s.id) if s.local else None}
            for s in SOURCES if (not groups or s.group in groups) and (not local_only or s.local)]


def _is_https(url: str) -> bool:
    try:
        p=urlparse(str(url).strip())
        return p.scheme=='https' and bool(p.hostname) and not p.username and not p.password and not p.fragment
    except ValueError:
        return False


def _merchant_host_ok(source_id: str,url: str) -> bool:
    h=urlparse(url).hostname
    domain=SOURCE_BY_ID[source_id].domain
    return bool(h and (h==domain or h.endswith('.'+domain)))


def _numeric(value, what: str, allow_zero=False) -> float:
    try:
        v=float(value)
        if not math.isfinite(v) or (v<0 if allow_zero else v<=0):
            raise ValueError()
        return v
    except (ValueError,TypeError):
        raise ValueError(f'{what} doit être un nombre valide et {"positif ou nul" if allow_zero else "strictement positif"}') from None


def ensure_schema(db) -> None:
    db.executescript('''
        CREATE TABLE IF NOT EXISTS sourcing_metadata (
            product_id TEXT PRIMARY KEY REFERENCES products(id), ean TEXT NOT NULL DEFAULT '',
            search_alias TEXT NOT NULL DEFAULT '', retail_price REAL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS online_offers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id TEXT NOT NULL REFERENCES products(id),
            source_id TEXT NOT NULL,
            url TEXT NOT NULL,
            price REAL NOT NULL CHECK(price>0),
            shipping REAL NOT NULL DEFAULT 0 CHECK(shipping>=0),
            quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity BETWEEN 1 AND 1000),
            seller_type TEXT NOT NULL DEFAULT 'inconnu',
            condition TEXT NOT NULL DEFAULT 'scellé à vérifier',
            stock_status TEXT NOT NULL DEFAULT 'inconnu',
            language TEXT NOT NULL DEFAULT 'FR à vérifier',
            notes TEXT NOT NULL DEFAULT '',
            observed_at TEXT NOT NULL,
            UNIQUE(product_id,source_id,url)
        );
        CREATE TABLE IF NOT EXISTS online_offer_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            online_offer_id INTEGER NOT NULL REFERENCES online_offers(id),
            observed_at TEXT NOT NULL, price REAL NOT NULL,
            shipping REAL NOT NULL, stock_status TEXT NOT NULL,
            seller_type TEXT NOT NULL
        );
    ''')


def save_product_metadata(product_id: str, ean='', alias='', retail_price=None) -> None:
    code=''.join(str(ean).split())
    if code and (not code.isdigit() or len(code) not in (8,12,13,14)):
        raise ValueError('EAN/UPC/GTIN : 8, 12, 13 ou 14 chiffres, sans lettre')
    alias=' '.join(str(alias).split())
    if len(alias)>160:
        raise ValueError('Alias trop long')
    retail = _numeric(retail_price,'Prix public') if retail_price not in (None,'',0,0.0) else None
    with core.connect() as db:
        db.execute('''INSERT INTO sourcing_metadata(product_id,ean,search_alias,retail_price,updated_at)
                      VALUES(?,?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET
                      ean=excluded.ean,search_alias=excluded.search_alias,
                      retail_price=excluded.retail_price,updated_at=excluded.updated_at''',
                   (product_id,code,alias,retail,core.iso()))


def get_product_metadata(product_id: str) -> dict:
    with core.connect() as db:
        r=db.execute('SELECT * FROM sourcing_metadata WHERE product_id=?',(product_id,)).fetchone()
    return dict(r) if r else {'product_id':product_id,'ean':'','search_alias':'','retail_price':None}


def save_online_offer(product_id: str, source_id: str, url: str, price: float,
                      shipping: float=0, quantity: int=1, seller_type='inconnu',
                      condition='scellé à vérifier', stock_status='inconnu',
                      language='FR à vérifier', notes='') -> int:
    """Stores a user-confirmed observation; does NOT fetch or confirm the URL/stock."""
    if source_id not in SOURCE_BY_ID:
        raise ValueError('Enseigne inconnue')
    url=str(url).strip()
    if not _is_https(url) or not _merchant_host_ok(source_id,url):
        raise ValueError('Lien HTTPS exact attendu sur le domaine officiel de la plateforme choisie')
    if urlparse(url).port not in (None,443):
        raise ValueError('Port HTTPS atypique non accepté')
    price = _numeric(price,'Prix de la fiche')
    shipping = _numeric(shipping,'Livraison',True)
    if isinstance(quantity,bool) or not str(quantity).isdigit() or not 1<=int(quantity)<=1000:
        raise ValueError('Quantité : entier entre 1 et 1 000')
    if seller_type not in ('enseigne','tiers','particulier','inconnu'):
        raise ValueError('Nature de vendeur inconnue')
    if stock_status not in ('disponible affiché','indisponible affiché','inconnu'):
        raise ValueError('Statut de disponibilité inconnu')
    if len(notes)>500:
        raise ValueError('Note trop longue')
    timestamp=core.iso()
    with core.connect() as db:
        row=db.execute('SELECT id FROM online_offers WHERE product_id=? AND source_id=? AND url=?',
                       (product_id,source_id,url)).fetchone()
        if row:
            oid=row['id']
            db.execute('''UPDATE online_offers SET price=?,shipping=?,quantity=?,seller_type=?,
                       condition=?,stock_status=?,language=?,notes=?,observed_at=? WHERE id=?''',
                       (price,shipping,int(quantity),seller_type,condition,stock_status,language,
                        notes.strip(),timestamp,oid))
        else:
            oid=db.execute('''INSERT INTO online_offers
                (product_id,source_id,url,price,shipping,quantity,seller_type,condition,
                 stock_status,language,notes,observed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)''',
                 (product_id,source_id,url,price,shipping,int(quantity),seller_type,condition,
                  stock_status,language,notes.strip(),timestamp)).lastrowid
        db.execute('''INSERT INTO online_offer_history
             (online_offer_id,observed_at,price,shipping,stock_status,seller_type)
             VALUES(?,?,?,?,?,?)''',(oid,timestamp,price,shipping,stock_status,seller_type))
    return oid


def _prudent_sale(product_id:str,haircut_pct:float=15) -> tuple[float|None,list[str]]:
    ask=core.latest_price(product_id,'ASK')
    sale=sales_stats(product_id,90)
    ask_fresh=ask and 0<=core.age_days(ask['date'])<=7
    value=ask['price']*(1-haircut_pct/100) if ask_fresh else None
    notes=[]
    if not ask_fresh:
        notes.append('pas de cotation ASK fraîche (< 8 jours)')
    if sale['count']>=3 and sale['cautious'] is not None:
        comparable=sale['cautious']*.95
        value=min(value,comparable) if value is not None else comparable
    else:
        notes.append('moins de 3 ventes vérifiées')
    return value,notes


def tracked_online_offers(product_id=None,fee_pct=5,haircut_pct=15,fixed_cost=3,
                          min_margin_pct=20) -> list[dict]:
    with core.connect() as db:
        rows=db.execute('''SELECT o.*,p.name product_name,p.reprint_risk
            FROM online_offers o JOIN products p ON p.id=o.product_id
            WHERE (? IS NULL OR o.product_id=?) ORDER BY o.observed_at DESC,o.id DESC''',
            (product_id,product_id)).fetchall()
    results=[]
    cached={}
    for r in rows:
        pid=r['product_id']
        if pid not in cached:
            cached[pid]=_prudent_sale(pid,haircut_pct)
        estimate,notes=cached[pid]
        unit_total=(r['price']+r['shipping'])/r['quantity']
        ref_retail=get_product_metadata(pid)['retail_price']
        retail_deviation=(100*(unit_total/ref_retail-1) if ref_retail else None)
        net=(estimate*(1-fee_pct/100)-fixed_cost) if estimate is not None else None
        gain=net-unit_total if net is not None else None
        margin=100*gain/unit_total if gain is not None else None
        max_buy=((estimate*(1-fee_pct/100)-fixed_cost)/(1+min_margin_pct/100)) if estimate is not None else None
        reasons=list(notes)
        if retail_deviation is not None and retail_deviation>15:
            reasons.append('prix supérieur de plus de 15 % au prix public indicatif saisi')
        if r['seller_type'] != 'enseigne':
            reasons.append('vendeur non confirmé comme enseigne directe')
        if r['stock_status'] != 'disponible affiché':
            reasons.append('stock non affiché disponible')
        if r['quantity']>1:
            reasons.append('lot : vérifier que chaque unité est identique et revendable séparément')
        if r['condition'] != 'scellé vérifié':
            reasons.append('état du scellé non confirmé')
        if r['language'] != 'FR vérifié':
            reasons.append('langue française non confirmée')
        if r['reprint_risk'] in ('élevé','inconnu'):
            reasons.append('risque de réimpression élevé ou inconnu')
        try:
            age_hours=(core.now()-datetime.fromisoformat(r['observed_at'])).total_seconds()/3600
        except (ValueError,TypeError):
            age_hours=1e6
        if age_hours>24:
            reasons.append('relevé de prix / stock datant de plus de 24 heures')
        label=('À vérifier avant achat' if margin is not None and margin>=min_margin_pct
               else 'Données insuffisantes' if margin is None else 'Écart insuffisant')
        # Never mark as a confirmed arbitrage by merely reading/entering stock online.
        results.append({'ID':r['id'],'Produit':r['product_name'],
            'Source':SOURCE_BY_ID[r['source_id']].name,'Prix (€)':r['price'],
            'Port (€)':r['shipping'],'Unités':r['quantity'],
            'Coût / unité (€)':round(unit_total,2),
            'Prix public indicatif (€)':ref_retail,
            'Écart au public (%)':round(retail_deviation,1) if retail_deviation is not None else None,
            'Revente prudente (€)':round(estimate,2) if estimate is not None else None,
            'Gain estimé / unité (€)':round(gain,2) if gain is not None else None,
            'Marge estimée (%)':round(margin,1) if margin is not None else None,
            'Achat max. / unité (€)':round(max_buy,2) if max_buy is not None else None,
            'Vendeur':r['seller_type'],'Stock affiché':r['stock_status'],
            'État':r['condition'],'Langue':r['language'],
            'Relevé':r['observed_at'],'Fiche':r['url'],
            'Analyse':label,'À contrôler':' ; '.join(reasons),
            'Notes':r['notes']})
    return sorted(results,key=lambda r:(r['Marge estimée (%)'] is not None,
             r['Marge estimée (%)'] or -1e9),reverse=True)


def export_online_csv(product_id=None,**kwargs)->bytes:
    data=tracked_online_offers(product_id,**kwargs)
    buf=io.StringIO()
    columns=['ID','Produit','Source','Prix (€)','Port (€)','Unités','Coût / unité (€)',
       'Prix public indicatif (€)','Écart au public (%)','Revente prudente (€)','Gain estimé / unité (€)','Marge estimée (%)',
       'Achat max. / unité (€)','Vendeur','Stock affiché','État','Langue','Relevé',
       'Fiche','Analyse','À contrôler','Notes']
    writer=csv.DictWriter(buf,fieldnames=columns,delimiter=';')
    writer.writeheader()
    for r in data:
        # Avoid spreadsheet formula injection from manually entered fields.
        writer.writerow({k:("'"+str(v) if isinstance(v,str) and v.lstrip().startswith(('=','+','-','@'))
                     else v) for k,v in r.items()})
    return buf.getvalue().encode('utf-8-sig')


def mobile_catalog_html(initial_query='Pokémon coffret 30 ans FR') -> str:
    """Standalone, offline, phone-friendly link search for every registered source.

    JavaScript builds *outbound search links only*. It does not request stock/prices,
    store credentials, or auto-purchase products.
    """
    import json
    from html import escape
    q = clean_query(initial_query)
    data = [dict(id=s.id,name=s.name,group=s.group,site=s.site,
                 domain=s.domain,strategy=s.strategy,local=s.local,
                 warning=s.warning) for s in SOURCES]
    # Script end tags must not be injectable, even in an otherwise escaped query.
    data_json = json.dumps(data,ensure_ascii=False).replace('<','\\u003c')
    q_json = json.dumps(q,ensure_ascii=False).replace('<','\\u003c')
    return '''<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PokéRadar — liens Pokémon</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
*{box-sizing:border-box}body{margin:0;background:#080f1e;color:#eff6ff}
main{width:min(1080px,94vw);margin:auto;padding:34px 0 90px}
h1{font-size:clamp(2rem,6vw,3.2rem);margin:12px 0}h2{margin:28px 0 14px;font-size:1.3rem}
small,.muted{color:#9cb0ca}p{line-height:1.55}input{font-size:1rem;background:#101d32;
color:#fff;border:1px solid #34475f;padding:15px;border-radius:13px;width:100%}
.controls{display:flex;flex-wrap:wrap;gap:9px;margin:15px 0}
.chip{border:1px solid #33445a;background:#18243a;color:#dbeafe;border-radius:99px;padding:9px 13px;
cursor:pointer;font-size:.9rem}
.chip.active{border-color:#55b0fa;background:#163963}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(235px,1fr));gap:13px}
.card{background:#101b2d;border:1px solid #293a50;border-radius:17px;padding:16px;display:flex;
flex-direction:column;gap:9px;min-height:150px}
.card header{display:flex;justify-content:space-between;gap:8px;font-weight:700}
.card .group{font-size:.75rem;color:#91bdf7}
.card .warn{font-size:.81rem;color:#a8b5c5;line-height:1.4;flex:1}
.links{display:flex;gap:8px;flex-wrap:wrap}
a{color:#dbeafe;text-decoration:none}.buy{display:inline-block;background:#1769a5;
padding:9px 11px;border-radius:9px;font-weight:700;font-size:.87rem}
a.secondary{background:#233247}.notice{border-left:3px solid #ffcd74;padding:10px 13px;
background:#2b281e;border-radius:8px;color:#e7d5af}
</style></head><body><main>
<p class="muted">🔎 POKÉRADAR • PORTAIL D’ACHAT — UTILISABLE SANS SERVEUR</p>
<h1>Où trouver tes produits Pokémon ?</h1>
<p>27 liens de recherche vers les grandes enseignes, boutiques TCG, marchés secondaires et sites de veille. Saisis le produit exact, sa langue ou son EAN.</p>
<label for="search">Produit / mot-clé / EAN</label><input id="search" type="search" autocomplete="off" aria-label="Produit Pokémon">
<div id="filters" class="controls" aria-label="Catégories de boutiques"></div>
<div class="notice">Les liens ne confirment ni prix ni disponibilité. Vérifie toujours la langue, la version, le vendeur, les frais et la possibilité de retrait avant de te déplacer.</div>
<p id="counter" class="muted"></p><section id="items" class="grid" aria-live="polite"></section>
<p class="muted">Source : liens vers des sites externes. Projet indépendant, non affilié à Pokémon ou aux commerçants. Aucun achat automatique.</p>
</main><script>
const sources = __DATA__;
const input = document.getElementById('search'), filters = document.getElementById('filters');
const items = document.getElementById('items'), counter = document.getElementById('counter');
let active = 'Toutes';
input.value = __QUERY__;
function link(s, q) {
  const enc = encodeURIComponent(q);
  if(s.strategy==='amazon')return 'https://www.amazon.fr/s?k='+enc;
  if(s.strategy==='fnac')return 'https://www.fnac.com/SearchResult/ResultList.aspx?Search='+enc;
  if(s.strategy==='ebay')return 'https://www.ebay.fr/sch/i.html?_nkw='+enc;
  if(s.strategy==='cardmarket')return 'https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString='+enc;
  if(s.strategy==='vinted')return 'https://www.vinted.fr/catalog?search_text='+enc;
  if(s.strategy==='leboncoin')return 'https://www.leboncoin.fr/recherche?text='+enc;
  if(s.strategy==='category')return s.site;
  return 'https://www.google.com/search?q='+encodeURIComponent('site:'+s.domain+' '+q);
}
function el(tag, cls, txt) {const x=document.createElement(tag);if(cls)x.className=cls;
  if(txt!==undefined)x.textContent=txt;return x;}
function anchor(label,href,secondary=false){const a=el('a',secondary?'buy secondary':'buy',label);
  a.href=href;a.rel='noopener noreferrer';a.target='_blank';return a;}
function render(){
  const q=input.value.trim().slice(0,160);items.replaceChildren();
  const list=sources.filter(s=>active==='Toutes'||s.group===active);
  counter.textContent=list.length+' sources • '+(q?'Liens prêts pour « '+q+' »':'Saisis une recherche');
  for(const s of list){const card=el('article','card'),header=el('header');
    header.append(el('span','',s.name),el('span','group',s.group));card.append(header);
    card.append(el('div','warn',s.warning||'Confirmer prix, stock, vendeur et livraison.'));
    const links=el('div','links');if(q)links.append(anchor('Chercher →',link(s,q)));
    links.append(anchor('Site',s.site,true));
    if(s.local)links.append(anchor('Près de moi','https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(s.name+' près de Suresnes'),true));
    card.append(links);items.append(card);
  }
}
for(const group of ['Toutes',...new Set(sources.map(s=>s.group))]){
  const b=el('button','chip'+(group===active?' active':''),group);b.type='button';
  b.addEventListener('click',()=>{active=group;for(const child of filters.children)child.classList.toggle('active',child.textContent===group);render()});filters.append(b);
}
input.addEventListener('input',render);render();
</script></body></html>'''.replace('__DATA__',data_json).replace('__QUERY__',q_json)
