import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import core

class RadarTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old = core.DB_PATH
        core.DB_PATH = Path(self.temp.name)/'test.db'
        core.init_db()
        core.add_store('store-test','Magasin test','Centre local',30)
        self.oid=core.add_offer('etb-30-ans','store-test','https://example.org/item',
                 'manual',price=50,seller_verified=True)

    def tearDown(self):
        core.DB_PATH = self.old
        self.temp.cleanup()

    def test_price_parse(self):
        self.assertEqual(core._parse_euro('78,99 €'),78.99)
        self.assertEqual(core._parse_euro('1 234,50 €'),1234.5)
        self.assertEqual(core._parse_euro('aucun prix'),None)

    def test_ask_is_not_sale(self):
        core.save_quote('etb-30-ans',100,'marché','ASK')
        self.assertIsNone(core.latest_price('etb-30-ans','SOLD'))
        r=core.opportunities()[0]
        self.assertEqual(r['confidence'],'faible')
        self.assertGreater(r['margin'],0)
        self.assertEqual(r['max_buy'],64.79)  # 100 * .85 * .95 - 3, then / 1.2

    def test_stock_transition_and_prediction_cautious(self):
        first, _ = core.record_check(self.oid,'indisponible',50,'manuel')
        self.assertEqual(first,'inchangé')
        second,event_id = core.record_check(self.oid,'disponible',50,'appel')
        self.assertEqual(second,'restock')
        self.assertIsInstance(event_id,int)
        third, _ = core.record_check(self.oid,'disponible',50,'appel')
        self.assertEqual(third,'inchangé')
        self.assertEqual(core.forecast_slots(self.oid)['status'],'données insuffisantes')

    def test_no_false_buy_without_market(self):
        core.record_check(self.oid,'disponible',50,'appel')
        r=core.opportunities()[0]
        self.assertEqual(r['label'],'DONNÉES INSUFFISANTES')

    def test_html_requires_strict_selector(self):
        with self.assertRaises(ValueError):
            core.add_offer('etb-30-ans','store-test','https://example.org','html')

if __name__=='__main__':
    unittest.main()
