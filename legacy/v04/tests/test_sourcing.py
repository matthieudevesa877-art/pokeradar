"""No tests contact a retailer or external source."""
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import core
import sourcing


class SourcingTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.saved=core.DB_PATH
        core.DB_PATH=Path(self.temp.name)/'test.db'
        core.init_db()

    def tearDown(self):
        core.DB_PATH=self.saved
        self.temp.cleanup()

    def test_sources_unique_and_compatible(self):
        self.assertGreaterEqual(len(sourcing.SOURCES),25)
        self.assertEqual(len(sourcing.SOURCES),len(set(s.id for s in sourcing.SOURCES)))
        for src in sourcing.SOURCES:
            self.assertEqual(urlparse(src.site).scheme,'https')
            self.assertEqual(urlparse(sourcing.search_url(src.id,'Pokémon ME06 FR')).scheme,'https')

    def test_search_url_encoding_and_source_categories(self):
        query='Pokémon Coffret 30 ans & FR'
        amazon=sourcing.search_url('amazon',query)
        self.assertEqual(parse_qs(urlparse(amazon).query)['k'],[query])
        self.assertEqual(parse_qs(urlparse(sourcing.search_url('fnac',query)).query)['Search'],[query])
        google=sourcing.search_url('cultura',query)
        self.assertIn('site:cultura.com',parse_qs(urlparse(google).query)['q'][0])
        self.assertNotIn('amazon.fr',google)
        local=sourcing.search_links(query,local_only=True)
        self.assertTrue(local)
        self.assertTrue(all(v['Magasins physiques'] for v in local))
        self.assertFalse(any(v['id']=='amazon' for v in local))
        with self.assertRaises(ValueError):
            sourcing.maps_url('amazon')
        with self.assertRaises(ValueError):
            sourcing.search_url('fnac','    ')

    def test_ean_and_public_price_are_user_entered(self):
        before=sourcing.get_product_metadata('etb-30-ans')
        self.assertIsNone(before['retail_price'])
        sourcing.save_product_metadata('etb-30-ans','0196214111028','ETB 30th anniversaire',54.99)
        after=sourcing.get_product_metadata('etb-30-ans')
        self.assertEqual(after['ean'],'0196214111028')
        self.assertEqual(after['retail_price'],54.99)
        with self.assertRaises(ValueError):
            sourcing.save_product_metadata('etb-30-ans','ABC',retail_price=42)
        with self.assertRaises(ValueError):
            sourcing.save_product_metadata('etb-30-ans','0123456789012',retail_price=-10)

    def test_save_online_and_update_snapshot_without_duplicate(self):
        oid=sourcing.save_online_offer('etb-30-ans','fnac','https://www.fnac.com/a1234',60,5,
                                       1,'enseigne','scellé vérifié','disponible affiché','FR vérifié')
        same=sourcing.save_online_offer('etb-30-ans','fnac','https://www.fnac.com/a1234',52,3,
                                       1,'enseigne','scellé vérifié','indisponible affiché','FR vérifié')
        self.assertEqual(oid,same)
        with core.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) n FROM online_offers').fetchone()['n'],1)
            self.assertEqual(db.execute('SELECT COUNT(*) n FROM online_offer_history').fetchone()['n'],2)
            self.assertEqual(db.execute('SELECT price FROM online_offers').fetchone()['price'],52)
        data=sourcing.tracked_online_offers()
        self.assertEqual(data[0]['Coût / unité (€)'],55)
        self.assertIsNone(data[0]['Marge estimée (%)'])
        self.assertIn('Données insuffisantes',data[0]['Analyse'])

    def test_bad_link_rejected_and_no_external_io(self):
        for bad in ('http://www.amazon.fr/dp/AAA',
                    'javascript:alert(1)',
                    'https://www.amazon.fr.evil.example/dp/A',
                    'https://evil.example/dp/A',
                    'https://user:pass@www.amazon.fr/dp/A',
                    'https://www.amazon.fr:8080/dp/A',
                    'https://www.amazon.fr/dp/A#secret'):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    sourcing.save_online_offer('etb-30-ans','amazon',bad,50)
        with self.assertRaises(ValueError):
            sourcing.save_online_offer('etb-30-ans','amazon','https://www.amazon.fr/dp/A',float('nan'))
        with self.assertRaises(ValueError):
            sourcing.save_online_offer('etb-30-ans','amazon','https://www.amazon.fr/dp/A',50,-1)

    def test_fee_shipping_and_unit_calculations(self):
        core.save_quote('etb-30-ans',100,'Prix demandé du marché','ASK')
        sourcing.save_online_offer('etb-30-ans','fnac','https://www.fnac.com/a1234',120,10,2,
                                   'enseigne','scellé vérifié','disponible affiché','FR vérifié')
        row=sourcing.tracked_online_offers(fee_pct=5,haircut_pct=15,fixed_cost=3,
                                           min_margin_pct=20)[0]
        # Cost per copy (120 + 10)/2=65, safe selling ref 85, after fees/fixed 77.75.
        self.assertEqual(row['Coût / unité (€)'],65)
        self.assertEqual(row['Revente prudente (€)'],85)
        self.assertEqual(row['Gain estimé / unité (€)'],12.75)
        self.assertAlmostEqual(row['Marge estimée (%)'],19.6)
        self.assertIn('lot : vérifier',row['À contrôler'])
        self.assertNotEqual(row['Analyse'],'achat certain')

    def test_price_and_stock_are_not_fetched_automatically(self):
        # Storing an observed link is separate from manually confirmed local stock.
        sourcing.save_online_offer('etb-30-ans','amazon','https://www.amazon.fr/dp/B0000000',39.99,
            seller_type='tiers',stock_status='disponible affiché')
        with core.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) n FROM checks').fetchone()['n'],0)
            self.assertEqual(db.execute('SELECT COUNT(*) n FROM restock_events').fetchone()['n'],0)
        self.assertIn('vendeur non confirmé',sourcing.tracked_online_offers()[0]['À contrôler'])

    def test_csv_is_safe_and_utf8(self):
        sourcing.save_online_offer('etb-30-ans','ebay','https://www.ebay.fr/itm/12345',25,
                                   notes='=HYPERLINK("evil")')
        result=sourcing.export_online_csv()
        self.assertTrue(result.startswith(b'\xef\xbb\xbf'))
        self.assertIn("'=HYPERLINK",result.decode('utf-8-sig'))


    def test_retail_reference_is_only_user_entered_and_not_sale(self):
        sourcing.save_product_metadata('etb-30-ans',retail_price=50)
        sourcing.save_online_offer('etb-30-ans','fnac','https://www.fnac.com/a12345',100,10)
        result=sourcing.tracked_online_offers()[0]
        self.assertEqual(result['Prix public indicatif (€)'],50)
        self.assertEqual(result['Écart au public (%)'],120)
        self.assertIn('supérieur de plus de 15 %',result['À contrôler'])
        self.assertIsNone(result['Revente prudente (€)'])

    def test_mobile_page_has_safe_preloaded_links(self):
        html=sourcing.mobile_catalog_html('Pokémon 30 ans FR')
        self.assertIn('Amazon.fr',html)
        self.assertIn('Smyths Toys',html)
        self.assertIn('input.addEventListener',html)
        self.assertIn('https://www.google.com/search',html)
        hostile=sourcing.mobile_catalog_html('</script><script>alert(1)</script>')
        self.assertNotIn('</script><script>alert(1)',hostile)

    def test_new_tables_exist_after_migration(self):
        core.init_db()
        with core.connect() as db:
            for name in ('sourcing_metadata','online_offers','online_offer_history'):
                self.assertIsNotNone(db.execute(
                   'SELECT name FROM sqlite_master WHERE type="table" AND name=?',(name,)).fetchone())


if __name__ == '__main__':
    unittest.main()
