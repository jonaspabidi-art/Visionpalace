# Åtgärdsplan — Vision Palace

> Genomgång av hela kodbasen 2026-07-07. Detta dokument är skrivet som arbetsunderlag
> för kommande AI-sessioner (Sonnet/Opus): varje punkt har problem, plats i koden och
> en konkret lösning. Jobba uppifrån och ner — P0 före P1 osv. Appen används skarpt
> av kunder: gör en punkt i taget, verifiera, deploya, gå vidare.
>
> Arbetsflöde som använts hittills: utveckla på branchen
> `claude/admin-sales-ui-product-ref-0a1qyz`, öppna PR mot `main`, squash-merga
> (merge = deploy). Servern måste startas om när filer under `server/` ändras.
> Bumpa `CACHE`-versionen i `public/sw.js` vid varje frontend-release.

---

## P0 — Säkerhet (fixa först)

### 1. Meddelande-endpoints saknar ägarkontroll (cross-admin-åtkomst)
**Plats:** `server/routes/messages.js:10` (GET `/messages/:clientId`), `:28` (POST `/messages/:clientId`), `:125` (POST `/messages/:clientId/read`)
**Problem:** Ingen kontroll att klienten tillhör `req.adminId`. Vilken inloggad admin som helst kan läsa och skriva i vilken klients tråd som helst. Idag finns två admin-konton så risken är intern, men det är fel och blir farligt om fler admins läggs till.
**Lösning:** Hämta klienten först och kräv `client.admin_id === req.adminId`, annars 404. Samma mönster som `sales.js` redan använder (`.eq('admin_id', req.adminId)`).

### 2. Broadcast-radering raderar data före ägarkontrollen
**Plats:** `server/routes/broadcasts.js:97–112`
**Problem:** `broadcast_media` (inkl. filer i storage), och `broadcast_reactions` raderas för det angivna id:t INNAN ägarskapet kontrolleras — bara själva `broadcasts`-raden skyddas av `.eq('admin_id')`. En admin kan alltså förstöra en annan admins broadcast-media genom att skicka dess id.
**Lösning:** Slå upp broadcasten med `.eq('id').eq('admin_id', req.adminId)` FÖRST; 404 om ingen träff; radera media/reaktioner därefter.

### 3. Samma hål i reaktions-/visnings-endpoints
**Plats:** `broadcasts.js:150` (GET `/reactions/:broadcastId`), `:172` (GET `/broadcasts/:id/views`), `:131` (POST `/reactions/` — klient kan reagera på annan admins broadcast), `:158` (POST `/broadcasts/views`)
**Lösning:** Verifiera att broadcasten tillhör rätt admin (admin-endpoints) resp. klientens `admin_id` (klient-endpoints) före läs/skriv.

### 4. Ingen rate limiting + blockerande lösenordshashning
**Plats:** `server/routes/auth.js:9` (admin-login), `:68` (klient-login); `server/lib/auth.js:5–17`
**Problem:** (a) Obegränsade loginförsök → brute force. (b) `pbkdf2Sync` med 100 000 iterationer körs synkront och blockerar hela event-loopen; klient-login itererar dessutom över ALLA klienter med samma namn och kör hashen per kandidat — en angripare kan DoS:a servern med loginanrop.
**Lösning:** `express-rate-limit` på `/api/auth/*` och `/api/join/*` (t.ex. 10 försök/15 min per IP). Byt `crypto.pbkdf2Sync` → `util.promisify(crypto.pbkdf2)` och gör `verifyPassword`/`hashPassword` async (uppdatera alla anropsplatser: auth.js, messages.js profil-route, index.js seedAdmins).

### 5. Admin-JWT utan utgångstid; klientens sessionstoken är permanent
**Plats:** `server/lib/auth.js:19` (`jwt.sign` utan `expiresIn`), `routes/auth.js:44+83` (session_token = uuid som aldrig roteras)
**Problem:** En läckt admin-token gäller för evigt. Klientens session_token lagras i klartext i DB, återlämnas vid varje login och roteras aldrig — läcker den är kontot öppet för alltid.
**Lösning:** (a) `expiresIn: '30d'` på admin-JWT + låt admin-appen hantera 401 genom att visa login (gör den redan). (b) Rotera session_token vid varje lyckad klient-login (`update session_token` + returnera nya). Lågrisk eftersom klient-appen redan sparar det returnerade värdet.

### 6. Uppladdning: 100 MB i minnet, ingen filtypskontroll
**Plats:** `server/routes/upload.js:5–11`
**Problem:** `multer.memoryStorage()` med 100 MB-gräns × 10 filer ⇒ upp till 1 GB RAM per request. Ingen MIME-vitlista — vad som helst kan laddas upp till den publika storage-bucketen.
**Lösning:** Sänk gränsen (t.ex. 50 MB video / rimligt för bilder), vitlista MIME-typer (`image/jpeg|png|webp|heic`, `video/mp4|quicktime|webm`), avvisa övrigt med 415.

---

## P1 — Stabilitet & dataintegritet

### 7. Base64-bilder lagras i databastabellerna (största prestandaproblemet)
**Plats:** `public/js/admin/inventory.js` (`compressInvImage` → `canvas.toDataURL` → `inventory.image`), samma mönster i `lenses.js`; kopieras vidare till `sale_items.image` vid varje försäljning (`sales.js`)
**Problem:** Varje lagervara bär ~100–500 KB base64 i en TEXT-kolumn. `GET /api/inventory` returnerar ALLT vid varje lager-öppning; försäljningar duplicerar bilden till `sale_items`; historik-vyn laddar allt igen. Databasen sväller och alla listvyer blir långsammare för varje månad.
**Lösning (stegvis, bakåtkompatibel):**
1. ✅ KLART (2026-07-07): Lager-/linsformulären laddar nu upp bilden via `/api/upload` och sparar URL i `image`-kolumnen (`uploadProductImage()` i `inventory.js`; blob-baserad `compressInvImage`). Nya/ändrade bilder blir URL:er; gamla base64-rader fungerar oförändrat.
2. ✅ KLART: `sale_items.image` kopierar värdet rakt av — för nya varor är det en URL (ingen duplicering).
3. ✅ SKRIPT KLART (`scripts/migrate-images.js`) — körs manuellt på servern: `node scripts/migrate-images.js --dry-run` först, sedan utan flaggan. Idempotent; misslyckade rader lämnas orörda och kan köras om. ÅTERSTÅR: att faktiskt köra det i produktion.
4. ✅ KLART: Katalog-PDF:erna konverterar URL:er via `imgToDataUrl()`-hjälparen i `inventory.js` (glasögon + linser); `_buildLensCatalogDoc` är numera async.

### 8. Fakturanummer kan kollidera (race condition)
**Plats:** `server/routes/sales.js:8–18` (`generateInvoiceNumber` läser max+1)
**Problem:** Två samtidiga försäljningar kan få samma nummer. Låg sannolikhet med en användare, men fel av redovisningskaraktär.
**Lösning:** Postgres-sekvens: `CREATE SEQUENCE invoice_seq;` och en RPC `next_invoice_number(prefix)` som gör `nextval`, eller enklare: UNIQUE-index på `sales.invoice_number` + retry-loop vid konfliktfel.

### 9. Försäljning skapas i fyra separata steg utan transaktion
**Plats:** `server/routes/sales.js:21–64`
**Problem:** `sales`-insert → `sale_items`-insert → `inventory`-delete → `lens_variants`-update körs som separata anrop. Kraschar servern halvvägs blir datat inkonsistent (t.ex. försäljning utan rader, eller rader utan lageruttag).
**Lösning:** Flytta hela flödet till en Postgres-funktion (`create_sale(client_id, items jsonb)`) som körs i en transaktion och anropas via `supabase.rpc()`. Behåll socket-emit + push i Node efteråt.

### 10. `clientAuth` skriver till databasen vid varje request
**Plats:** `server/lib/auth.js:51`
**Problem:** Varje klient-API-anrop gör en `UPDATE clients SET last_seen_at` — skrivförstärkning och onödig latens på alla klientanrop.
**Lösning:** Throttla: uppdatera bara om senaste `last_seen_at` är äldre än ~60 s (håll en in-memory Map clientId→timestamp).

### 11. Service workern cachar extern media obegränsat
**Plats:** `public/sw.js:16–30`
**Problem:** Fetch-handlern lägger ALLA GET-svar i cachen, även cross-origin (Supabase-storage-bilder/-videor). Cachen rensas aldrig → lagringsutrymmet på kundernas telefoner växer obegränsat.
**Lösning:** Cacha bara same-origin-requests (`url.origin === location.origin`), eller inför en separat mediacache med enkel LRU-rensning (behåll t.ex. 100 senaste posterna).

### 12. OneSignal-legacy blandad med web push
**Plats:** `server/lib/push.js` (`sendPushToAll`, `sendPushToPlayer`, `onesignal_player_id` dubbelanvänds som JSON-sub-lagring), `routes/push.js:43` (`/onesignal/register`)
**Problem:** Kolumnen `clients.onesignal_player_id` lagrar numera web-push-prenumerationer som JSON-strängar; OneSignal-koden är död vikt (env-nycklar krävs annars loggas fel). Förvirrande för underhåll.
**Lösning:** Döp om kolumnen till `push_subscription` (migration), ta bort OneSignal-funktionerna och `/onesignal/register`, ta bort `sendPushToPlayer`-anropet i `messages.js`.

---

## P2 — Prestanda & UX

### 13. Chatt och broadcast laddar hela historiken varje gång
**Plats:** `server/routes/messages.js:10+19`, `broadcasts.js:10`; frontenden renderar allt (`admin/clients.js openChat`, `client/messages.js renderMessages`, `broadcast.js renderFeed`)
**Lösning:** `?before=<timestamp>&limit=50` på API:erna; frontend laddar senaste 50 och hämtar äldre vid scroll-till-toppen (IntersectionObserver-sentinel). Gör chatten först — den växer snabbast.

### 14. Videor saknar poster och laddningsstrategi
**Plats:** `admin/clients.js msgHTML` (video utan `preload`), `client/messages.js`, `sw.js` (ingen videotumnagel genereras för video i `server/lib/upload.js:28`)
**Lösning:** Sätt `preload="metadata"` överallt; generera poster-bild server-side med ffmpeg om det finns i miljön, annars hoppa (lågprio).

### 15. Klienters visningsnamn är inte unika
**Plats:** `routes/auth.js:68–79` — login matchar `ilike` och provar lösenordet mot alla med samma namn.
**Lösning:** Unikt index (case-insensitivt) på `clients.display_name` + kontroll i `/join/:token` med tydligt felmeddelande. (Loginflödet kan därefter förenklas till en enda träff.)

---

## P3 — Kodkvalitet & underhåll

### 16. Pinning-hjälparen finns i tre kopior
**Plats:** `admin/broadcast.js pinFeedToBottom`, `admin/clients.js pinChatToBottom`, `client/messages.js scrollChat`
**Lösning:** En parametriserad hjälpare per app: `createBottomPin(containerId, rowSelector)` som returnerar `{ pin(), unpin() }`. Admin: lägg i `ui.js`; klient: i `ui.js`. Byt ut de tre implementationerna. (Medveten skuld från chatt-releasen.)

### 17. Duplicerad kod mellan admin- och klientappen
**Plats:** `compressImage`, `uploadFiles`, `saveMedia`, toast, spinner-CSS m.m. finns i båda apparna.
**Lösning:** Skapa `public/js/shared/` och låt båda HTML-sidorna inkludera gemensamma filer (`media.js`, `utils.js`). Flytta en funktion i taget, verifiera efter varje flytt.

### 18. Ingen CI, lint eller tester
**Lösning (minsta rimliga):**
1. `.github/workflows/ci.yml`: kör `node --check` på alla JS-filer + starta servern med dummy-env och verifiera att alla routes registreras (skriptet som använts manuellt i sessionerna kan läggas i `scripts/smoke.js`).
2. ESLint med enkel konfig (`eslint:recommended`, browser+node-miljöer).
3. På sikt: Playwright-röktest (login → skicka meddelande → skapa sälj) — Playwright finns förinstallerat i Claude-mijön.

### 19. CLAUDE.md saknas
**Lösning:** Skapa `CLAUDE.md` i repo-roten med: arkitekturöversikt (två separata vanilla-JS-appar + Express/Supabase, inga byggsteg, globalt scope per sida), deploy-flödet (PR → squash-merge → serveromstart), SW-cache-bumpning, att `verify` = `node --check` + route-smoke, och hänvisning till denna plan.

---

## Drift & miljö

### 20. Env-variabler odokumenterade
**Krävs idag:** `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `JWT_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `ADMIN_USERNAME/PASSWORD(/DISPLAY)`, `ADMIN2_*` (valfritt), `PORT`. `ONESIGNAL_*` kan tas bort med punkt 12.
**Lösning:** `.env.example` + avsnitt i README. Verifiera vid uppstart att kritiska variabler finns och logga tydligt vilka som saknas (idag kraschar `jwt.sign` med kryptiskt fel om `JWT_SECRET` saknas).

### 21. Supabase: RLS är inte aktiverat någonstans
**Problem:** Servern använder service-nyckeln så allt fungerar, men om anon-nyckeln någonsin exponeras är hela databasen öppen. Storage-bucketen `media` är publik (OK för produktbilder, men chattbilder ligger där också — vem som helst med URL kan se dem; URL:erna är slumpmässiga uuid:n vilket mildrar).
**Lösning:** Aktivera RLS med "deny all" på alla tabeller (service-nyckeln går förbi RLS, så servern påverkas inte). Överväg signerade URL:er för chattmedia på sikt.

### 22. `uncaughtException` sväljs
**Plats:** `server/index.js:82–87`
**Problem:** Servern hålls vid liv efter okända fel — kan lämna processen i trasigt tillstånd.
**Lösning:** Logga med stacktrace och låt processen dö + automatisk omstart via hostingens process-manager (verifiera att hostingen startar om vid krasch; annars pm2/systemd).

---

## Ny funktionalitet — Inköp & bokföring (beslutad 2026-07-08)

> Kontext från ägaren: appen används av ett slutet sällskap (3 admins i bolaget,
> klienter enbart via inbjudningslänk — inga öppna länkar). Försäljning sker till
> 99 % till UK utanför EU ⇒ **ingen moms** i något av flödena nedan. Inköp görs
> från Kering (distributör för Cartier) som skickar ett orderpapper med
> ref-nummer, antal och pris per rad. P0-säkerhetspunkterna ovan kvarstår men
> kan tas i lugnare takt givet den slutna användarkretsen — rate limiting på
> login (punkt 4) är fortfarande viktigast eftersom appen ligger på öppna
> internet.

### 23. Inköpslogg + "köpt av" (grunden — bygg först)
**Problem:** Inköp loggas inte. När en vara säljs RADERAS lagerraden — inköpspriset
lever bara kvar som kopia på `sale_items`, och en vara som aldrig säljs syns aldrig
i något underlag. Bokföring behöver inköpet **när det görs**. Lagret är dessutom
delat utan `admin_id`, så det syns inte vem av de två säljande admin-kontona som
gjort ett inköp.
**Lösning:**
1. Ny tabell (SQL körs i Supabase SQL Editor):
   ```sql
   CREATE TABLE purchases (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     admin_id uuid REFERENCES admins(id),
     inventory_id uuid,             -- ingen FK: lagerraden raderas vid sälj, loggen ska bestå
     name text NOT NULL,
     ref_code text,
     buy_price numeric,
     qty int NOT NULL DEFAULT 1,
     source text NOT NULL DEFAULT 'manual',   -- 'manual' | 'order_import'
     document_url text,             -- orderpapper (bild/PDF) i storage-bucketen
     created_at timestamptz NOT NULL DEFAULT now()
   );
   ```
2. `POST /api/inventory` skriver automatiskt en `purchases`-rad när en vara skapas
   (admin_id = `req.adminId`, buy_price/ref_code/name från varan). Ingen UI-ändring.
3. Liten "köpt av"-väljare i lagerformuläret (två knappar, förifylld med inloggad
   admin) om inköpet ska bokas på den andra admin. Skickas som `purchased_by` i
   POST-kroppen; default `req.adminId`.
4. Radering av lagervara ska INTE radera inköpsloggen (den är historik).

### 24. "Läs in order" — AI-avläsning av Kering-orderpapper
**Idé (ägarens):** fota/ladda upp orderpappret → appen läser av ref-nummer, antal
och pris → granskningslista → bekräfta → varorna skapas i lagret (kända ref-koder
återanvänder namn/bild/säljpris via befintliga `GET /inventory/ref-lookup`).

**Verkligt exempel granskat (`Kering_AR-26UK102622074623.pdf`, 2026-07-09):** riktig
Kering-faktura, ren PDF (inte fotat papper) — förenklar avläsningen. Struktur:
- Artikelrad: `CT0582S-005 56 Sunglass MAN METAL` i en enda "Article Description"-
  kolumn. Ref-koden är `CT0582S-005` (mönster `CT\d+[A-Z]?-\d+`), `56` är
  linsstorlek (ointressant för oss), resten är produktbeskrivning.
- Kvantitet i egen `Qty`-kolumn.
- Pris i `Net Total`-kolumnen, **europeiskt talformat**: `12.072,00` = 12 072,00
  (punkt = tusentalsavgränsare, komma = decimal) — INTE 12,072. Modellen måste
  instrueras explicit att normalisera detta till en vanlig decimal (`12072.00`),
  annars kan den läsa fel.
- **Valuta: SEK**, inte EUR — fakturan totalsumman anges uttryckligen `SEK`.
  Appens `buy_price`/`sell_price` visas dock genomgående i €. Extraherat pris
  måste därför **konverteras SEK→EUR innan det sparas** (ägarens beslut
  2026-07-09), annars blir vinstuträkningen i Historik (`sell_price − buy_price`)
  fel utan att synas. Enklaste lösning: en redigerbar växelkurs i `app_settings`
  (t.ex. `sek_eur_rate`, defaultvärde satt manuellt, uppdateras vid behov via ett
  fält i adminvyn) — undviker beroende av ett externt valuta-API. Räkna
  `buy_price_eur = round(net_total_sek * rate, 2)` per rad. Visa BÅDA beloppen
  i granskningslistan (SEK från fakturan + beräknat EUR) så avvikelser upptäcks
  innan bekräftelse.
- Momsraden `0% reverse charge` bekräftar att inköpen är momsfria för oss —
  inget extra att hantera.

**Modellval:** `claude-haiku-4-5` räcker (enkel strukturerad extraktion ur dokument;
vision + PDF stöds). Pris $1/M input-tokens, $5/M output. En order ≈ 2 000 in +
400 ut ≈ **$0,004 ≈ 4 öre per order**. Blir avläsningen opålitlig på stökiga foton:
byt modellsträngen till `claude-sonnet-5` (~3× dyrare, fortfarande ören). Kräver
förbetalda API-krediter hos Anthropic (min. $5 — räcker i åratal på denna volym).
**Bygge:**
1. Env-variabel `ANTHROPIC_API_KEY` i Railway. Installera `@anthropic-ai/sdk`.
2. Ny route `POST /api/orders/parse` (adminAuth, multer, 1 fil: jpeg/png/webp/pdf):
   skicka filen som `document`-block (PDF) resp. `image`-block (foto) till
   Messages API. System-instruktion måste täcka: (a) extrahera ref-kod med
   mönstret ovan ur "Article Description"-fältet, inte separata ID/UPC-kolumner,
   (b) normalisera europeiskt talformat till vanlig decimal, (c) läsa av
   valutan från fakturans summeringsfält (`Invoice Summary` / `Total amount`)
   och skicka med i svaret så servern vet vilken kurs som ska tillämpas —
   anta inte alltid SEK, andra leverantörer kan fakturera i EUR/USD.
   Använd `output_config.format` med json_schema så svaret alltid är giltig
   JSON: `[{ref_code, qty, net_total, currency}]`. Servern konverterar till EUR
   och svarar `{ rows: [{ref_code, qty, buy_price_eur, buy_price_original,
   currency_original}] }`.
3. Granskningsvy i Lager-fliken ("Läs in order"-knapp): varje rad slås upp mot
   `GET /inventory/ref-lookup` — träff = grön rad med förifyllt namn/bild/säljpris;
   okänd ref = gul rad där namn/bild fylls i manuellt (sparas till nästa gång).
   Antal N ⇒ N lagerrader. Visa `buy_price_original currency_original` (t.ex.
   "12 072,00 SEK") bredvid det beräknade EUR-beloppet på varje rad, redigerbart,
   så en felaktig kurs eller feltolkning upptäcks direkt. **Aldrig auto-skapande
   utan bekräftelse.**
4. Vid bekräftelse: ladda upp originaldokumentet via befintliga `/api/upload`,
   skapa lagerrader + `purchases`-rader (source `'order_import'`, `document_url`).
5. Felväg: om AI-anropet misslyckas visas ett tydligt fel och man använder
   vanliga skapa produkt-flödet — inget annat påverkas.

### 25. ✅ KLART (2026-08-04) — Bokföringsexport (CSV per månad och admin)
**Byggt:** `GET /api/export/bookkeeping?month=YYYY-MM` (adminAuth) +
"Exportera bokföring →" under varje månadsrubrik i Historik. Filen delas via
delningsmenyn på mobil (`navigator.share`) med nedladdning som reserv — en ren
nedladdningslänk hamnar svårhittat i en iOS-PWA.
**Tre sektioner i en fil:** FÖRSÄLJNINGAR (en rad per vara med datum, betaldatum,
fakturanr, kund, status, ref, antal, á-pris, belopp, inköpspris, vinst + summarad),
INKÖP (från `purchases`, med länk till originalfakturan) och BETALNINGAR (från
`sale_payments`, med länk till kvittobilden).
**Avräkningen (punkt 26) ingår medvetet inte** — ägaren bokför utbetalningarna
till säljarna separat (hans beslut 2026-08-04). Saldot finns kvar i appen som förut.
**Omfattning (ägarens besked 2026-08-04): filen täcker hela bolaget.** Bokföringen
görs på ett bolag, så exporten filtrerar **inte** på `admin_id` — båda admin-kontonas
försäljningar och de gemensamma inköpen ligger i samma fil, och en fil räcker oavsett
vilket konto den laddas ner från. Kolumnerna **"Sålt av"** och **"Inlagt av"** håller
ändå isär vem som gjort vad. Obs: Historik visar fortfarande bara det egna kontots
sälj — därför står det "hela bolaget" på exportknappen.
Båda namnkolumnerna hämtas via koppling till `admins`; går kopplingen inte att läsa
görs om anropet utan den, så en sektion aldrig faller bort för en kolumns skull.
**CSV-formatet:** semikolon, decimalkomma och UTF-8-BOM, annars öppnar svenska
Excel filen som en kolumn med trasiga åäö. Inga momskolumner (export utanför EU).
Ingen API-integration mot bokföringsprogram byggs förrän exporten visat sig otillräcklig.

### 26. ✅ KLART (2026-07-12) — Avräkningskonto (70 % provision till säljarna)
**Bakgrund:** Två personer delar ett admin-konto och säljer under bolagsägarens
bolag (som har eget konto). Säljarna tar 70 % av vinsten. Följdes tidigare i Excel.
**Byggt:** `settlements`-tabell + `GET/POST/DELETE /api/settlement*` +
kort överst i Historik. Saldot **räknas fram** ur försäljningarna varje gång
(lagras aldrig) — bara utbetalningar och ingående saldo persisteras.
**Regler (ägarens beslut 2026-07-12):**
- Provision räknas först vid status betald/skickad/levererad; avbrutna räknas
  aldrig; obetalda visas separat som "väntar på betalning".
- Frakt delas inte (rader utan `buy_price` är genomgång, inte marginal).
- Båda kontona ser samma siffror och båda får registrera utbetalning;
  tredje admin utanför paret får 403.
- Varning visas för sälj där ingen rad har inköpspris (ger tyst 0 i provision).
**Uppsättning:** `supabase/migrations/008_settlement.sql` — användarnamnen fylls i
och körs i Supabase. Innan dess svarar endpointen `not_configured` och kortet är dolt.
**Satsändring:** `sales.commission_pct` fryser satsen per sälj; kör backfillen som
står dokumenterad i SQL-filen INNAN satsen ändras, annars räknas historiken om.
**Eurokursen: EN fast kurs, medvetet (ägarens beslut 2026-08-05).** Kurs per
försäljning byggdes och backades på hans begäran: *"jag vill ha kvar kursen på
samma som innan, de behövs inte att vi gör olika per köp."* Kursen ligger alltså
kvar i `settlement_config` och gäller alla sälj. **Följden att känna till:** ändras
den räknas hela historiken om — även gamla sälj. Vill man ändå ändra den, frys först
historiken med `UPDATE sales SET eur_sek_rate = ...` (kolumnen finns inte längre;
återinför den i så fall från git-historiken, PR #36).

**Byggordning:** 23 → 24 → 25, allt klart 2026-08-04. Punkt 26 gjordes separat.

### 30. ✅ KLART (2026-08-05) — Sälja till kund utanför appen
**Bakgrund:** Ägaren: "ibland gör vi försäljningar med folk som inte har appen."
`sales.client_id` var obligatorisk, så det gick inte alls.
**Byggt:** `supabase/migrations/010_walkin_customers.sql` — `customer_name`,
`client_id` blir valfri, och ett CHECK som kräver **antingen** klient **eller**
namn så inget sälj kan bli utan köpare. I säljrutan finns valet "Kund utanför
appen…" som fäller ut ett namnfält. Historik och bokföringsexport visar namnet.
**Att veta:** en sådan köpare får inga notiser och ser inget i appen — det står i
rutan. Push och socket-utskick hoppas över när `client_id` saknas, och
verifieringen efter ett tappat svar söker på namnet i stället för klientlistan.

### 31. ✅ KLART (2026-08-05) — Fylla på antal på en befintlig vara
**Bakgrund:** Ägaren: "nu är de 3 av en modell men vi har 4 så ska kunna trycka
plus." Tidigare fick man skapa om produkten, med risk att namn eller pris skrevs
olika så högen delade upp sig i två kort.
**Byggt:** `POST /inventory/:id/restock` kopierar raden (ref, namn, priser, bild,
anteckning) så många gånger som anges, max 50. Varumenyn har "Lägg till ett
exemplar · 3 st → 4 st" och "Lägg till flera…".
**Bokföring:** varje nytt exemplar loggas i `purchases` precis som när en vara
skapas — annars hade lagret vuxit utan spår i inköpsloggen.

### 27. ✅ KLART (2026-08-04) — Uppstädning av Lager och sidhuvud
**Bakgrund:** Ägaren: "vid import av lager ser de lite stökigt ut mkt knappar runt."
På telefon radbröt katalogknapparna till "Läs / in / order" och tryckte undan
flikarna Glasögon/Linser utanför vänsterkanten. I sidhuvudet sköts "Logga ut"
utanför skärmen så fort notisknappen syntes.
**Gjort:**
- Verktygsraden i Lager är en rad: flikarna till vänster, allt annat bakom **Mer**
  (Läs in order, Katalog PDF, Skicka katalog — olika val för glasögon och linser).
- Varje vara har bara **+ Sälj** kvar plus prickar; Redigera och Ta bort ligger i
  en meny per vara, så den röda papperskorgen inte längre sitter bredvid säljknappen.
- Kundvagnen är en **bred stapel längst ner** i stället för en liten knapp uppe i
  hörnet. Plusknappen flyttar upp när stapeln visas.
- Sidhuvudet: **+ Bjud in** visas på Klienter där man faktiskt bjuder in, och
  notiser + utloggning ligger i en kontomeny bakom prickarna. En gulprick på
  menyknappen så länge notiser inte är påslagna.
### 28. ✅ KLART (2026-08-04) — Dubbletter i lagret slås ihop i vyn
**Bakgrund:** Ägaren: "Nu skapas de som enskilda produkter och katalogen blir lång
pga dubbletter." Lagret har en rad per fysiskt par (fakturaimport av 3 st ger 3 rader).
**Bugg som hittades på vägen:** antalsräknaren i försäljningen registrerade antal 3
men tog bara bort **en** lagerrad — två par låg kvar som spöken. Bevisat mot koden
(`sale_items qty: 3`, `DELETE ?id=in.(i1)`).
**Beslut:** raderna ligger kvar en per par i databasen — varje par har eget
inköpspris och egen rad i inköpsloggen, och både avräkning och bokföring bygger på
det. Ihopslagningen görs **bara i vyn**, på ref-koden (fallback: namnet).
**Byggt:**
- `invGroups` (klient) grupperar `invItemsMap`; Lager visar ett kort per modell med
  "N st". Olika säljpris i samma hög flaggas och det senaste visas.
- Korgraden bär `ids[]` — antal är alltid `ids.length`, och man kan aldrig välja
  fler än vad som står i lagret. Sälj skickar `inventory_ids` så servern tar bort
  exakt de paren.
- Servern delar raden **per inköpspris**: lika priser ⇒ en rad med antal 3 (kort
  faktura), olika ⇒ en rad per pris (rätt vinst). Äldre klient som bara skickar
  antal får resten utpekad via ref-koden i städningssteget.
- `PATCH /inventory` (ids) och `POST /inventory/delete` (ids) — en ändring gäller
  hela högen, annars delar den upp sig i flera kort.
- Katalogen: en post per modell, med **"N in stock"** (ägarens val 2026-08-04).
- Säljer det andra kontot ett par som ligger i min korg plockas det ur korgen.

**Att veta:** katalog-PDF:erna visade förloppet i knappen de startades från. Den
knappen ligger nu i en meny som stängs, så förloppet visas som notis i stället och
dubbeltryck stoppas av en flagga (`_catalogBusy` / `_lensCatalogBusy`).
De nya klasserna ligger inline i `admin.html` av samma skäl som scrollen i Historik.

---

## Prioriteringsförslag per session

| Session | Innehåll | Berör server? |
|---|---|---|
| 1 | P0: punkt 1–3 (ägarkontroller) + 6 (uppladdningsgränser) | Ja — omstart |
| 2 | P0: punkt 4–5 (rate limit, async hash, JWT-expiry, tokenrotation) | Ja — omstart |
| 3 | P1: punkt 7 (bilder → storage, inkl. migrering) | Ja — omstart |
| 4 | P1: punkt 8–9 (fakturasekvens + transaktionell försäljning, SQL-migration) | Ja — omstart |
| 5 | P1: punkt 10–12 + P2 efter behov | Ja — omstart |
| 6 | P3: punkt 16–19 (refaktor + CI + CLAUDE.md) | Nej |
| ~~7~~ | ~~Punkt 23 + 24 + 25 (inköpslogg, betalningsbilder, AI-import, bokföringsexport)~~ ✅ klar 2026-08-04 | — |
| ~~—~~ | ~~Punkt 26 (avräkningskonto)~~ ✅ klar 2026-07-12 | — |

**Testchecklista efter varje deploy:** admin-login, klient-login, skicka meddelande åt båda håll (med bild), skapa sälj (lagret uppdateras i UI), broadcast med bild (landar på senaste), push-notis till båda admin-enheterna + klick landar rätt, katalog-PDF.
