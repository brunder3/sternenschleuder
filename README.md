# Sternenschleuder



Name, Grafik und Oberfläche sind eigenständig. Alle Modelle, Texturen und Sounds 

## Spielen

Online spielen: **https://brunder3.github.io/sternenschleuder/** (veröffentlicht aus dem öffentlichen Repo `brunder3/sternenschleuder`).

Oder `index.html` im Browser öffnen, per Doppelklick. Es gibt keinen Build-Schritt und keine Installation. three.js liegt als Datei unter `vendor/`, das Spiel läuft also auch offline. Der Spielstand wird automatisch im `localStorage` des Browsers gespeichert.

## Grafik

Himmel, Boden (Gras, Fels, Sand, Erde), Wolken, Wasser, die Milchstraße sowie Erde, Mond, Mars, Jupiter und Saturn aus dem All sind echte Fotos. Sie stecken eingebettet in `js/photos.js`, damit das Spiel auch offline per Doppelklick läuft. Die Münzen sind geprägtes Metall mit Rand und Stern, das den Himmel spiegelt.

Drei Raketen sind originalgetreue NASA-Modelle: Spatz ist eine Jupiter-C, Polaris eine Ares I-X und Titan eine Saturn V mit fünf Triebwerken. Neben der Startschiene steht der Startturm des Mobile Launcher. Die übrigen Raketen werden zur Laufzeit gebaut: geschweißte Blechringe mit Nieten, Kabelkanal, Steuerdüsen, aufgemalter Name, Ruß am Heck und echte Triebwerksglocken (bei langen Raketen drei oder fünf), deren Abgasstrahl Machsche Knoten zeigt. Die Startrampe hat eine Betonplatte mit Fugen und Brandspuren und eine Startschiene aus geschweißtem Stahlfachwerk.

Auf Computern läuft die volle Grafik mit Bloom (leuchtende Flammen, Sonne und Sterne), Kantenglättung und Spiegelungen des Himmels auf Wasser und Raketenlack. Auf Handys und schwächeren Geräten fällt der Bloom weg, damit das Spiel flüssig bleibt. Umschalten lässt sich die Stufe im Menü über das Fragezeichen (Grafik: Hoch oder Niedrig). Die Wahl merkt sich der Browser. Alternativ erzwingt `?grafik=hoch` oder `?grafik=niedrig` hinter der Adresse die Stufe.

## Steuerung

| Aktion | Tastatur / Maus | Handy |
| --- | --- | --- |
| Zündung | `Leertaste` oder Klick, wenn der Balken im Feld „Perfekt“ steht | Antippen |
| Winkel der Startrampe | `W`/`S` oder `↑`/`↓` | Pfeile links |
| Schub | `Leertaste` oder Maustaste halten | Boost-Knopf halten (zeigt den Treibstoff) |
| Lenken (Nase hoch/runter) | `W`/`S` oder `↑`/`↓` | Pfeile links oder mit dem Finger ziehen |
| Turbo | `Shift` oder `E` | Turbo-Knopf |
| Pause | `P` / `Esc` | Pause-Knopf |

Die Rakete fliegt immer geradeaus. Gelenkt wird nur die Neigung der Nase.

## Inhalt

- **22 Zonen** von der Startwiese über Wolkenmeer, Jetstream, Kármán-Linie, Erdumlaufbahn, Mond, Mars, Asteroidengürtel, Jupiter, Saturn und Heliopause weiter zur Oortschen Wolke, Proxima Centauri, Wega, zu den Plejaden, dem Orionnebel, dem Zentrum der Milchstraße und bis zur Andromeda-Galaxie. Jede Zone hat eigenen Himmel, eigene Hindernisse und eigene Kulisse.
- **Echte Größenordnungen:** Höhen und Geschwindigkeiten entsprechen der Wirklichkeit (Schallmauer im Jetstream, 7,8 km/s im Orbit, 4,24 Lichtjahre bis Proxima Centauri, nie schneller als das Licht). Weil die Entfernungen im All riesig sind, zeigt das HUD dort den Zeitraffer an.
- **14 Upgrades** mit zusammen 311 Stufen. Die vier wichtigsten (Startrampe, Tank, Booster, Einkommen) sind direkt im Startmenü kaufbar.
- **20 Raketen** mit eigenem 3D-Modell, eigenen Werten und Spezialfähigkeiten, vom Silvesterkracher bis zum Lichtbringer.
- **65 Missionen** mit Belohnungen.
- Startrampe mit Service-Turm und Flammengraben, perfekte Zündung, Boost-Ringe, Treibstoffkanister, Ballons, UFOs, Edelsteine, Schallmauer-Effekt und eine prozedurale Low-Poly-Landschaft mit Flüssen, Seen, Bergen und Wäldern.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `index.html` | Oberfläche und Styles |
| `js/photos.js` | Eingebettete Fotos (siehe Bildnachweis) |
| `js/nasa.js` | Eingebettete NASA-3D-Modelle als glTF (meshopt-komprimiert, WebP-Texturen) |
| `js/core.js` | Daten (Zonen, Upgrades, Raketen, Missionen), Formeln und Flugphysik, ohne DOM und WebGL |
| `js/audio.js` | Soundeffekte mit der Web Audio API |
| `js/models.js` | 3D-Modelle und prozedurale Texturen |
| `js/world.js` | Renderer, Himmel, Gelände, Wolken, Partikel und Weltraumkulisse |
| `js/game.js` | Spielablauf, Eingabe, Kamera, HUD und Menüs |
| `vendor/three.min.js` | three.js r159 (MIT-Lizenz, siehe `vendor/three.LICENSE`) |
| `vendor/three-extras.min.js` | Zusätze aus three.js r159 (EffectComposer, Bloom, OutputPass, GLTFLoader, MeshoptDecoder), als klassisches Skript gebündelt |

Weil `js/core.js` ohne Browser auskommt, lässt sich das Balancing mit Node simulieren: Ein Bot fliegt, verdient und kauft ein. Die Preise sind so abgestimmt, dass ein Bot etwa 140 Flüge bis zur Heliopause und etwa 230 bis Andromeda braucht. Jenseits der Heliopause werden Treibstoffkanister seltener, damit dort Tank und Triebwerk über die Reichweite entscheiden.

## Bildnachweis

- Himmel (Skybox), Gras, Fels, Sand, Erde, Milchstraße und Wasserwellen: [Babylon.js Assets](https://github.com/BabylonJS/Assets), Lizenz [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Erde, Wolken der Erde und Mond: NASA-Aufnahmen aus den Beispielen von [three.js](https://github.com/mrdoob/three.js) (MIT-Lizenz)
- Mars, Jupiter und Saturn: [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources), gemeinfrei
- 3D-Modelle von Saturn V, Jupiter-C, Ares I-X und dem Startturm des Mobile Launcher: [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources), gemeinfrei. Für das Spiel umgewandelt: Draco entfernt, meshopt-komprimiert, Texturen als WebP. Bei der Saturn V wurde das blaue Band der ersten Stufe weiß gefärbt, vom Mobile Launcher ist nur der Turm übrig.
- Quellwolke: [Poly Haven](https://polyhaven.com) über [@pmndrs/assets](https://github.com/pmndrs/assets), CC0
