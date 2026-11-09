"""Tests for manual drawing links and follow-up notes (no external HTTP calls)."""
import tempfile
import os
import unittest
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from unittest.mock import patch
import core
import raffles
import build_mobile


class TestRaffles(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.path=Path(self.folder.name)/'test.db'
        self.patcher=patch.object(core,'DB_PATH',self.path)
        self.patcher.start()
        core.init_db()

    def tearDown(self):
        self.patcher.stop()
        self.folder.cleanup()

    def test_no_open_on_unknown_amazon(self):
        amazon=next(r for r in raffles.RAFFLES if r.id=='amazon-invitation-30ans')
        self.assertEqual(raffles.status(amazon,datetime(2026,11,6,23,0,tzinfo=ZoneInfo('Europe/Paris'))),'à vérifier')

    def test_expired_fnac_is_closed(self):
        fnac=next(r for r in raffles.RAFFLES if r.id=='fnac-2026-11-06')
        self.assertEqual(raffles.status(fnac,datetime(2026,11,6,23,0,tzinfo=ZoneInfo('Europe/Paris'))),'clos')

    def test_micromania_expired(self):
        micro=next(r for r in raffles.RAFFLES if r.id=='micro-2026-11-06')
        self.assertEqual(raffles.status(micro,datetime(2026,11,6,23,0,tzinfo=ZoneInfo('Europe/Paris'))),'clos')

    def test_contest_future_then_closed(self):
        contest=next(r for r in raffles.RAFFLES if r.id=='coin-tcg-2026-11-10')
        self.assertEqual(raffles.status(contest,datetime(2026,11,9,20,tzinfo=ZoneInfo('Europe/Paris'))),'ouvert signalé')
        self.assertEqual(raffles.status(contest,datetime(2026,11,11,0,tzinfo=ZoneInfo('Europe/Paris'))),'clos')

    def test_valid_links_https(self):
        self.assertTrue(all(raffles.https_link(r.url) and raffles.https_link(r.source_url) for r in raffles.RAFFLES))
        self.assertFalse(raffles.https_link('javascript:alert(1)'))
        self.assertFalse(raffles.https_link('https://evil.example@fnac.com'))

    def test_private_participation_persist(self):
        rid='fnac-2026-11-06'
        raffles.save_participation(rid,'Inscrit','Mon propre numéro de dossier sans secret')
        result={r['id']:r for r in raffles.listed()}[rid]
        self.assertEqual(result['participation'],'Inscrit')
        raffles.save_participation(rid,'Non retenu','')
        self.assertEqual({r['id']:r for r in raffles.listed()}[rid]['participation'],'Non retenu')

    def test_invalid_state_rejected(self):
        with self.assertRaises(ValueError):
            raffles.save_participation('fnac-2026-11-06','Gagnant automatiquement')

    def test_custom_raffle_cannot_say_live_unverified(self):
        raffles.add_custom('Enseigne perso','À surveiller','https://www.fnac.com/',deadline='2026-11-28T18:00:00+01:00')
        data=next(r for r in raffles.listed(when=datetime(2026,11,6,23,tzinfo=ZoneInfo('Europe/Paris'))) if r['id'].startswith('custom-'))
        self.assertEqual(data['status'],'à vérifier')
        self.assertEqual(data['category'],'Accès à l’achat')

    def test_custom_rejects_unsafe_url(self):
        with self.assertRaises(ValueError):
            raffles.add_custom('Bad','Bad','http://example.com')

    def test_calendar_export_only_future_access_deadlines(self):
        raffles.add_custom('Future','test','https://example.org','',deadline='2026-11-22T16:00:00+01:00')
        payload=raffles.deadline_ics(raffles.listed(when=datetime(2026,11,6,23,tzinfo=ZoneInfo('Europe/Paris'))),
                    datetime(2026,11,6,23,tzinfo=ZoneInfo('Europe/Paris'))).decode()
        self.assertIn('Future',payload)
        self.assertNotIn('Fnac',payload)
        self.assertNotIn('Le Coin',payload)
        self.assertIn('BEGIN:VCALENDAR',payload)

    def test_mobile_portal_includes_all_categories(self):
        text=build_mobile.build_html()
        self.assertIn('Fnac',text)
        self.assertIn('Micromania',text)
        self.assertIn('Amazon.fr',text)
        self.assertIn('Mes disponibilités',text)
        self.assertIn('Rentabilité',text)
        self.assertIn('Aucun stock connu n',text)

if __name__=='__main__':unittest.main()
