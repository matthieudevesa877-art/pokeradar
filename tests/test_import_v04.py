import hashlib
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import core
import intelligence
import raffles
import sourcing

from tools.import_v04 import build_backup


class ImportV04Test(unittest.TestCase):
    def test_preserves_provenance_and_reads_real_schema_without_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / 'historique.db'
            sample_time = datetime(2026, 11, 7, 12, tzinfo=timezone.utc)
            with patch.object(core, 'DB_PATH', database), patch.object(core, 'now', return_value=sample_time):
                core.init_db()
                product = 'etb-30-ans'
                url = 'https://www.fnac.com/'
                offer = core.add_offer(product, 'fnac-defense', url=url)
                core.record_check(offer, 'indisponible', 69.99, 'saisie manuelle non confirmée')
                core.record_check(offer, 'disponible', 69.99, 'HTML public / indication non garantie')
                core.save_quote(product, 79, 'Marché exemple', 'SOLD', '2026-11-04')
                intelligence.add_sale(product, '2026-11-05', 82, 'Plateforme', 'preuve', url, reviewed=True)
                intelligence.add_sale(product, '2026-11-05', 98, 'Plateforme', 'à-confirmer')
                sourcing.save_online_offer(product, 'fnac', url, 100, 5, quantity=2)
                intelligence.add_calendar_event(product, '2026-11-27', 'sortie', url, 'Date annoncée')
                raffle = raffles.add_custom('Fnac', 'Campagne test', url, 'Fnac+')
                raffles.save_participation(f'custom-{raffle}', 'Inscrit', 'Depuis le Mac')
            original = hashlib.sha256(database.read_bytes()).digest()
            backup = build_backup(database)
            self.assertEqual(backup, build_backup(database))
            self.assertEqual(hashlib.sha256(database.read_bytes()).digest(), original)
            self.assertEqual(len(backup['stocks']), 2)
            self.assertIn('HTML public', backup['stocks'][0]['detail'])
            self.assertEqual([row['kind'] for row in backup['prices']],
                             ['Cote indicative', 'Vente à vérifier', 'Vente réalisée', 'Annonce'])
            self.assertTrue(backup['prices'][-1]['product'].startswith('Lot de 2'))
            self.assertEqual(backup['followed'][0]['id'], backup['customRaffles'][0]['id'])
            self.assertEqual(backup['followed'][0]['note'], 'Depuis le Mac')
            self.assertEqual(backup['calendar'][0]['date'], '2026-11-27')

    def test_refuses_an_unrelated_sqlite_database(self):
        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / 'unrelated.db'
            connection = sqlite3.connect(database)
            connection.execute('CREATE TABLE unrelated (id INTEGER)')
            connection.close()
            with self.assertRaisesRegex(ValueError, 'schéma PokéRadar'):
                build_backup(database)


if __name__ == '__main__':
    unittest.main()
