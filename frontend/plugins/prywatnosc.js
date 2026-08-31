/**
 * Wtyczka konfiguracyjna Expo - A12: WYLACZENIE KOPII ZAPASOWEJ APLIKACJI.
 *
 * To jest ryzyko, ktore najlatwiej przeoczyc. iOS domyslnie wysyla dane
 * aplikacji do iCloud, a Android do Google Drive. Bez tej wtyczki lokalna
 * baza klientow warsztatu ladzie w prywatnej chmurze mechanika - poza
 * kontrola warsztatu i poza umowa powierzenia przetwarzania danych.
 *
 * Co robi:
 *   Android - android:allowBackup="false" oraz wylaczenie automatycznego
 *             backupu i D2D w AndroidManifest.xml.
 *   iOS     - dopisuje do AppDelegate ustawienie isExcludedFromBackupKey
 *             na katalogu Documents (tam mieszka plik SQLite).
 *
 * SPRAWDZ TO PO ZBUDOWANIU APLIKACJI, NIE ZAKLADAJ (patrz
 * DO-ZROBIENIA-RECZNIE.md, punkt "weryfikacja kopii zapasowych").
 * Wtyczka dziala przy `expo prebuild` / `eas build`; w Expo Go nie ma
 * zastosowania - i dlatego Expo Go nadaje sie tylko do prob, nie do pracy.
 */
const { withAndroidManifest, withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const ZNACZNIK = 'warsztat-a12-bez-kopii';

/* ----------------------------- Android -------------------------------- */

function androidBezKopii(config) {
  return withAndroidManifest(config, (konfiguracja) => {
    const aplikacja = konfiguracja.modResults.manifest.application?.[0];
    if (!aplikacja) return konfiguracja;

    aplikacja.$['android:allowBackup'] = 'false';
    aplikacja.$['android:fullBackupContent'] = 'false';
    // Android 12+ - blokada przenoszenia danych miedzy urzadzeniami.
    aplikacja.$['android:dataExtractionRules'] = '@xml/warsztat_bez_kopii';

    return konfiguracja;
  });
}

/**
 * Plik regul dla Androida 12+. Bez niego atrybut dataExtractionRules
 * wskazywalby na nieistniejacy zasob i build by sie wywalil.
 */
function androidRegulyEkstrakcji(config) {
  const { withDangerousMod } = require('expo/config-plugins');
  const fs = require('fs');
  const path = require('path');

  return withDangerousMod(config, ['android', async (konfiguracja) => {
    const katalog = path.join(
      konfiguracja.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml',
    );
    fs.mkdirSync(katalog, { recursive: true });
    fs.writeFileSync(
      path.join(katalog, 'warsztat_bez_kopii.xml'),
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<!-- A12: dane warsztatu nie opuszczaja telefonu przez kopie zapasowa -->',
        '<data-extraction-rules>',
        '    <cloud-backup>',
        '        <exclude domain="root" />',
        '        <exclude domain="database" />',
        '        <exclude domain="sharedpref" />',
        '        <exclude domain="file" />',
        '        <exclude domain="external" />',
        '    </cloud-backup>',
        '    <device-transfer>',
        '        <exclude domain="root" />',
        '        <exclude domain="database" />',
        '        <exclude domain="sharedpref" />',
        '        <exclude domain="file" />',
        '        <exclude domain="external" />',
        '    </device-transfer>',
        '</data-extraction-rules>',
        '',
      ].join('\n'),
      'utf8',
    );
    return konfiguracja;
  }]);
}

/* -------------------------------- iOS --------------------------------- */

const KOD_SWIFT = `
    // ${ZNACZNIK}: katalog z baza warsztatu nie trafia do kopii iCloud (A12).
    if var katalogDanych = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
      var wartosci = URLResourceValues()
      wartosci.isExcludedFromBackup = true
      try? katalogDanych.setResourceValues(wartosci)
    }
`;

function iosBezKopii(config) {
  return withAppDelegate(config, (konfiguracja) => {
    const { contents } = konfiguracja.modResults;

    if (contents.includes(ZNACZNIK)) return konfiguracja;

    // Szukamy poczatku didFinishLaunchingWithOptions i wstawiamy zaraz za nim.
    const wzor = /(func\s+application\([^)]*didFinishLaunchingWithOptions[\s\S]*?\)\s*->\s*Bool\s*\{)/;
    if (!wzor.test(contents)) {
      // Nie przerywamy buildu - ale glosno mowimy, ze trzeba to zrobic recznie.
      console.warn(
        '[prywatnosc] Nie rozpoznano AppDelegate. Wylaczenie kopii iCloud (A12) '
        + 'trzeba dodac recznie - patrz DO-ZROBIENIA-RECZNIE.md.',
      );
      return konfiguracja;
    }

    konfiguracja.modResults.contents = contents.replace(wzor, `$1\n${KOD_SWIFT}`);
    return konfiguracja;
  });
}

/** Aplikacja nie uzywa aparatu ani galerii - kasujemy zbedne zgody. */
function iosBezAparatu(config) {
  return withInfoPlist(config, (konfiguracja) => {
    delete konfiguracja.modResults.NSCameraUsageDescription;
    delete konfiguracja.modResults.NSPhotoLibraryUsageDescription;
    delete konfiguracja.modResults.NSPhotoLibraryAddUsageDescription;
    delete konfiguracja.modResults.NSLocationWhenInUseUsageDescription;
    return konfiguracja;
  });
}

module.exports = function prywatnosc(config) {
  let wynik = androidBezKopii(config);
  wynik = androidRegulyEkstrakcji(wynik);
  wynik = iosBezKopii(wynik);
  wynik = iosBezAparatu(wynik);
  return wynik;
};
