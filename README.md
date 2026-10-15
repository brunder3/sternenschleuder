# Sternenschleuder

Ein 3D-Browserspiel im Stil von *Rocket Fling* (CrazyGames): Rakete in die Schleuder legen, im richtigen Moment abschießen, mit Schub geradeaus nach oben fliegen, Treibstoff und Münzen sammeln und zwischen den Flügen aufrüsten. Ziel ist die Heliopause am Rand des Sonnensystems.

Name, Grafik und Oberfläche sind eigenständig. Alle Modelle, Texturen und Sounds werden im Browser erzeugt.

## Spielen

Online spielen: **https://brunder3.github.io/sternenschleuder/**

Oder `index.html` im Browser öffnen, per Doppelklick. Es gibt keinen Build-Schritt und keine Installation. three.js liegt als Datei unter `vendor/`, das Spiel läuft also auch offline. Der Spielstand wird automatisch im `localStorage` des Browsers gespeichert.

## Steuerung

| Aktion | Tastatur / Maus | Handy |
| --- | --- | --- |
| Abschuss | `Leertaste` oder Klick, wenn der Balken im Feld „Perfekt“ steht | Antippen |
| Winkel vor dem Abschuss | `W`/`S` oder `↑`/`↓` | Pfeile links |
| Schub | `Leertaste` oder Maustaste halten | Boost-Knopf halten (zeigt den Treibstoff) |
| Lenken (Nase hoch/runter) | `W`/`S` oder `↑`/`↓` | Pfeile links oder mit dem Finger ziehen |
| Turbo | `Shift` oder `E` | Turbo-Knopf |
| Pause | `P` / `Esc` | Pause-Knopf |

Die Rakete fliegt immer geradeaus. Gelenkt wird nur die Neigung der Nase.

## Inhalt

- **15 Zonen** von der Startwiese über Wolkenmeer, Jetstream, Kármán-Linie, Erdumlaufbahn, Mond, Mars, Asteroidengürtel, Jupiter und Saturn bis zur Heliopause. Jede Zone hat eigenen Himmel, eigene Hindernisse und eigene Kulisse.
- **14 Upgrades** mit zusammen 216 Stufen. Die vier wichtigsten (Katapult, Tank, Booster, Einkommen) sind direkt im Startmenü kaufbar.
- **12 Raketen** mit eigenem 3D-Modell, eigenen Werten und Spezialfähigkeiten.
- **49 Missionen** mit Belohnungen.
- Perfekter Abschuss, Boost-Ringe, Treibstoffkanister, Ballons, UFOs, Edelsteine, Schallmauer-Effekt und eine prozedurale Low-Poly-Landschaft mit Flüssen, Seen, Bergen und Wäldern.

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

Weil `js/core.js` ohne Browser auskommt, lässt sich das Balancing mit Node simulieren: Ein Bot fliegt, verdient und kauft ein. Die Preise sind so abgestimmt, dass ein perfekter Bot etwa 130 Flüge bis zur Heliopause braucht und jede neue Zone ähnlich viele Flüge kostet.
