# Vision Palace – Setup Guide

## 1. Supabase – Kör SQL-schemat

1. Gå till [supabase.com](https://supabase.com) → ditt projekt → **SQL Editor**
2. Kör hela innehållet i `supabase/schema.sql`
3. Kör `supabase/cleanup-function.sql` (kräver att `pg_cron`-tillägget är aktiverat under **Database → Extensions**)

### Supabase Storage
Schemat skapar automatiskt `media`-bucketen med publika läsrättigheter.  
Verifiera under **Storage → Buckets** att `media`-bucketen är skapad och markerad som **Public**.

---

## 2. OneSignal – Konfigurera push-notiser

1. Gå till [onesignal.com](https://onesignal.com) → skapa en ny app
2. Välj **Web Push**
3. Ange din Railway-URL (ex. `https://vision-palace.up.railway.app`)
4. Kopiera **App ID** och **REST API Key** till `.env`
5. Under **Settings → Keys & IDs**, se till att Web Push är aktiverat

---

## 3. Railway – Driftsätt

### Alternativ A: Direkt från GitHub

1. Pusha koden till ett GitHub-repo
2. Gå till [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**
3. Välj repot och låt Railway auto-detektera Node.js

### Alternativ B: Railway CLI

```bash
npm install -g @railway/cli
railway login
railway new
railway up
```

### Miljövariabler i Railway

Gå till din tjänst → **Variables** och lägg till:

```
SUPABASE_URL=https://kjmewtltinaqpfkwgnpb.supabase.co
SUPABASE_ANON_KEY=<din nyckel>
SUPABASE_SERVICE_KEY=<din nyckel>
JWT_SECRET=VisionPalace2024xK9mPqR7nLwZ3bN8
ADMIN_PASSWORD=<välj ditt lösenord>
ONESIGNAL_APP_ID=90d6532e-6887-42ce-8646-4354e6aa77fe
ONESIGNAL_API_KEY=<din nyckel>
PORT=3000
```

> **Viktig säkerhetsnotering:** Ändra `ADMIN_PASSWORD` till ett starkt lösenord innan driftsättning!

---

## 4. Ikoner (PWA)

Placera `icon-192.png` och `icon-512.png` i `public/icons/`.  
Använd en enkel design med "VP" på mörk bakgrund (#1a1a1a).

---

## 5. Användning

### Admin
- Gå till `https://din-app.up.railway.app/admin`
- Logga in med `ADMIN_PASSWORD`
- Skapa inbjudningslänkar via **"Bjud in klienter"**
- Publicera lageruppdateringar med text, pris och media

### Klienter
- Dela inbjudningslänken: `https://din-app.up.railway.app/join/<token>`
- Klienten väljer ett visningsnamn och loggas in permanent
- Kan se sändningar och chatta med admin privat

---

## 6. Filstruktur

```
vision-palace/
├── server/
│   └── index.js          ← Express + Socket.io backend
├── public/
│   ├── admin.html        ← Admin-gränssnitt
│   ├── client.html       ← Klientgränssnitt (PWA)
│   ├── manifest.json     ← PWA manifest
│   ├── sw.js             ← Service worker
│   └── icons/            ← PWA-ikoner (lägg till manuellt)
├── supabase/
│   ├── schema.sql        ← Databasschema
│   └── cleanup-function.sql ← Schemalagd mediaborttagning
├── .env                  ← Lokala miljövariabler (delas ej)
├── package.json
└── README.md
```

---

## 7. API-dokumentation (snabbreferens)

| Metod | Endpoint | Auth | Beskrivning |
|-------|----------|------|-------------|
| POST | `/api/auth/admin` | — | Admin-inloggning |
| POST | `/api/invite` | Admin JWT | Skapa inbjudningslänkar |
| POST | `/api/join/:token` | — | Klient går med |
| GET | `/api/broadcasts` | Båda | Hämta alla sändningar |
| POST | `/api/broadcasts` | Admin | Publicera sändning |
| PATCH | `/api/broadcasts/:id/pin` | Admin | Fäst/lossa sändning |
| POST | `/api/reactions/:broadcastId` | Klient | Reagera på sändning |
| GET | `/api/clients` | Admin | Lista alla klienter |
| GET | `/api/messages/:clientId` | Admin | Hämta tråd |
| POST | `/api/messages/:clientId` | Admin | Skicka meddelande |
| POST | `/api/messages/me/send` | Klient | Skicka meddelande |
| POST | `/api/upload` | Båda | Ladda upp media |

---

## 8. WebSocket-händelser

| Händelse | Riktning | Beskrivning |
|----------|----------|-------------|
| `admin:new_broadcast` | Server → alla | Ny sändning publicerad |
| `admin:new_message` | Server → klient | Admin skickade meddelande |
| `client:new_message` | Server → admins | Klient skickade meddelande |
| `client:read_receipt` | Server → admins | Klient läste meddelande |
| `broadcast:new_reaction` | Server → admins | Ny reaktion |
| `client:last_seen` | Server → admins | Klientaktivitet uppdaterad |
| `client:typing` | Klient → server | Klient skriver |
| `admin:typing` | Admin → server | Admin skriver |

---

## Mediaborttagning (var 6:e timme)

`cleanup-function.sql` registrerar en `pg_cron`-jobbeschema som:
- Tar bort alla filer i `broadcast_media` och `message_media` äldre än 48 timmar
- Raderna i databasen tas bort men sändningarnas text behålls
- Frontend visar "Bild/video ej längre tillgänglig" för borttagna filer
