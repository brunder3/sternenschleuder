# Sternenschleuder



Name, Grafik und Oberfläche sind eigenständig. Alle Modelle, Texturen und Sounds 

## Spielen

Online spielen: **https://brunder3.github.io/sternenschleuder/**

Oder `index.html` im Browser öffnen, per Doppelklick. Es gibt keinen Build-Schritt und keine Installation. three.js liegt als Datei unter `vendor/`, das Spiel läuft also auch offline. Der Spielstand wird automatisch im `localStorage` des Browsers gespeichert.

## Grafik

Himmel, Boden (Gras, Fels, Sand, Erde), Wolken, Wasser, die Milchstraße sowie Erde, Mond, Mars, Jupiter und Saturn aus dem All sind echte Fotos. Sie stecken eingebettet in `js/photos.js`, damit das Spiel auch offline per Doppelklick läuft. Die Münzen sind geprägtes Metall mit Rand und Stern, das den Himmel spiegelt.

Drei Raketen sind originalgetreue NASA-Modelle: Spatz ist eine Jupiter-C, Polaris eine Ares I-X und Titan eine Saturn V mit fünf Triebwerken. Neben der Startschiene steht der Startturm des Mobile Launcher. Die übrigen Raketen werden zur Laufzeit gebaut: geschweißte Blechringe mit Nieten, Kabelkanal, Steuerdüsen, aufgemalter Name, Ruß am Heck und echte Triebwerksglocken (bei langen Raketen drei oder fünf), deren Abgasstrahl Machsche Knoten zeigt. Die Startrampe hat eine Betonplatte mit Fugen und Brandspuren und eine Startschiene aus geschweißtem Stahlfachwerk.

Der Weg ins All folgt der echten Atmosphäre:
- Über dem Jetstream liegen alle Wolken unter der Rakete. Ab der Stratosphäre wird der Himmel über ihr dunkel, und die Luft schrumpft zu einem leuchtenden Saum über dem Horizont, der mit der Höhe absinkt.
- Ab etwa 50 km versinkt das Land im blauen Dunst und geht in die gekrümmte Erdkugel mit ihrer Atmosphäre über.
- Beim Durchbrechen der Schallmauer bildet sich ein Kondensationskegel um die Rakete. Im Vakuum weitet sich der Abgasstrahl auf, und die Machschen Knoten verschwinden.

Fällt die Rakete schnell aus dem All zurück, glüht beim Durchqueren der oberen Atmosphäre (etwa 130 bis 25 km) die Luft vor ihr als Plasma. Funken und ein leuchtender Schweif ziehen hinter ihr her, und die Nase dreht sich in den Fahrtwind. Das ist reine Animation, der Flug selbst läuft ganz normal weiter.

Die Kamera folgt der Rakete über einen gedämpften Versatz, fällt also auch bei hohem Tempo nicht zurück. Sie wackelt weich statt zu zittern und senkt den Blick im All, damit Horizont und Erde im Bild bleiben.

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
- **Begleiter wie in Pet-Simulatoren:** 8 Eier, die nach und nach mit den Zonen freigeschaltet werden, und 40 Begleiter in fünf Seltenheiten (gewöhnlich bis mythisch). Sie fliegen als kleine 3D-Wesen um die Rakete und geben Bonus auf Münzen, Schub, Tank oder Magnet. Fünf gleiche fusionieren zu einem goldenen mit doppeltem Bonus. Eine Sammlung mit +5 % Münzen pro vollständigem Ei. Die Plätze steigen mit Rebirths, die Begleiter bleiben beim Rebirth erhalten.
- **Belohnungen fürs Wiederkommen und Dabeibleiben:** 7-Tage-Kalender (ein verpasster Tag pausiert ihn nur), Geschenke nach 2 bis 60 Minuten Spielzeit, ein Gratis-Dreh am Glücksrad alle drei Stunden, Boosts (2× Münzen, 2× Glück), ein Pilotenlevel mit XP für jeden Flug (+1 % Münzen pro Level) und einlösbare Codes.
- **97 Quests** mit Belohnungen, dazu jeden Tag **drei Tages-Quests** und ein Tagesbonus, wenn alle drei erledigt sind.
- **Rebirth** wie in Roblox-Simulatoren: Hast du das Rebirth-Ziel erreicht (zuerst den Weltraum, dann Geostationäre Bahn, Mond, Mars … bis Andromeda), kannst du neu starten. Münzen, Upgrades und Raketen sind dann weg, dafür bringt jeder Flug für immer mehr Münzen (×2, ×3, ×4 …). Ab der Titan brauchen die Raketen eine Mindestzahl an Rebirths, ohne Rebirth geht es ab dem Asteroidengürtel kaum noch weiter.
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
| `.github/workflows/pages.yml` | Veröffentlicht das Spiel bei jedem Push auf `main` über GitHub Pages |
| `vendor/three-extras.min.js` | Zusätze aus three.js r159 (EffectComposer, Bloom, OutputPass, GLTFLoader, MeshoptDecoder), als klassisches Skript gebündelt |

Weil `js/core.js` ohne Browser auskommt, lässt sich das Balancing mit Node simulieren: Ein Bot fliegt, verdient, kauft ein und macht Rebirths. Mit Rebirths braucht er etwa 12 Rebirths und rund 475 Flüge bis Andromeda. Ohne Rebirth kommt er nach etwa 180 Flügen bis zum Asteroidengürtel und danach kaum weiter. Jenseits der Heliopause werden Treibstoffkanister seltener, damit dort Tank und Triebwerk über die Reichweite entscheiden.

## Bildnachweis

- Himmel (Skybox), Gras, Fels, Sand, Erde, Milchstraße und Wasserwellen: [Babylon.js Assets](https://github.com/BabylonJS/Assets), Lizenz [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Erde, Wolken der Erde und Mond: NASA-Aufnahmen aus den Beispielen von [three.js](https://github.com/mrdoob/three.js) (MIT-Lizenz)
- Mars, Jupiter und Saturn: [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources), gemeinfrei
- 3D-Modelle von Saturn V, Jupiter-C, Ares I-X und dem Startturm des Mobile Launcher: [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources), gemeinfrei. Für das Spiel umgewandelt: Draco entfernt, meshopt-komprimiert, Texturen als WebP. Bei der Saturn V wurde das blaue Band der ersten Stufe weiß gefärbt, vom Mobile Launcher ist nur der Turm übrig.
- Quellwolke: [Poly Haven](https://polyhaven.com) über [@pmndrs/assets](https://github.com/pmndrs/assets), CC0
