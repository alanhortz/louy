# L’Oûy

**La Wallonie vue par l’œil du LiDAR.** *L’oûy* — « l’œil », en wallon.

Un viewer 3D qui dessine le relief de la Wallonie en nuage de points, directement
dans le navigateur, à partir des relevés LiDAR aériens du Service public de
Wallonie. 253 × 147 km navigables, de la vue d’ensemble jusqu’au demi-mètre.

- **Deux campagnes LiDAR** : 2021–2022 (50 cm) et 2013–2014 (1 m).
- **Terrain ou surface** : le sol nu (MNT), ou bâtiments et canopée compris (MNS).
- **Cinq habillages** : photo aérienne (20 millésimes, de 1971 à 2026), infrarouge,
  ombrage, altitude, pente.
- **Calques** : noms de villes et villages (OpenStreetMap), caméras routières en direct.
- **2 900 sites touristiques cherchables** : un choix, et la caméra arrive à 200 m
  au-dessus du lieu, en orbite.
- **Partage** : un lien restitue exactement la vue — position, cap, scène, calques.
- **Mobile** : gestes tactiles complets, rendu allégé, interface repliable.

## Démarrer

```bash
npm install
npm run dev        # http://localhost:5173 — tuiles demandées directement au SPW
```

| Commande | Rôle |
| --- | --- |
| `npm run dev` | développement, rechargement à chaud |
| `npm test` | tests unitaires (domaine, services, machines, Worker) |
| `npm run typecheck` | vérification TypeScript stricte |
| `npm run build` | construction de production dans `dist/` |
| `npm run preview` | la construction servie par le Worker Cloudflare, en local |
| `npm run deploy` | construction puis déploiement sur Cloudflare |

Node 24 ou ultérieur.

## Identité du projet

Nom, devise, **nom de domaine** et **dépôt GitHub** se changent à un seul endroit :
[`src/config/project.ts`](src/config/project.ts). Le domaine se déclare aussi dans
[`wrangler.jsonc`](wrangler.jsonc) (bloc `routes`, commenté).

## Architecture

```
src/
  config/      identité du projet, table de compatibilité des navigateurs
  domain/      règles pures, sans effet de bord : tuilage, projection, catalogue,
               scène, vue partageable — partagées avec le Worker Cloudflare
  services/    effets de bord, un fichier par frontière : IndexedDB, Overpass,
               caméras, partage, télémétrie, diagnostic du navigateur
  machines/    une machine XState par responsabilité
  engine/      rendu three.js : streaming du nuage, navigation, calques
  ui/          composants React — ils lisent les machines et leur envoient des événements
worker/        Worker Cloudflare : site statique + relais cachable des tuiles
build/         greffons Vite : garde-fou de compatibilité, empreinte de provenance
scripts/       récolte des données statiques, vérification de l’empreinte
```

### Les machines à états

Toute la logique applicative est portée par des machines XState v5. La machine
`app` chapeaute les autres ; **aucune machine fille n’en connaît une autre**, tout
passe par leur parent, ce qui rend chaque interaction lisible à un seul endroit
([`app.machine.ts`](src/machines/app.machine.ts)).

```
app ── checking ──▶ compatibility          le navigateur convient-il ?
     ├─ unsupported                         → quelle version installer
     └─ running
          ├─ viewer       cycle de vie du moteur de rendu, orbite, contexte WebGL perdu
          ├─ scene        campagne · surface · habillage · millésime
          ├─ places       noms de lieux : instantané → cache → rafraîchissement en direct
          ├─ cameras      calque → liste → caméra regardée → image renouvelée
          ├─ sites        index des sites touristiques, recherche, choix
          ├─ acquisition  date des mesures LiDAR sous le point visé
          ├─ activity     pastille de chargement : en cours → confirmé → silence
          ├─ share        feuille de partage → presse-papiers → copie manuelle
          ├─ chrome       quels panneaux sont dépliés
          └─ telemetry    écriture périodique de l’historique local
```

Une seule frontière impérative : [`SceneEngine`](src/engine/SceneEngine.ts). Ce
qui change à chaque image (points, étiquettes, altimètre) est dessiné par le
moteur ; tout le reste traverse les machines. Le cœur de rendu
(`src/engine/core/`, JavaScript) est repris du projet *point-cloud* et n’a été
modifié qu’à la marge (orbite, gestes à deux doigts, libération des écouteurs).

### Télémétrie locale

Un inspecteur XState branché sur l’acteur racine consigne **chaque événement et
chaque changement d’état** de toutes les machines, depuis le chargement de la
page ([`inspector.ts`](src/app/inspector.ts)). L’historique est écrit par lots
NDJSON compressés en gzip dans IndexedDB, sur une fenêtre glissante de 30 jours.

Il reste **dans le navigateur du visiteur** : rien n’est transmis. Le panneau
« À propos » en affiche le volume et permet de l’exporter (`.ndjson.gz`) ou de
l’effacer. Les charges utiles sont assainies et bornées avant écriture ; la
machine de télémétrie ne s’enregistre pas elle-même.

## Tuiles et CDN

Les services du SPW répondent `Cache-Control: max-age=0` à des requêtes
paramétrées par emprise : tels quels, ni un CDN ni un navigateur ne les
conservent. En production le viewer demande donc des **chemins stables** :

```
/edge/v1/tiles/<service>/<px>/<niveau>/<i>/<j>.<png|jpg>
/edge/v1/flights/<cx>/<cy>.json
```

Le [Worker](worker/index.ts) les traduit en requête ArcGIS, puis rend la réponse
avec une durée de vie longue :

| Ressource | `Cache-Control` |
| --- | --- |
| Relief et orthophotos datés | `public, max-age=31536000, immutable` |
| `ORTHO_LAST` (remplacée chaque année) | 1 jour navigateur, 7 jours CDN, `stale-while-revalidate` |
| JS, CSS, polices (noms hachés) | `immutable`, 1 an |
| `index.html` | toujours revalidé |

La première personne à survoler un lieu paie la latence du SPW (~300 ms par
tuile) ; toutes les suivantes sont servies depuis le point de présence
Cloudflare le plus proche, puis depuis leur propre cache. Ce n’est pas un proxy
ouvert : seuls les services, tailles et adresses de tuiles du viewer passent.

Côté client : file de priorité réévaluée à chaque image, annulation des tuiles
sorties du champ, décodage dans des Web Workers, raffinement progressif (la vue
n’est jamais vide), rendu à la demande (une vue immobile ne consomme rien).

## Déploiement

### GitHub Actions

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) vérifie les types, lance
les tests et construit à chaque poussée. Sur `main`, il déploie sur Cloudflare
**si** le dépôt est configuré :

| Où | Nom | Rôle |
| --- | --- | --- |
| Secrets | `CLOUDFLARE_API_TOKEN` | jeton API (modèle « Edit Cloudflare Workers ») |
| Variables | `CLOUDFLARE_ACCOUNT_ID` | identifiant du compte ; active le déploiement |
| Secrets | `PROVENANCE_SECRET` | clef de signature de l’empreinte (voir plus bas) |

### Cloudflare

1. Ajouter le domaine à Cloudflare, décommenter `routes` dans `wrangler.jsonc`.
2. `npm run deploy` (ou laisser faire l’action GitHub).
3. Recommandé : activer *Smart Tiered Cache* (Caching › Tiered Cache), pour qu’une
   tuile déjà demandée en Europe ne retourne pas au SPW depuis un autre point de
   présence.

## Données statiques

Trois jeux sont récoltés hors ligne et servis comme fichiers statiques :

```bash
npm run cameras:harvest   # caméras Trafiroutes, placées au point kilométrique (OCR : macOS)
npm run sites:harvest     # sites touristiques OpenStreetMap
npm run places:harvest    # instantané des noms de lieux OpenStreetMap
```

Les noms de lieux s’affichent d’abord depuis cet instantané, puis le navigateur
interroge l’API publique Overpass et **met la réponse en cache chez le visiteur**
(IndexedDB, 30 jours) : les visites suivantes ne sollicitent plus aucun serveur.
L’instantané garantit que l’affichage ne dépend jamais de la disponibilité
d’Overpass, un service bénévole souvent saturé.

## Scans 3D

Le calque « Scans 3D » pose sur le relief des lieux reconstruits en « gaussian
splats » à partir de vidéos de drone publiées sous licence libre. Chaque scan est
un fichier `.spz` dans `public/scans/`, décrit dans
[`public/scans/index.json`](public/scans/index.json) : son ancrage en Lambert 2008,
son cadrage d’ouverture et le **crédit de l’auteur des images**, obligatoire et
affiché dans le calque, la ligne d’attribution et le panneau « À propos ».

Le fichier est exprimé dans le repère du viewer (x = est, y = altitude, z = −nord,
en mètres autour de l’ancrage). Le moteur de splats ([Spark](https://sparkjs.dev))
n’est téléchargé qu’à la première activation du calque. Les splats sont dessinés
par-dessus le relief, sans être masqués par lui.

## Compatibilité

| Navigateur | Version minimale |
| --- | --- |
| Safari sur iPhone / iPad | iOS 16.4 |
| Chrome, Edge (Android et ordinateur) | 108 |
| Samsung Internet | 21 |
| Firefox | 121 |
| Safari sur Mac | 16.4 |

La table vit dans [`browser-support.json`](src/config/browser-support.json) et a
deux lecteurs : la machine `compatibility`, qui teste les capacités réellement
utilisées (WebGL 2, Workers en modules, OffscreenCanvas, Compression Streams,
IndexedDB…), et un garde-fou ES5 injecté dans `index.html`, pour les navigateurs
trop anciens pour seulement lire le code de l’application. Dans les deux cas le
visiteur voit quelle version installer, et comment.

## Empreinte de provenance

Chaque construction porte une empreinte dissimulée — titulaire, commit, date —
qui permet de prouver l’origine d’une copie du site. Elle est posée par un
greffon Vite ([`build/entropy/`](build/entropy/)) sur deux porteurs
indépendants, et signée (HMAC-SHA-256) avec `PROVENANCE_SECRET`.

```bash
npm run provenance:verify                       # ./dist
npm run provenance:verify -- https://louy.be/   # un site en ligne
```

Ce dépôt étant public, la *technique* est lisible par qui le consulte : elle
dissuade la copie paresseuse et identifie une construction, elle ne résiste pas à
quelqu’un qui la retire délibérément. La signature, elle, ne peut pas être
contrefaite sans le secret.

## Limites connues

- **Précision verticale ≈ 3,5 m.** Le SPW ne diffuse pas d’altitudes brutes : elles
  sont reconstruites depuis des images rendues au travers d’une rampe de couleurs
  quantifiée sur 256 niveaux. La précision horizontale va jusqu’à 50 cm.
- **Caméras : position au point kilométrique.** Aucune source ne publie leurs
  coordonnées, mais chaque image porte un bandeau (`A015_SPY_061.400_(+)`) ; lu par
  OCR et reporté sur les bornes hectométriques du SPW, il place 202 des 215 caméras
  à quelques mètres près le long de la route. 9 autres, au bandeau illisible, sont
  rattachées à leur localité (et signalées « position approx. ») ; 4 ne sont pas affichées.
- **Sites touristiques : ceux d’OpenStreetMap**, avec ses catégories et ses lacunes.
- La couverture s’arrête aux frontières régionales.

## Licence

Copyright © 2026 Alan Hortz.

Ce programme est un logiciel libre, distribué sous la
[GNU Affero General Public License, version 3](LICENSE) (AGPL-3.0). Vous pouvez
l'utiliser, le modifier et le redistribuer ; si vous mettez en ligne une version
modifiée, vous devez en publier le code source sous la même licence et conserver
les mentions d'origine. Il est fourni sans aucune garantie.

La licence couvre le code. Les données du dépôt gardent la leur (ODbL pour ce
qui vient d'OpenStreetMap, CC-BY 4.0 pour ce qui vient du SPW), et les éléments
d'interface repris de God's Eye View restent sous licence MIT — voir
[`NOTICE.md`](NOTICE.md).

## Crédits

Données © Service public de Wallonie (CC-BY 4.0) et © contributeurs OpenStreetMap
(ODbL). Scan 3D de la citadelle de Namur d’après une vidéo de Joeys Journeys (CC BY). Interface inspirée de [God’s Eye View](https://github.com/bilawalsidhu/gods-eye-view)
de Bilawal Sidhu (MIT). Détail dans [`NOTICE.md`](NOTICE.md).
