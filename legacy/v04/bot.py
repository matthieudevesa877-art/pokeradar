"""PokéRadar CLI. All API calls and scans are opt-in/configured."""
import argparse
import json
import time
from pathlib import Path
from dotenv import load_dotenv
load_dotenv()

import core
import intelligence as intel


def run(include_history=False):
    core.init_db()
    print(f'[{core.iso()}] --- Cotations API : produits explicitement activés ---',flush=True)
    for line in core.market_sync(include_history):
        print(line,flush=True)
    print(f'[{core.iso()}] --- Contrôles HTML publics configurés ---',flush=True)
    logs=core.scan_html_offers()
    for line in logs if logs else ['Aucune offre HTML configurée; aucun stock consulté']:
        print(line,flush=True)
    path=core.BASE/'analyse_pokeradar.json'
    core.export_report(path)
    print('Rapport actualisé :',path,flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description='PokéRadar v0.2 : marché Pokémon JCC, magasins, alertes')
    mode=parser.add_mutually_exclusive_group()
    mode.add_argument('--once',action='store_true',help='Une passe API & HTML, si configurés')
    mode.add_argument('--loop',action='store_true',help='Une passe toutes les 20 minutes (Mac allumé)')
    mode.add_argument('--report',action='store_true',help='Rapport local JSON sans réseau')
    mode.add_argument('--calls',action='store_true',help='Liste de magasins à appeler CSV sur stdout')
    mode.add_argument('--import-sales',type=Path,metavar='FICHIER.csv',help='Import de ventes déjà vérifiées')
    mode.add_argument('--discover',type=int,metavar='N',help='Catalogue API payant, N produits, max 50')
    parser.add_argument('--history',action='store_true',help='Historique API payant, nécessite en plus accord dans .env')
    parser.add_argument('--confirm-api-cost',action='store_true',help='Accord explicite pour --discover')
    args=parser.parse_args()
    core.init_db()
    if args.report:
        path=core.BASE/'analyse_pokeradar.json'
        core.export_report(path)
        print(path)
    elif args.calls:
        import sys
        sys.stdout.buffer.write(intel.export_call_csv())
    elif args.import_sales:
        result=intel.import_sales_csv(args.import_sales.read_bytes())
        print(json.dumps(result,ensure_ascii=False,indent=2))
    elif args.discover is not None:
        if not args.confirm_api_cost:
            parser.error('Pour --discover, ajouter --confirm-api-cost (API facturée par produit)')
        print(json.dumps(intel.catalog_discovery(args.discover),ensure_ascii=False,indent=2))
    elif args.loop:
        try:
            while True:
                run(False)
                time.sleep(20*60)
        except KeyboardInterrupt:
            print('Surveillance locale interrompue')
    else:
        run(args.history)
