import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock,patch

import core
import intelligence as intel


class IntelligenceTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.saved=core.DB_PATH
        core.DB_PATH=Path(self.tmp.name)/'test.db'
        core.init_db()
        core.add_store('central','Magasin fictif','Adresse fictive',25)
        self.offer=core.add_offer('etb-30-ans','central','https://example.org/pokemon',
                                  'manual',price=50,seller_verified=True)

    def tearDown(self):
        core.DB_PATH=self.saved
        self.tmp.cleanup()

    def test_migrations_are_idempotent_and_disabled_api(self):
        core.init_db()
        with core.connect() as db:
            rows=db.execute('SELECT id,api_enabled FROM products').fetchall()
            self.assertTrue(rows)
            self.assertTrue(all(not r['api_enabled'] for r in rows))
            columns={r['name'] for r in db.execute('PRAGMA table_info(offers)')}
        self.assertIn('last_status_at',columns)

    def test_unknown_scan_does_not_create_fake_restock(self):
        core.record_check(self.offer,'disponible',50,'appel')
        state,_=core.record_check(self.offer,'inconnu',50,'HTML erreur 403')
        self.assertEqual(state,'inchangé')
        state,_=core.record_check(self.offer,'disponible',50,'appel')
        self.assertEqual(state,'inchangé')
        with core.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) n FROM restock_events').fetchone()['n'],1)
            r=db.execute('SELECT last_status,last_known_method FROM offers').fetchone()
            self.assertEqual(r['last_status'],'disponible')
            self.assertEqual(r['last_known_method'],'appel')

    def test_price_drop_only_with_explicit_available_observation(self):
        core.record_check(self.offer,'indisponible',50,'appel')
        core.record_check(self.offer,'inconnu',40,'HTML err')
        with core.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) n FROM price_drop_events').fetchone()['n'],0)
        core.record_check(self.offer,'disponible',35,'appel')
        with core.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) n FROM price_drop_events').fetchone()['n'],1)

    def test_unverified_sales_not_used_as_transaction_proof(self):
        today=core.now().date().isoformat()
        intel.add_sale('etb-30-ans',today,110,'eBay','tx1',reviewed=False)
        self.assertEqual(intel.sales_stats('etb-30-ans')['count'],0)
        self.assertEqual(intel.sales_stats('etb-30-ans')['unchecked_count'],1)
        with self.assertRaises(ValueError):
            intel.add_sale('etb-30-ans',today,100,'eBay','tx2',reviewed=True)

    def test_verified_sale_reference_conservative_and_duplicate_proof(self):
        today=core.now().date().isoformat()
        core.save_quote('etb-30-ans',150,'Marché ASK','ASK')
        for i,p in enumerate((90,100,120,110,80)):
            good=intel.add_sale('etb-30-ans',today,p,'eBay' if i%2 else 'Vinted',
                          'tx'+str(i),'https://example.org/sale/'+str(i),reviewed=True)
            self.assertTrue(good)
        self.assertFalse(intel.add_sale('etb-30-ans',today,80,'Vinted','tx4',
                               'https://example.org/sale/4',reviewed=True))
        stats=intel.sales_stats('etb-30-ans')
        self.assertEqual(stats['count'],5)
        self.assertEqual(stats['median'],100)
        self.assertEqual(stats['cautious'],90)
        r=core.opportunities()[0]
        self.assertEqual(r['expected_sale'],85.5)  # 2nd lowest sale * 0.95
        self.assertEqual(r['confidence'],'moyenne')
        self.assertEqual(r['verified_sales_90d'],5)
        self.assertLess(r['expected_sale'],150)

    def test_csv_import_duplicates_and_evidence_guard(self):
        today=core.now().date().isoformat()
        lines=(f'product_id;sale_date;price;source;sale_ref;evidence_url;reviewed;notes\n'
               f'etb-30-ans;{today};90,50;eBay;tx1;https://example.org/1;oui;ok\n'
               f'etb-30-ans;{today};91,00;eBay;tx1;https://example.org/1;oui;duplicate\n'
               f'etb-30-ans;{today};78,00;eBay;tx2;;oui;no proof\n'
               f'etb-30-ans;{today};80,00;eBay;tx3;;non;unverified\n'
               f'unknown;{today};80,00;eBay;tx4;;non;bad id\n')
        report=intel.import_sales_csv(lines.encode('utf-8-sig'))
        self.assertEqual((report['imported'],report['duplicates'],report['rejected']),(2,1,2))
        self.assertEqual(intel.sales_stats('etb-30-ans')['count'],1)

    def test_api_opt_in_and_daily_throttle_even_when_stale_date(self):
        response=Mock()
        response.json.return_value={'currency':'EUR','price':120,'date':(core.now().date()-__import__('datetime').timedelta(days=1)).isoformat(),'source':'ebay'}
        response.raise_for_status.return_value=None
        session=Mock()
        session.get.return_value=response
        with patch.dict('os.environ',{'POKEINDEX_API_KEY':'test'},clear=False):
            with patch('requests.Session',return_value=session),patch('time.sleep'):
                self.assertIn('Aucun produit',core.market_sync()[0])
                with core.connect() as db:
                    db.execute("UPDATE products SET api_enabled=1 WHERE id='etb-30-ans'")
                logs=core.market_sync()
                self.assertIn('120',str(logs))
                self.assertEqual(session.get.call_count,1)
                core.market_sync()
                self.assertEqual(session.get.call_count,1)

    def test_api_history_requires_additional_approval(self):
        response=Mock()
        response.json.return_value={'currency':'EUR','price':90,'date':core.now().date().isoformat(),'source':'vinted'}
        response.raise_for_status.return_value=None
        session=Mock(get=Mock(return_value=response))
        with core.connect() as db:
            db.execute("UPDATE products SET api_enabled=1 WHERE id='etb-30-ans'")
        with patch.dict('os.environ',{'POKEINDEX_API_KEY':'test', 'POKERADAR_APPROVE_HISTORY_CREDITS':''},clear=False):
            with patch('requests.Session',return_value=session),patch('time.sleep'):
                logs=core.market_sync(include_history=True)
        self.assertEqual(session.get.call_count,1)
        self.assertIn('NON importé',str(logs))

    def test_calendar_needs_url(self):
        with self.assertRaises(ValueError):
            intel.add_calendar_event('etb-30-ans',(core.now().date()+__import__('datetime').timedelta(days=10)).isoformat(),'réassort annoncé','')
        intel.add_calendar_event('etb-30-ans',(core.now().date()+__import__('datetime').timedelta(days=10)).isoformat(),'sortie',
                                 'https://example.org/official-source')
        self.assertEqual(len(intel.upcoming_events(120)),1)

    def test_call_queue_is_only_research_list(self):
        queue=intel.call_queue(60)
        self.assertEqual(len(queue),1)
        self.assertEqual(queue[0]['statut_historique'],'inconnu')
        csvdata=intel.export_call_csv()
        self.assertIn('magasin',csvdata.decode('utf-8-sig'))


if __name__=='__main__':
    unittest.main()

class StockTextTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.old=core.DB_PATH
        core.DB_PATH=Path(self.tmp.name)/'test.db'
        core.init_db()
        core.add_store('shop','Shop','Ville',10)
        self.oid=core.add_offer('etb-30-ans','shop','https://example.org/item',
                                 'html',price=50,stock_selector='.stock')

    def tearDown(self):
        core.DB_PATH=self.old
        self.tmp.cleanup()

    def _scan(self,stock_html):
        with core.connect() as db:
            row=db.execute('SELECT * FROM offers WHERE id=?',(self.oid,)).fetchone()
        response=Mock(status_code=200,text=f'<div class="stock">{stock_html}</div>')
        response.raise_for_status=Mock()
        with patch.object(core,'_robots_allow',return_value=True),patch('requests.get',return_value=response):
            return core.scan_one_html(row)[0]

    def test_exact_status_text(self):
        self.assertEqual(self._scan('indisponible'),'indisponible')
        self.assertEqual(self._scan('non disponible'),'indisponible')
        self.assertEqual(self._scan('plus disponible'),'indisponible')
        self.assertEqual(self._scan('en stock'),'disponible')
        self.assertEqual(self._scan('en stock mais plus disponible'),'inconnu')
        self.assertEqual(self._scan('livraison sous réserve'),'inconnu')

class RobotsTest(unittest.TestCase):
    def test_robots_disallow_and_fail_closed(self):
        response=Mock(status_code=200,text='User-agent: *\nDisallow: /private')
        with patch('requests.get',return_value=response):
            self.assertFalse(core._robots_allow('https://example.org/private/p'))
            self.assertTrue(core._robots_allow('https://example.org/public/p'))
        self.assertFalse(core._robots_allow('https://127.0.0.1/'))
        self.assertFalse(core._robots_allow('http://example.org/p'))
        with patch('requests.get',side_effect=__import__('requests').Timeout):
            self.assertFalse(core._robots_allow('https://example.org/p'))
