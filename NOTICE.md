# Mentions

L'Oûy — Copyright © 2026 Alan Hortz — est distribué sous licence AGPL-3.0 (voir
[`LICENSE`](LICENSE)). Ce fichier recense ce qui, dans le dépôt, relève d'une autre
licence.

## Interface

Le langage visuel de l'interface — panneaux « verre », pastilles d'état
textuelles, tuiles d'habillage, pastilles à palettes, panneau et marqueurs des
caméras — reprend celui
de **God's Eye View** (<https://github.com/bilawalsidhu/gods-eye-view>). Les
règles CSS concernées sont signalées « GEV » dans `src/styles/`, l'icône de
caméra dans `src/engine/overlays/cameraMarkers.ts`.

```
MIT License

Copyright (c) 2026 Bilawal Sidhu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Marques

Le nom et le logo de Sorcery Systems (`src/ui/assets/sorcery-systems.svg`), sponsor du
projet, sont la propriété de Sorcery Systems. Ils ne sont pas couverts par la licence
AGPL du code : les réutiliser demande son accord.

## Données

| Donnée | Source | Licence |
| --- | --- | --- |
| Relief LiDAR, orthophotos, mailles de vol | Service public de Wallonie — [Géoportail de la Wallonie](https://geoportail.wallonie.be) | CC-BY 4.0 |
| Noms de lieux, sites touristiques | © contributeurs [OpenStreetMap](https://www.openstreetmap.org/copyright) | ODbL 1.0 |
| Images des caméras routières | SPW — [Trafiroutes](https://trafiroutes.wallonie.be) | images publiques, chargées depuis la source |
| Imagerie 3D de la citadelle de Namur (`public/scans/namur.spz`) | Œuvre dérivée de la vidéo [« Namur in 4K \| Walking + Drone Tour of Belgium’s Hidden Gem »](https://www.youtube.com/watch?v=hbZ72BQ3Q78) de **Joeys Journeys** : plans de drone reconstruits en « gaussian splats », recadrés et calés sur le LiDAR | Creative Commons Attribution (CC BY), telle que publiée sur YouTube |
| Imagerie 3D des lettres « NAMUR », esplanade de la Confluence (`public/scans/lettres-namur.glb`) | Relevé photogrammétrique réalisé par Alan Hortz avec Polycam, le 13 novembre 2026 ; l'œuvre photographiée est installée à demeure dans l'espace public | © 2026 Alan Hortz — relevé non couvert par la licence AGPL du code |

## Bibliothèques

three.js (MIT), Spark (MIT, World Labs — rendu des « gaussian splats »), React (MIT), XState (MIT), Heroicons (MIT, Tailwind Labs), polices Inter et JetBrains Mono (SIL OFL 1.1).
