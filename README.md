# Sternenschleuder



Name, Grafik und Oberfläche sind eigenständig. Alle Modelle, Texturen und Sounds 

## Spielen

Online spielen: **https://brunder3.github.io/sternenschleuder/**

Oder `index.html` im Browser öffnen, per Doppelklick. Es gibt keinen Build-Schritt und keine Installation. three.js liegt als Datei unter `vendor/`, das Spiel läuft also auch offline. Der Spielstand wird automatisch im `localStorage` des Browsers gespeichert.

## Grafik

Auf Computern läuft die volle Grafik mit Bloom (leuchtende Flammen, Sonne und Sterne), Kantenglättung und Spiegelungen des Himmels auf Wasser und Raketenlack. Auf Handys und schwächeren Geräten fällt der Bloom weg, damit das Spiel flüssig bleibt. Mit `?grafik=hoch` oder `?grafik=niedrig` hinter der Adresse lässt sich die Stufe erzwingen.

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
| `js/core.js` | Daten (Zonen, Upgrades, Raketen, Missionen), Formeln und Flugphysik, ohne DOM und WebGL |
| `js/audio.js` | Soundeffekte mit der Web Audio API |
| `js/models.js` | 3D-Modelle und prozedurale Texturen |
| `js/world.js` | Renderer, Himmel, Gelände, Wolken, Partikel und Weltraumkulisse |
| `js/game.js` | Spielablauf, Eingabe, Kamera, HUD und Menüs |
| `vendor/three.min.js` | three.js r159 (MIT-Lizenz, siehe `vendor/three.LICENSE`) |
| `.github/workflows/pages.yml` | Veröffentlicht das Spiel bei jedem Push auf `main` über GitHub Pages |
| `vendor/three-extras.min.js` | Nachbearbeitung aus three.js r159 (EffectComposer, Bloom, OutputPass), als klassisches Skript gebündelt |

Weil `js/core.js` ohne Browser auskommt, lässt sich das Balancing mit Node simulieren: Ein Bot fliegt, verdient und kauft ein. Die Preise sind so abgestimmt, dass ein Bot etwa 140 Flüge bis zur Heliopause und etwa 230 bis Andromeda braucht. Jenseits der Heliopause werden Treibstoffkanister seltener, damit dort Tank und Triebwerk über die Reichweite entscheiden.
