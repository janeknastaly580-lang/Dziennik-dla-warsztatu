/**
 * Mostek miedzy ekranami a systemem.
 *
 * To JEDYNE, co ekrany widza z Windowsa. Nie ma tu `require`, nie ma dostepu
 * do plikow ani do sieci - tylko nazwane operacje, ktore obsluguje proces
 * glowny (`glowny.js`). Dzieki temu blad w kodzie ekranu (albo tresc wklejona
 * przez kogos do pola tekstowego) nie ma jak siegnac do dysku.
 *
 * Po stronie aplikacji ten obiekt widac jako `window.warsztat`
 * - patrz `frontend/src/dane/mostWindows.ts`.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('warsztat', {
  system: {
    /** Nazwa komputera i konta - pod tym administrator widzi urzadzenie. */
    opis: () => ipcRenderer.invoke('system:komputer'),
  },

  /** A4: klucz do bazy i token urzadzenia, zaszyfrowane przez DPAPI. */
  klucz: {
    czytaj: (nazwa) => ipcRenderer.invoke('klucz:czytaj', nazwa),
    zapisz: (nazwa, wartosc) => ipcRenderer.invoke('klucz:zapisz', nazwa, wartosc),
    skasuj: (nazwa) => ipcRenderer.invoke('klucz:skasuj', nazwa),
  },

  /** A4: zaszyfrowana baza SQLCipher w katalogu danych aplikacji. */
  baza: {
    otworz: (klucz) => ipcRenderer.invoke('baza:otworz', klucz),
    polecenia: (sql) => ipcRenderer.invoke('baza:polecenia', sql),
    pobierz: (sql, parametry) => ipcRenderer.invoke('baza:pobierz', sql, parametry),
    wszystkie: (sql, parametry) => ipcRenderer.invoke('baza:wszystkie', sql, parametry),
    wykonaj: (sql, parametry) => ipcRenderer.invoke('baza:wykonaj', sql, parametry),
    zamknij: () => ipcRenderer.invoke('baza:zamknij'),
    skasuj: () => ipcRenderer.invoke('baza:skasuj'),
  },
});
