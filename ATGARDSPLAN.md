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
1. Låt lager-/linsformulären ladda upp bilden via befintliga `/api/upload` (som chatten gör) och spara URL i `image`-kolumnen i stället för base64.
2. `sale_items.image` sparar samma URL (ingen duplicering).
3. Migreringsskript (engångs, körs av servern eller manuellt): läs alla rader där `image LIKE 'data:%'`, ladda upp till storage, ersätt med URL.
4. Frontend är redan URL-agnostisk (`<img src>` funkar för båda) — katalog-PDF:en (jsPDF `addImage`) behöver dock hämta bilden till dataURL först; lägg en liten `urlToDataUrl()`-hjälpare i `inventory.js`.

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

## Prioriteringsförslag per session

| Session | Innehåll | Berör server? |
|---|---|---|
| 1 | P0: punkt 1–3 (ägarkontroller) + 6 (uppladdningsgränser) | Ja — omstart |
| 2 | P0: punkt 4–5 (rate limit, async hash, JWT-expiry, tokenrotation) | Ja — omstart |
| 3 | P1: punkt 7 (bilder → storage, inkl. migrering) | Ja — omstart |
| 4 | P1: punkt 8–9 (fakturasekvens + transaktionell försäljning, SQL-migration) | Ja — omstart |
| 5 | P1: punkt 10–12 + P2 efter behov | Ja — omstart |
| 6 | P3: punkt 16–19 (refaktor + CI + CLAUDE.md) | Nej |

**Testchecklista efter varje deploy:** admin-login, klient-login, skicka meddelande åt båda håll (med bild), skapa sälj (lagret uppdateras i UI), broadcast med bild (landar på senaste), push-notis till båda admin-enheterna + klick landar rätt, katalog-PDF.
