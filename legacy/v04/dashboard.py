"""Run: streamlit run dashboard.py"""
from __future__ import annotations
import os
import sqlite3
from datetime import date
from dotenv import load_dotenv
load_dotenv()

import pandas as pd
import streamlit as st
import core
import intelligence as intel
import sourcing
import raffles

st.set_page_config(page_title='PokéRadar | Marché & Restocks',page_icon='🔎',layout='wide')
st.markdown('''<style>
.stApp { background-color: #0b1120; }
.block-container { padding-top: 1.8rem; }
h1,h2,h3 {letter-spacing:-.035em}
[data-testid="stMetricValue"] {font-size: 2rem}
small {color:#94a3b8}
</style>''',unsafe_allow_html=True)
core.init_db()

st.title('🔎 PokéRadar')
st.caption('Pokémon JCC • prix & revente • stocks suivis • tirages au sort • liens d’achat')
with st.sidebar:
    st.subheader('🎛️ Réglages de calcul')
    max_minutes=st.slider('Transport maximum (minutes)',15,120,60,5)
    min_margin=st.slider('Marge estimée minimale (%)',0,100,20,5)
    haircut=st.slider('Décote de revente prudente (%)',0,40,15,1)
    fees=st.number_input('Frais variables de vente (%)',0.0,30.0,5.0,0.5)
    fixed=st.number_input('Frais fixes estimés (€)',0.0,50.0,3.0,0.5)
    st.caption('Le taux de marge est une simulation brute des impôts éventuels, pas une promesse de gain.')
    st.divider()
    if os.getenv('POKEINDEX_API_KEY'):
        st.success('API configurée (surveillance des produits activés uniquement)')
    else:
        st.info('Pas de clé de prix : saisie manuelle possible.')
    if st.button('Actualiser les prix API',use_container_width=True):
        with st.spinner('Consultation API…'):
            logs=core.market_sync(False)
        st.info('\n\n'.join(logs))
        st.rerun()
    if st.button('Scanner les pages HTML autorisées',use_container_width=True):
        with st.spinner('Vérification respectueuse des pages configurées…'):
            logs=core.scan_html_offers()
        st.info('\n\n'.join(logs) if logs else 'Aucune offre configurée en mode HTML.')
        st.rerun()

settings=dict(max_minutes=max_minutes,min_margin_pct=min_margin,fee_pct=fees,
              haircut_pct=haircut,fixed_cost=fixed)
counts=core.snapshot_counts()
cols=st.columns(4)
for col,(label,name) in zip(cols, [('Produits suivis','products'),('Magasins suivis','stores'),
                                  ('Offres surveillées','offers'),('Cotes enregistrées','quotes')]):
    col.metric(label,counts[name])

home_tab, raffle_tab, score_tab, source_tab, market_tab, watches_tab, calls_tab, calendar_tab, predict_tab, discover_tab, config_tab = st.tabs([
    '🏠 Accueil','🎟️ Tirages & invitations','🎯 Opportunités','🛒 Où acheter','📈 Prix & ventes',
    '📍 Stocks locaux','📞 Où appeler','🗓️ Sorties / annonces','🔮 Réassorts',
    '🔍 Découverte API','➕ Configuration'])

with home_tab:
    st.subheader('Vue d’ensemble — ton radar Pokémon')
    st.caption('Les stocks affichés proviennent des vérifications ajoutées ou des pages HTML compatibles. Aucun relevé universel Fnac/Amazon/Micromania n’est connecté par défaut.')
    with core.connect() as db:
        home_stocks=pd.read_sql_query('''SELECT p.name AS produit, s.name AS magasin, o.last_price AS prix_eur,
                    o.last_status AS statut, o.last_status_at AS dernier_signal,
                    o.last_known_method AS methode, o.url AS lien
                    FROM offers o JOIN products p ON p.id=o.product_id
                    JOIN stores s ON s.id=o.store_id ORDER BY o.last_status_at DESC LIMIT 100''', db)
    active_raffles=raffles.listed()
    h1,h2,h3,h4=st.columns(4)
    h1.metric('Offres locales suivies',len(home_stocks))
    h2.metric('Disponibles signalées',int((home_stocks.statut=='disponible').sum()) if not home_stocks.empty else 0)
    h3.metric('Stock inconnu',int((home_stocks.statut=='inconnu').sum()) if not home_stocks.empty else 0)
    h4.metric('Tirages à surveiller',sum(r['status'] in ('à vérifier','à surveiller','ouvert signalé') for r in active_raffles if r['category']!='Concours pour gagner'))
    st.markdown('#### 📍 Dernières disponibilités enregistrées')
    if home_stocks.empty:
        st.info('Aucune vérification de stock enregistrée. Dans « Configuration », crée une offre magasin ; dans « Stocks locaux », saisis un contrôle ou configure un scan HTML autorisé.')
    else:
        st.dataframe(home_stocks,use_container_width=True,hide_index=True,
            column_config={'lien':st.column_config.LinkColumn('Fiche')})
        st.warning('Un ancien statut « disponible » n’est pas une disponibilité actuelle garantie. Vérifie l’horodatage avant de te déplacer.')
    st.markdown('#### 🎟️ Accès aux ventes réservées')
    st.info('Fnac+ : tirage du 6 novembre clos le 3 novembre • Micromania : inscriptions du 4 novembre closes • Amazon : bouton Invitation à vérifier sur les fiches • prochaine vague : surveiller le 27 novembre, sans date d’inscription officielle.')
    st.link_button('Voir le répertoire des tirages', 'https://radarstock.fr/pokemon/tirages/')
    st.download_button('📱 Portail mobile autonome (tirages + magasins + stocks manuels)',
        data=(core.BASE/'pokeradar_portail_mobile_v04.html').read_bytes(),
        file_name='pokeradar_portail_mobile_v04.html',mime='text/html')
    st.markdown('#### 📱 Où est le reste de l’application ?')
    st.write('Tu es dans **l’application complète**. Toutes les rubriques sont dans les onglets au-dessus. Le fichier `pokeradar_liens_mobile.html` est seulement un portail de liens, et **ne reflète pas** ta base locale.')
    st.caption('Pour utiliser cette interface sur iPhone : lance Streamlit sur le Mac, garde les deux appareils sur le même Wi-Fi et ouvre depuis Safari la « Network URL » donnée par le Terminal (si ton pare-feu l’autorise). Ne publie pas cette application sans authentification.')

with raffle_tab:
    st.subheader('🎟️ Tirages au sort, invitations et accès réservés')
    st.caption('L’inscription se fait MANUELLEMENT sur le site officiel. PokéRadar n’inscrit personne, ne contourne aucune limite et ne promet aucun tirage gagné. Catalogue de départ vérifié le 6 novembre 2026 : les dates peuvent changer.')
    rs=raffles.listed()
    d1,d2,d3=st.columns(3)
    d1.metric('Accès / invitations',sum(r['category']=='Accès à l’achat' for r in rs))
    d2.metric('À surveiller',sum(r['status'] in ('à surveiller','à vérifier') for r in rs))
    d3.metric('Inscriptions suivies',sum(r['participation']!='Non inscrit' for r in rs))
    choose_cat=st.selectbox('Type', ['Tous']+list(raffles.CATEGORIES))
    choose_state=st.selectbox('État', ['Tous','ouvert signalé','à surveiller','à vérifier','clos'])
    to_show=[r for r in rs if (choose_cat=='Tous' or r['category']==choose_cat) and (choose_state=='Tous' or r['status']==choose_state)]
    # Highlight items worth checking; archive closed signups below them.
    priority={'ouvert signalé':0,'à surveiller':1,'à vérifier':2,'clos':3}
    to_show.sort(key=lambda r:(raffles.CATEGORIES.index(r['category']),priority.get(r['status'],4),r['brand']))
    if not to_show:
        st.info('Aucun résultat avec ces filtres.')
    for r in to_show:
        with st.container(border=True):
            a,b=st.columns([4,1])
            with a:
                st.markdown(f"**{r['brand']} — {r['title']}**")
                st.caption(f"{r['category']} · {r['method']}")
            with b:
                if r['status']=='clos': st.error('🔒 Clos')
                elif r['status']=='ouvert signalé': st.success('🟢 Ouvert signalé')
                elif r['status']=='à surveiller': st.info('🕒 À surveiller')
                else: st.warning('❔ À vérifier')
            st.write('**Conditions :** '+r['requirements'])
            if r['known_deadline']:
                try:
                    closing=__import__('datetime').datetime.fromisoformat(r['known_deadline']).astimezone(core.PARIS)
                    st.caption('Date limite signalée : '+closing.strftime('%d/%m/%Y à %H:%M (Paris)'))
                except ValueError: pass
            st.caption(r['note'])
            links=st.columns([1,1,2])
            links[0].link_button('🔗 Accéder à la page',r['url'],use_container_width=True)
            if r['source_url'] and r['source_url']!=r['url']:
                links[1].link_button('📖 Source / vérification',r['source_url'],use_container_width=True)
            with st.expander('📝 Ma participation — suivi privé sur cet ordinateur'):
                with st.form('participation_'+r['id']):
                    new_state=st.selectbox('Statut personnel',raffles.ENTRY_STATES,
                        index=raffles.ENTRY_STATES.index(r['participation']))
                    note=st.text_input('Note personnelle (sans mot de passe)',value=r['personal_note'],max_chars=500)
                    if st.form_submit_button('Enregistrer mon suivi'):
                        try:
                            raffles.save_participation(r['id'],new_state,note)
                            st.success('Enregistré dans ta base locale')
                            st.rerun()
                        except ValueError as exc: st.error(str(exc))
    st.divider()
    st.markdown('#### Surveiller les prochaines inscriptions')
    for name,url,description in raffles.TRACKERS:
        st.markdown(f'- [{name}]({url}) — {description}')
    st.download_button('📅 Exporter les clôtures connues dans mon calendrier (.ics)',
                       data=raffles.deadline_ics(rs),file_name='pokeradar_tirages.ics',mime='text/calendar')
    st.caption('Le fichier calendrier n’est pas une alerte automatique : importe-le dans Calendrier. Seules les futures clôtures confirmées avec date précise sont exportées.')
    with st.expander('➕ Ajouter un nouveau tirage découvert'):
        with st.form('custom_raffle'):
            name=st.text_input('Enseigne')
            title=st.text_input('Produit(s) / titre du tirage')
            url=st.text_input('URL HTTPS de la page d’inscription')
            typ=st.selectbox('Type de tirage',raffles.CATEGORIES)
            req=st.text_input('Conditions (Fnac+, compte Amazon, autre…)')
            deadline=st.date_input('Date limite annoncée (si connue)',value=None)
            deadline_time=st.time_input('Heure limite à Paris',value=__import__('datetime').time(23,59))
            if st.form_submit_button('Ajouter à mon radar'):
                try:
                    from datetime import datetime
                    dt=datetime.combine(deadline,deadline_time,tzinfo=core.PARIS).isoformat() if deadline else ''
                    raffles.add_custom(name,title,url,req,deadline=dt,category=typ)
                    st.success('Ajouté (statut à vérifier, pas de scan automatique)')
                    st.rerun()
                except ValueError as exc: st.error(str(exc))

with score_tab:
    st.subheader('Classement des achats potentiels')
    results=core.opportunities(**settings)
    st.caption('ASK = annonce affichée • Ventes vérifiées = transactions saisies avec preuve • Statut magasin = signal à reconfirmer.')
    if not results:
        st.warning('Ajoute une offre magasin dans l’onglet Configuration pour commencer la comparaison.')
    else:
        df=pd.DataFrame([{'ID':r['id'],'Produit':r['product'],'Magasin':r['store'],
              'Prix achat (€)':r['buy'],'Prix vendeur (€)':r['reference_ask'],
              'Médiane ventes vérifiées (€)':r['reference_sold'],
              'Ventes vérifiées (90 j)':r['verified_sales_90d'],
              'Marge estimée (%)':r['margin'],'Gain simulé (€)':r['estimated_gain'],
              'Âge signal stock (h)':r['stock_age_hours'],'Score indicatif /100':r['score'],
              'Stock':r['status'],'Signal':r['label']} for r in results])
        st.dataframe(df,use_container_width=True,hide_index=True)
        choice=st.selectbox('Analyser une offre', [f"#{r['id']} {r['product']} — {r['store']}" for r in results])
        r=results[[f"#{x['id']} {x['product']} — {x['store']}" for x in results].index(choice)]
        a,b,c,d=st.columns(4)
        a.metric('Marge nette estimée',f"{r['margin']} %" if r['margin'] is not None else '—')
        b.metric('Prix de vente prudent',f"{r['expected_sale']} €" if r['expected_sale'] else '—')
        c.metric('Score heuristique',f"{r['score']} / 100")
        d.metric('Prix achat cible',f"{r['max_buy']} €" if r['max_buy'] is not None else '—')
        st.info(r['label']+' · confiance '+r['confidence'])
        if r['url']:
            st.link_button('Ouvrir la fiche du magasin',r['url'])
        st.write('**À vérifier :** '+(' ; '.join(r['reasons']) or 'aucune réserve automatique supplémentaire'))
        st.caption(f"ASK : {r['ask_date'] or 'aucune'} ; échantillon de {r['verified_sales_90d']} ventes vérifiées, dernière {r['sold_date'] or 'aucune'} ; dernier stock connu : {r['stock_known_at'] or 'aucun'} ; preuve : {r['stock_quality']}")
        with st.expander('📦 Simulation conservation 1, 3 et 5 ans (non prédictive)'):
            st.caption('Trois scénarios hypothétiques -15%, 0%, +15%/an. Pas de garantie de plus-value, fiscalité non incluse.')
            storage=st.number_input('Frais annuels de stockage (€)',min_value=0.0,max_value=100.0,value=2.0,step=1.0)
            hist=intel.historical_risk(r['product_id'],90)
            st.write(f"Historique ASK sur 90 j : {hist['samples']} jours • variation : {hist['change_pct'] if hist['change_pct'] is not None else 'indisponible'} % • écart-type journalier : {hist['daily_volatility_pct'] if hist['daily_volatility_pct'] is not None else 'indisponible'} %")
            simulation=intel.holding_scenarios(r['buy'],r['expected_sale'],fees,fixed,storage)
            if simulation:
                st.dataframe(pd.DataFrame(simulation),hide_index=True,use_container_width=True)
            else:
                st.warning('Un prix de marché récent et un prix d’achat connus sont nécessaires.')
    if st.button('Exporter analyse JSON'):
        target=core.BASE/'analyse_pokeradar.json'
        core.export_report(target,**settings)
        st.success('Analyse exportée dans le répertoire du projet.')


with source_tab:
    st.subheader('🛒 Trouver les produits Pokémon — 27 pistes')
    st.caption('Moteur de recherche de vendeurs, **pas** un relevé en temps réel. Les liens de recherche ne prouvent ni prix, ni stock, ni réservation.')
    with core.connect() as db:
        source_products=db.execute('SELECT id,name,language FROM products ORDER BY name').fetchall()

    if source_products:
        chosen_pid=st.selectbox('Produit de ta liste', [p['id'] for p in source_products],
                 format_func=lambda pid:next(p['name'] for p in source_products if p['id']==pid),key='buy_product')
        chosen_product=next(p for p in source_products if p['id']==chosen_pid)
        metadata=sourcing.get_product_metadata(chosen_pid)
        suggested=metadata['search_alias'] or chosen_product['name']
        row=st.columns([2,1])
        with row[0]:
            typed_query=st.text_input('Mots-clés exacts à chercher (édition, ETB, bundle, langue…)',
                value=f'Pokémon {suggested} {chosen_product["language"]}', key=f'q_sourcing_{chosen_pid}')
        with row[1]:
            use_ean=st.checkbox('Chercher avec le code EAN',value=False,disabled=not bool(metadata['ean']))
            if use_ean and metadata['ean']:
                typed_query=metadata['ean']
        with st.expander('🔎 Précision de recherche : EAN et prix public de référence'):
            st.info('Un EAN/GTIN identifie un conditionnement précis. Vérifie aussi langue, nombre de boosters et version : une ETB et un coffret ne sont pas interchangeables.')
            with st.form(f'product_identifiers_{chosen_pid}'):
                m1,m2=st.columns(2)
                ean=m1.text_input('EAN / UPC / GTIN (facultatif)',value=metadata['ean'])
                official=m2.number_input('Prix public indicatif (facultatif, €)',min_value=0.0,
                          max_value=100000.0,value=float(metadata['retail_price'] or 0),step=1.0)
                alias=st.text_input('Nom de recherche plus précis',value=metadata['search_alias'],placeholder='ETB Règne Delta ME06 français')
                if st.form_submit_button('Enregistrer ces informations'):
                    try:
                        sourcing.save_product_metadata(chosen_pid,ean,alias,official or None)
                        st.success('Identifiants enregistrés');st.rerun()
                    except Exception as exc:
                        st.error(str(exc))

        group_choice=st.multiselect('Catégories de sources',sourcing.GROUPS,
                           default=list(sourcing.GROUPS),key='sources_groups')
        local_only=st.checkbox('Uniquement les enseignes avec magasins physiques',value=False)
        try:
            search_results=sourcing.search_links(typed_query,group_choice or ['__aucun__'],local_only)
        except ValueError as exc:
            st.warning(str(exc))
            search_results=[]
        if search_results:
            st.metric('Sources accessibles',len(search_results))
            c1,c2,c3,c4=st.columns(4)
            shortcuts=[('amazon','Amazon'),('fnac','Fnac'),('cardmarket','Cardmarket'),('ebay','eBay')]
            for col,(sid,text) in zip((c1,c2,c3,c4),shortcuts):
                r=next((x for x in search_results if x['id']==sid),None)
                if r: col.link_button(f'🔗 {text}',r['Recherche'],use_container_width=True)
            st.dataframe(pd.DataFrame(search_results).drop(columns=['id']),
                 column_config={'Recherche':st.column_config.LinkColumn('Chercher le produit'),
                                'Site':st.column_config.LinkColumn('Page officielle'),
                                'Où près de moi':st.column_config.LinkColumn('Magasins près de Suresnes')},
                 use_container_width=True,hide_index=True)
            st.download_button('📱 Télécharger les liens pour téléphone (HTML)',
                sourcing.mobile_catalog_html(typed_query).encode('utf-8'),
                file_name='pokeradar_liens_mobile.html',mime='text/html',use_container_width=True)
            st.caption('« Recherche Google ciblée » = recherche Google limitée au site de l’enseigne, car son moteur de recherche interne peut changer. Pour CardAround/TCG Trackers, le lien ouvre leur page de veille générale.')
        else:
            st.info('Choisis au moins une catégorie de vendeurs.')

        st.divider()
        st.markdown('### 💰 Enregistrer et comparer les fiches produits trouvées')
        st.caption('Après avoir consulté une fiche sur un site, copie ici son URL exacte, le prix constaté et les frais de livraison. Les données restent locales et ne sont pas collectées automatiquement.')
        with st.form('new_online_offer'):
            x,y=st.columns(2)
            source=x.selectbox('Plateforme / magasin',list(sourcing.SOURCE_BY_ID),
                                format_func=lambda k:sourcing.SOURCE_BY_ID[k].name)
            exact_url=y.text_input('URL HTTPS exacte de l’article (pas un résultat de recherche)',
                                   placeholder='https://www.fnac.com/a1234')
            x,y,z=st.columns(3)
            item_price=x.number_input('Prix total du lot (€)',min_value=0.01,value=49.99,step=0.5)
            shipping=y.number_input('Frais de port du lot (€)',min_value=0.0,value=0.0,step=1.0)
            count=z.number_input('Nombre de produits identiques dans le lot',min_value=1,max_value=1000,value=1)
            x,y,z=st.columns(3)
            seller=x.selectbox('Vendeur identifié',['inconnu','enseigne','tiers','particulier'])
            stock=y.selectbox('Statut lu sur la fiche',['inconnu','disponible affiché','indisponible affiché'])
            condition=z.selectbox('Scellé / état',['scellé à vérifier','scellé vérifié','ouvert','non applicable'])
            language=st.selectbox('Langue lue sur l’article',['FR à vérifier','FR vérifié','EN','JP','autre'])
            observation=st.text_input('Note de vérification',placeholder='Vendeur vérifié, frais, retrait magasin…')
            if st.form_submit_button('Ajouter ou actualiser cette offre'):
                try:
                    offer_id=sourcing.save_online_offer(chosen_pid,source,exact_url,item_price,
                            shipping,count,seller,condition,stock,language,observation)
                    st.success(f'Offre #{offer_id} enregistrée (observation déclarative)')
                    st.rerun()
                except (ValueError,sqlite3.Error) as exc:
                    st.error(str(exc))

        st.markdown('#### Comparateur d’offres enregistrées')
        source_offers=sourcing.tracked_online_offers(chosen_pid,fee_pct=fees,
              haircut_pct=haircut,fixed_cost=fixed,min_margin_pct=min_margin)
        if source_offers:
            offer_df=pd.DataFrame(source_offers)
            st.dataframe(offer_df,hide_index=True,use_container_width=True,
                 column_config={'Fiche':st.column_config.LinkColumn('Voir la fiche exacte')})
            st.download_button('⬇️ Télécharger le comparatif CSV',
                sourcing.export_online_csv(chosen_pid,fee_pct=fees,haircut_pct=haircut,
                                          fixed_cost=fixed,min_margin_pct=min_margin),
                file_name='pokeradar_achats_en_ligne.csv',mime='text/csv')
            st.warning('Un bénéfice indiqué est uniquement simulé. Seuls les prix d’annonces actualisés ou les échantillons de ventes vérifiées peuvent alimenter la revente prudente. Vérifier les frais, l’authenticité, le stock, la livraison et la fiscalité.')
            with st.expander('📉 Historique d’une fiche enregistrée'):
                ids=[r['ID'] for r in source_offers]
                watch_id=st.selectbox('Offre #',ids)
                with core.connect() as db:
                    history=pd.read_sql_query('''SELECT observed_at,price,shipping,stock_status,seller_type
                                    FROM online_offer_history WHERE online_offer_id=? ORDER BY id DESC LIMIT 100''',
                                    db,params=(watch_id,))
                st.dataframe(history,use_container_width=True,hide_index=True)
        else:
            st.info('Aucune offre renseignée : utilise les liens ci-dessus, puis ajoute les fiches et prix exacts.')
    else:
        st.info('Crée d’abord un produit dans Configuration pour rechercher ses points de vente.')

with market_tab:
    with core.connect() as db:
        pd_products=pd.read_sql_query('SELECT id,name,language,variant,reprint_risk,demand FROM products ORDER BY name',db)
        pd_quotes=pd.read_sql_query('SELECT * FROM quotes ORDER BY quote_date DESC',db)
    st.subheader('Évolution des prix')
    if pd_products.empty:
        st.info('Aucun produit')
    else:
        product=st.selectbox('Produit',pd_products['id'].tolist(),
                             format_func=lambda pid: pd_products.set_index('id').loc[pid,'name'])
        df=pd_quotes[pd_quotes.product_id==product].copy() if not pd_quotes.empty else pd.DataFrame()
        if not df.empty:
            df['quote_date']=pd.to_datetime(df['quote_date'])
            st.line_chart(df.groupby(['quote_date','basis'])['price'].median().unstack(),
                          x_label='Date',y_label='EUR')
            st.dataframe(df[['quote_date','price','source','basis','recorded_at']],
                        use_container_width=True,hide_index=True)
            st.caption('Les cotations ASK sont des annonces et les anciennes cotations SOLD ne sont pas auditées. L’API historique exige des crédits.')
        else:
            st.warning('Pas encore de cotations pour ce produit.')
        st.divider()
        st.markdown('#### Ajouter un prix affiché (ASK)')
        with st.form('quote'):
            qcol1,qcol2,qcol3=st.columns(3)
            price=qcol1.number_input('Prix en euros',min_value=0.01,value=50.0,step=1.0)
            basis=qcol2.selectbox('Nature du prix',['ASK'],help='Les ventes conclues vérifiées se saisissent séparément, avec une preuve.')
            quote_date=qcol3.date_input('Date de relevé',date.today())
            source=st.text_input('Source (ex : eBay vente vérifiée)',value='Saisie personnelle')
            if st.form_submit_button('Enregistrer la cotation'):
                try:
                    core.save_quote(product,price,source,basis,quote_date.isoformat())
                    st.success('Cotation enregistrée')
                    st.rerun()
                except Exception as exc:
                    st.error(str(exc))


    st.divider()
    st.markdown('### Transactions terminées — preuves et échantillons')
    st.caption('Une annonce marquée « vendue » ne prouve pas le prix final. Indique uniquement les montants conclus que tu as réellement vérifiés.')
    if not pd_products.empty:
        summary=intel.sales_stats(product)
        a,b,c=st.columns(3)
        a.metric('Ventes revues sur 90 j',summary['count'])
        b.metric('Prix médian constaté',f"{summary['median']} €" if summary['median'] is not None else '—')
        c.metric('Prix prudent échantillon',f"{summary['cautious']} €" if summary['cautious'] is not None else '—')
        st.caption('Échantillon manuel, non représentatif de l’ensemble des ventes du marché.')
        with core.connect() as db:
            actual=pd.read_sql_query("""SELECT sale_date,price,source,sale_ref,evidence_url,reviewed
                         FROM verified_sales WHERE product_id=? ORDER BY sale_date DESC LIMIT 200""",
                         db,params=(product,))
        if not actual.empty:
            st.dataframe(actual,use_container_width=True,hide_index=True)
        with st.form('new_verified_sale'):
            v1,v2,v3=st.columns(3)
            sale_date=v1.date_input('Date de transaction conclue',date.today())
            sale_price=v2.number_input('Montant réellement payé (€)',min_value=0.01,value=60.0,step=0.5)
            sale_platform=v3.selectbox('Plateforme',['eBay','Cardmarket','Vinted','Leboncoin','Autre'])
            sale_ref=st.text_input('Référence unique de la vente (sans données personnelles)',placeholder='ID transaction / URL unique')
            proof=st.text_input('URL HTTPS de preuve consultable',placeholder='https://...')
            reviewed=st.checkbox('J’ai vérifié que cette transaction est conclue et que ce montant est le prix final')
            if st.form_submit_button('Ajouter cette transaction'):
                try:
                    inserted=intel.add_sale(product,sale_date.isoformat(),sale_price,sale_platform,
                                              sale_ref,proof,reviewed)
                    st.success('Vente enregistrée' if inserted else 'Transaction déjà présente')
                    st.rerun()
                except Exception as exc:
                    st.error(str(exc))
    st.markdown('#### Import CSV de ventes')
    st.caption('Colonnes requises : product_id;sale_date;price;source;sale_ref;evidence_url;reviewed;notes. reviewed=oui seulement après vérification individuelle.')
    st.download_button('Télécharger le modèle CSV',
         data='product_id;sale_date;price;source;sale_ref;evidence_url;reviewed;notes\n'.encode('utf-8-sig'),
         file_name='modele_ventes_pokeradar.csv',mime='text/csv')
    uploaded=st.file_uploader('Choisir un CSV UTF-8 (2 000 lignes maximum)',type=['csv'],key='sales_csv')
    if uploaded is not None and st.button('Importer les ventes du CSV'):
        try:
            summary=intel.import_sales_csv(uploaded.getvalue())
            st.success(f"{summary['imported']} importées, {summary['duplicates']} doublons, {summary['rejected']} rejetées")
            if summary['errors']:
                st.warning(' ; '.join(summary['errors']))
        except Exception as exc:
            st.error(str(exc))

with watches_tab:
    with core.connect() as db:
        watches=pd.read_sql_query('''SELECT o.id,p.name as produit,s.name as magasin,
                o.mode,o.last_status,o.last_status_at,o.last_known_method,o.last_price,o.last_checked,o.last_method,o.url
                FROM offers o JOIN products p ON p.id=o.product_id
                JOIN stores s ON s.id=o.store_id ORDER BY o.id DESC''',db)
        shops=pd.read_sql_query('SELECT * FROM stores ORDER BY name',db)
    st.subheader('Offres et disponibilité locale')
    st.dataframe(watches,use_container_width=True,hide_index=True)
    st.caption('“Disponible” conserve le dernier signal connu : regarde sa date last_status_at. Les scans incertains sont conservés sans provoquer de fausses alertes.')
    if not watches.empty:
        st.markdown('#### Mettre à jour une disponibilité')
        with st.form('manual_stock'):
            v1,v2,v3=st.columns(3)
            chosen=v1.selectbox('Offre #',watches['id'].tolist())
            status=v2.selectbox('État',['disponible','indisponible','inconnu'])
            price=v3.number_input('Prix constaté (€)',min_value=0.0,value=0.0,step=1.0)
            confirmed=st.checkbox('Confirmation par téléphone / retrait préparé (personnellement vérifiée)')
            if st.form_submit_button('Enregistrer la vérification'):
                logs=core.manually_check(chosen,status,price if price>0 else None,confirmed)
                st.success(' · '.join(logs))
                st.rerun()
    st.divider()
    st.markdown('#### Liste des magasins')
    st.dataframe(shops,use_container_width=True,hide_index=True)

with config_tab:
    st.subheader('Paramétrer ton radar')
    with core.connect() as db:
        products=db.execute('SELECT id,name FROM products ORDER BY name').fetchall()
        stores=db.execute('SELECT id,name FROM stores ORDER BY name').fetchall()
    left,right=st.columns(2)
    with left:
        st.markdown('#### Nouveau produit')
        with st.form('add_product'):
            pid=st.text_input('Identifiant API ou identifiant personnel',placeholder='etb-30-ans')
            pname=st.text_input('Nom exact du produit',placeholder='ETB 30 ans')
            lang=st.selectbox('Langue',['FR','EN','JP','DE','IT','ES','Autre'])
            variant=st.text_input('Version, finition / format',value='scellé')
            risk=st.selectbox('Risque de réimpression',['inconnu','faible','moyen','élevé'])
            demand=st.slider('Demande subjective (1-5)',1,5,3)
            api_enabled=st.checkbox('Activer les relevés API payants quotidiens (ID Pokéindex valide requis)')
            if st.form_submit_button('Ajouter le produit'):
                try:
                    core.add_product(pid,pname,lang,variant,risk,demand,api_enabled=api_enabled)
                    st.success('Produit ajouté');st.rerun()
                except (ValueError,sqlite3.Error) as exc:
                    st.error(str(exc))
    with right:
        st.markdown('#### Nouveau magasin')
        with st.form('add_store'):
            sid=st.text_input('Identifiant magasin',placeholder='cultura-xxx')
            sname=st.text_input('Nom du magasin')
            address=st.text_input('Adresse / ville')
            minutes=st.number_input('Temps de trajet estimé de Suresnes (minutes)',0,180,45,5)
            phone=st.text_input('Téléphone (si connu)')
            if st.form_submit_button('Ajouter le magasin'):
                try:
                    core.add_store(sid,sname,address,minutes,phone)
                    st.success('Magasin ajouté');st.rerun()
                except (ValueError,sqlite3.Error) as exc:
                    st.error(str(exc))
    st.divider()
    st.markdown('#### Activer / désactiver un produit sur l’API payante')
    with core.connect() as db:
        api_items=db.execute('SELECT id,name,api_enabled FROM products ORDER BY name').fetchall()
    if api_items:
        picked=st.selectbox('Produit API à régler',[(r['id'],r['name']) for r in api_items],
                            format_func=lambda x:x[1])
        current=next(bool(row['api_enabled']) for row in api_items if row['id']==picked[0])
        choice=st.checkbox('Autoriser les relevés payants quotidiens pour ce produit',
                           value=current,key=f'api_{picked[0]}')
        if st.button('Enregistrer le réglage API'):
            with core.connect() as db:
                db.execute('UPDATE products SET api_enabled=? WHERE id=?',(int(choice),picked[0]))
            st.success('Réglage API enregistré');st.rerun()
    st.divider()
    st.markdown('#### Nouvelle fiche à surveiller')
    if products and stores:
        with st.form('add_offer'):
            v1,v2,v3=st.columns(3)
            pid=v1.selectbox('Produit',[(p['id'],p['name']) for p in products],format_func=lambda x:x[1])[0]
            sid=v2.selectbox('Magasin',[(s['id'],s['name']) for s in stores],format_func=lambda x:x[1])[0]
            mode=v3.selectbox('Méthode',['manual','html'],help='HTML : uniquement si un bloc de stock public est lisible')
            url=st.text_input('URL exacte de la fiche du produit (HTTPS)')
            selector=st.text_input('Sélecteur CSS du bloc stock, pour mode HTML',placeholder='.product-availability')
            price_css=st.text_input('Sélecteur CSS du prix, optionnel',placeholder='.product-price')
            in_words=st.text_input('Textes indiquant la disponibilité (séparés par |)',value='en stock|en rayon|disponible')
            out_words=st.text_input('Textes indiquant la rupture (séparés par |)',value='rupture|indisponible|non disponible|plus disponible|épuisé')
            price=st.number_input('Prix d’achat connu (€), 0 si inconnu',min_value=0.0,value=0.0,step=1.0)
            verified=st.checkbox('J’ai vérifié que le vendeur est bien l’enseigne (pas une marketplace tierce)')
            if st.form_submit_button('Ajouter la surveillance'):
                try:
                    core.add_offer(pid,sid,url,mode,price if price>0 else None,
                         selector,price_css,in_words,out_words,verified)
                    st.success('Surveillance enregistrée');st.rerun()
                except (ValueError,sqlite3.Error) as exc:
                    st.error(str(exc))
    st.caption('Pour le mode HTML, choisir un élément CSS contenant uniquement le statut du magasin visé. Un sélecteur générique est dangereux et produit de faux positifs. Aucune protection anti-bot n’est contournée.')

with predict_tab:
    st.subheader('Historique des réassorts')
    st.caption('Le bot n’invente pas d’horaire de réassort : l’algorithme n’affiche des créneaux que lorsque suffisamment d’événements réels ont été observés.')
    with core.connect() as db:
        targets=db.execute('''SELECT o.id,p.name as product_name,s.name as store_name
             FROM offers o JOIN products p ON p.id=o.product_id
             JOIN stores s ON s.id=o.store_id ORDER BY o.id''').fetchall()
        events=pd.read_sql_query('''SELECT e.observed_at,e.type,p.name AS produit,s.name AS magasin
             FROM restock_events e JOIN offers o ON e.offer_id=o.id
             JOIN products p ON p.id=o.product_id JOIN stores s ON s.id=o.store_id
             ORDER BY e.observed_at DESC LIMIT 200''',db)
    if targets:
        chosen=st.selectbox('Fiche',[(r['id'],f"{r['product_name']} — {r['store_name']}") for r in targets],
                            format_func=lambda x:x[1])[0]
        prediction=core.forecast_slots(chosen)
        st.metric('Vrais retours en stock enregistrés',prediction['count'])
        st.info(prediction['status'])
        if prediction['slots']:
            st.dataframe(pd.DataFrame(prediction['slots']),hide_index=True,use_container_width=True)
    else:
        st.warning('Ajoute une offre pour démarrer l’historique.')
    if not events.empty:
        st.dataframe(events,use_container_width=True,hide_index=True)
    st.caption('Ne jamais prendre une simple disparition / réapparition de texte HTML pour une garantie de livraison.')

with calls_tab:
    st.subheader('Magasins à contacter en priorité')
    st.caption('Liste de recherche, PAS une liste de magasins approvisionnés. Temps de trajet renseignés manuellement depuis Suresnes.')
    calls=intel.call_queue(max_minutes=max_minutes)
    if not calls:
        st.warning('Indique un temps de trajet sur au moins un magasin dans Configuration.')
    else:
        st.dataframe(pd.DataFrame(calls),use_container_width=True,hide_index=True)
        st.download_button('Exporter la liste d’appels CSV',
             data=intel.export_call_csv(max_minutes),
             file_name='pokeradar_liste_appels.csv',mime='text/csv')
    st.info('Demande le nom exact, l’EAN, le prix en caisse, le stock réellement en rayon, la limite par client et la possibilité de réserver un retrait.')

with calendar_tab:
    st.subheader('Sorties officielles et réassorts annoncés')
    st.caption('Ajoute uniquement des annonces sourcées : aucune prédiction de disponibilité n’est présentée comme officielle.')
    events=intel.upcoming_events(120)
    if events:
        st.dataframe(pd.DataFrame(events),use_container_width=True,hide_index=True)
    else:
        st.info('Aucune annonce sourcée enregistrée pour les 120 prochains jours.')
    with core.connect() as db:
        choices=db.execute('SELECT id,name FROM products ORDER BY name').fetchall()
    if choices:
        with st.form('add_calendar_event'):
            event_product=st.selectbox('Produit concerné', [(p['id'],p['name']) for p in choices],
                                      format_func=lambda x:x[1])[0]
            c1,c2=st.columns(2)
            event_date=c1.date_input('Date annoncée',date.today())
            event_type=c2.selectbox('Nature',['sortie','réassort annoncé','réimpression annoncée'])
            source_url=st.text_input('URL de l’annonce officielle ou du commerçant',placeholder='https://...')
            notes=st.text_input('Détails utiles',placeholder='Heure annoncée / boutique concernée')
            if st.form_submit_button('Ajouter annonce documentée'):
                try:
                    intel.add_calendar_event(event_product,event_date.isoformat(),event_type,source_url,notes)
                    st.success('Annonce enregistrée');st.rerun()
                except Exception as exc:
                    st.error(str(exc))

with discover_tab:
    st.subheader('Explorer des produits scellés (API Pokéindex)')
    st.caption('Requête volontairement manuelle : le catalogue est payant en crédits. Le prix plancher est un prix d’annonce, et l’écart au prix public initial n’est PAS un profit potentiel.')
    sample_size=st.slider('Nombre de produits à consulter (crédits facturés ≈ nombre de produits)',1,30,10)
    if not os.getenv('POKEINDEX_API_KEY'):
        st.info('Configure POKEINDEX_API_KEY dans .env pour activer cette recherche.')
    if st.button(f'Consommer jusqu’à {sample_size} crédits : consulter le catalogue',
                 disabled=not bool(os.getenv('POKEINDEX_API_KEY'))):
        try:
            st.session_state['discovery_result']=intel.catalog_discovery(sample_size)
        except Exception as exc:
            st.error(f'Échec API : {exc}')
    if 'discovery_result' in st.session_state:
        df=pd.DataFrame(st.session_state['discovery_result'])
        if not df.empty:
            st.dataframe(df,use_container_width=True,hide_index=True)
            st.warning('Les écarts avec le prix de sortie ne mesurent ni une offre locale, ni une vente conclue, ni une opportunité certaine.')

st.divider()
st.caption('PokéRadar v0.4 • Aucun achat automatique • pas de contournement de restrictions • données du marché accessibles selon les droits du fournisseur')
