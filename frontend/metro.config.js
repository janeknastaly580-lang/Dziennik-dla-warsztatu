/**
 * Konfiguracja Metro.
 *
 * Jedyny powod, dla ktorego ten plik istnieje: wersja WEBOWA aplikacji.
 * `expo-sqlite` uruchamia w przegladarce SQLite skompilowany do WebAssembly
 * i importuje plik `.wasm`, ktorego Metro domyslnie nie zna (sprawdzone:
 * `wasm` nie ma w domyslnym `assetExts`). Bez tej linijki wejscie na
 * localhost konczy sie bledem
 * "Unable to resolve module ./wa-sqlite/wa-sqlite.wasm".
 *
 * Do buildu APK / IPA ten plik nie jest potrzebny - tam SQLite jest natywny.
 *
 * CZEGO TU CELOWO NIE MA: naglowkow Cross-Origin-Opener-Policy /
 * Cross-Origin-Embedder-Policy. Byly tu wczesniej, ustawiane przez
 * `config.server.enhanceMiddleware`, i NIE DZIALALY - serwer deweloperski
 * Expo ma wlasny stos posrednikow i tego haka nie wywoluje (sprawdzone
 * naglowkami odpowiedzi z localhost:8081). Nie sa zreszta potrzebne:
 * SharedArrayBuffer jest w expo-sqlite uzywany wylacznie przez SYNCHRONICZNE
 * odmiany zapytan (`execSync`, `getFirstSync`, ...), a ta aplikacja wola
 * wylacznie odmiany asynchroniczne. Jesli kiedykolwiek pojawi sie tu
 * wywolanie *Sync, trzeba bedzie postawic wlasny serwer z tymi naglowkami.
 */
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Traktuj .wasm jak zasob, a nie jak modul JS.
config.resolver.assetExts.push('wasm');

module.exports = config;
