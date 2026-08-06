# Tester

Kördes tidigare bara i en temporär katalog och försvann när containern
startades om. Ligger nu i repot i stället.

## Köra

```bash
npm test              # serverstester, ingen webbläsare behövs
npm run test:ui       # webbläsartester (kräver Chromium + playwright-core)
```

`npm run test:ui` startar appen på port 5959 mot en oåtkomlig databas — alla
API-svar mockas i testet, så ingenting rör riktig data.

## Att veta

- **Mockade PostgREST-svar:** `.single()` får ett **ensamt objekt**, inte en
  array. Svarar mocken med `[{...}]` blir `data` arrayen och fält som
  `sale.sale_items` blir tysta `undefined` — ett fel som ser ut som en bugg
  i appen men ligger i testet.
- **`html2pdf` hämtas från cdnjs**, som inte går att nå från testmiljön.
  UI-testet stubbar biblioteket och kontrollerar vår egen kedja: JSON →
  dokument → rätt element → filnamn → nedladdning. Själva renderingen är
  alltså inte testad här; den används redan av fakturan i produktion.
- **Textkontroller räcker inte för layout.** Korten i kundens Purchases
  pressades en gång till 2 px medan texten låg kvar i DOM:en. Mät höjder.
