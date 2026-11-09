"""Convert the user-facing records of a PokéRadar v0.4 SQLite snapshot to JSON."""
from __future__ import annotations

import argparse
import json
import sqlite3
from contextlib import closing
from pathlib import Path
from urllib.parse import urlsplit


STOCK_STATES = {
    'disponible': 'Disponible signalé',
    'indisponible': 'Indisponible signalé',
    'inconnu': 'Inconnu',
}


def https_link(value: str) -> str:
    try:
        url = urlsplit(value.strip())
        if url.scheme == 'https' and url.hostname and not url.username and not url.password:
            return value.strip()
    except ValueError:
        pass
    return ''


def text(value: str, fallback: str, limit: int) -> str:
    return (value.strip() or fallback)[:limit]


def product_name(row: sqlite3.Row, language: str | None = None) -> str:
    # A name can be shared by multiple products. Keep variant, language and
    # original identifier so prices from different references stay separate.
    suffix = f" · {language or row['language']} · {row['variant']} [{row['product_id']}]"
    return text(row['name'], row['product_id'], max(1, 160 - len(suffix))) + suffix[:159]


def build_backup(database: Path) -> dict:
    uri = database.resolve(strict=True).as_uri() + '?mode=ro'
    data = {
        'format': 'pokeradar', 'version': 1, 'stocks': [], 'prices': [], 'alerts': [],
        'followed': [], 'customRaffles': [], 'calendar': [],
    }
    with closing(sqlite3.connect(uri, uri=True)) as db:
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA query_only = ON')
        db.execute('BEGIN')
        tables = {row['name'] for row in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        if not {'products', 'stores', 'offers', 'checks', 'quotes'} <= tables:
            raise ValueError('Cette base SQLite ne présente pas le schéma PokéRadar.')

        for row in db.execute('''
            SELECT c.*, o.url, p.id product_id, p.name, p.language, p.variant, s.name store
            FROM checks c JOIN offers o ON o.id = c.offer_id
            JOIN products p ON p.id = o.product_id JOIN stores s ON s.id = o.store_id
            ORDER BY c.checked_at DESC, c.id DESC
        '''):
            data['stocks'].append({
                'id': f"v04-stock-{row['id']}", 'product': product_name(row),
                'store': text(row['store'], 'Magasin v0.4', 100),
                'state': STOCK_STATES.get(row['status'], 'Inconnu'), 'price': row['price'],
                'method': 'Bot v0.4', 'detail': text(row['method'], 'Vérification v0.4', 300),
                'url': https_link(row['url']), 'checked': row['checked_at'],
            })

        for row in db.execute('''
            SELECT q.*, p.name, p.language, p.variant
            FROM quotes q JOIN products p ON p.id = q.product_id ORDER BY q.quote_date DESC, q.id DESC
        '''):
            data['prices'].append({
                'id': f"v04-cote-{row['id']}", 'product': product_name(row),
                'source': text(row['source'], 'Cote v0.4', 100), 'kind': 'Cote indicative',
                'price': row['price'], 'shipping': None, 'url': '', 'checked': row['quote_date'],
                'detail': f"Cote {row['basis']} du {row['quote_date']} importée du bot v0.4.",
            })

        if 'verified_sales' in tables:
            for row in db.execute('''
                SELECT s.*, p.name, p.language, p.variant FROM verified_sales s
                JOIN products p ON p.id = s.product_id ORDER BY s.sale_date DESC, s.id DESC
            '''):
                url = https_link(row['evidence_url'])
                data['prices'].append({
                    'id': f"v04-vente-{row['id']}", 'product': product_name(row),
                    'source': text(row['source'], 'Vente v0.4', 100),
                    'kind': 'Vente réalisée' if row['reviewed'] and url else 'Vente à vérifier',
                    'price': row['price'], 'shipping': None, 'url': url, 'checked': row['sale_date'],
                    'detail': text(f"Référence v0.4 {row['sale_ref']}. {row['notes']}", 'Vente v0.4', 300),
                })

        if 'online_offers' in tables:
            for row in db.execute('''
                SELECT o.*, p.name, p.language AS offer_language, p.variant
                FROM online_offers o JOIN products p ON p.id = o.product_id
                ORDER BY o.observed_at DESC, o.id DESC
            '''):
                label = product_name(row, row['offer_language'])
                if row['quantity'] > 1:
                    label = text(f"Lot de {row['quantity']} · {label}", label, 160)
                detail = f"{row['language']} · {row['condition']} · {row['stock_status']} · vendeur {row['seller_type']}"
                data['prices'].append({
                    'id': f"v04-offre-{row['id']}-{row['observed_at']}", 'product': label,
                    'source': row['source_id'], 'kind': 'Annonce', 'price': row['price'],
                    'shipping': row['shipping'], 'url': https_link(row['url']), 'checked': row['observed_at'],
                    'detail': text(f"{detail}. {row['notes']}", detail, 300),
                    'outOfStock': row['stock_status'] == 'indisponible affiché',
                })

        if {'online_offers', 'online_offer_history'} <= tables:
            for row in db.execute('''
                SELECT h.*, o.source_id, o.url, p.id product_id, p.name, p.language, p.variant
                FROM online_offer_history h JOIN online_offers o ON o.id = h.online_offer_id
                JOIN products p ON p.id = o.product_id
                WHERE h.observed_at != o.observed_at OR h.price != o.price OR h.shipping != o.shipping
                ORDER BY h.observed_at DESC, h.id DESC
            '''):
                data['prices'].append({
                    'id': f"v04-historique-{row['id']}", 'product': product_name(row),
                    'source': row['source_id'], 'kind': 'Cote indicative',
                    'price': row['price'], 'shipping': row['shipping'], 'url': https_link(row['url']),
                    'checked': row['observed_at'],
                    'detail': 'Historique v0.4. Le conditionnement et la langue de cette offre restent à vérifier.',
                })

        if 'raffle_entries' in tables:
            data['followed'] = [
                {'id': raffle_id(row['raffle_id']), 'status': row['state'], 'note': row['note']}
                for row in db.execute('SELECT * FROM raffle_entries ORDER BY updated_at DESC')
            ]
        if 'custom_raffles' in tables:
            data['customRaffles'] = [
                {'id': raffle_id(f"custom-{row['id']}"), **{key: row[key] for key in
                    ('brand', 'title', 'method', 'url', 'requirements', 'category', 'deadline')}}
                for row in db.execute('SELECT * FROM custom_raffles ORDER BY id DESC')
            ]
        if 'calendar_events' in tables:
            data['calendar'] = [
                {'id': f"v04-date-{row['id']}", 'title': product_name(row), 'date': row['event_date'],
                 'detail': row['event_type'], 'url': row['source_url'],
                 'description': text(row['notes'], 'Annonce importée du bot v0.4.', 500)}
                for row in db.execute('''
                    SELECT e.*, p.name, p.language, p.variant FROM calendar_events e
                    JOIN products p ON p.id = e.product_id ORDER BY e.event_date, e.id
                ''')
            ]
    return data


def raffle_id(key: str) -> str:
    return 'v04-' + key if key.startswith('custom-') else key


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', type=Path, help='Copie de pokeradar.db')
    parser.add_argument('destination', type=Path, help='Nouveau fichier JSON à importer dans PokéRadar')
    args = parser.parse_args()
    try:
        backup = build_backup(args.database)
        payload = json.dumps(backup, ensure_ascii=False, allow_nan=False, indent=2) + '\n'
        with args.destination.open('x', encoding='utf-8') as output:
            output.write(payload)
    except (OSError, sqlite3.Error, ValueError) as error:
        parser.exit(1, f'Import v0.4 interrompu. {error}\n')
    print(f"{len(backup['stocks'])} relevés de stock et {len(backup['prices'])} prix exportés. Base SQLite intacte.")


if __name__ == '__main__':
    main()
