# Påminnelser

En liten påminnelseapp där du skapar påminnelser **med röst eller text** på svenska, till exempel
*”påminn mig imorgon kl 9 att ringa tandläkaren”* eller *”varje måndag kl 8.15 veckomöte”*.
Den fungerar på iPhone, Android (Samsung), Windows-dator och Chromebook.

## Hur det fungerar

```
 iPhone ─┐                                      ┌─> notis på iPhone
 Samsung ┼─> appen (webbsida) ─> Apps Script ─> │   Google Kalender ─> notis på Samsung
 PC ─────┤    röst + text        (ditt konto)   │   "Påminnelser"   ─> notis på PC/Chromebook
 Chromebook┘
```

* **Appen** är en vanlig webbsida (PWA) som kan installeras på hemskärmen/skrivbordet. Ingen app-butik och ingen installation behövs.
* **Röst:** mikrofonknappen använder webbläsarens taligenkänning (svenska). Där den saknas fungerar tangentbordets diktering lika bra
  (iPhone/Android: mikrofonen på tangentbordet, Windows: `Win + H`, Chromebook: `Sök + D`).
* **Synk och notiser:** påminnelserna sparas som händelser i en egen kalender, *Påminnelser*, i ditt Google-konto via ett litet
  Google Apps Script. Det är **Google Kalender som skickar notiserna**, så de kommer fram även när appen är stängd, på alla enheter.
  Ingen egen server, ingen API-nyckel och ingen kostnad.
* Utan Apps Script fungerar appen i **lokalt läge**: påminnelserna finns bara på den enheten och notiserna kommer bara när appen är öppen.

## Installation (cirka 10 minuter, en gång)

### 1. Skapa kalender-backenden (Apps Script)

> Använd helst ditt **privata Google-konto**. Skolans/kommunens Workspace-konto tillåter ofta inte att webbappar
> distribueras med åtkomst ”Alla”, och påminnelserna är dina egna, inte jobbets.

1. Gå till <https://script.google.com> → **Nytt projekt**. Döp det till *Påminnelser*.
2. Ta bort koden som står där och klistra in hela innehållet i [`apps-script/Code.gs`](apps-script/Code.gs).
3. Välj funktionen **`setup`** i listan högst upp och tryck **Kör**. Godkänn behörigheterna (Kalender).
   Öppna **Exekveringslogg**: där står din **hemliga kod**. Kopiera den.
4. **Distribuera → Ny distribution → Typ: Webbapp**
   * *Kör som:* **Jag**
   * *Vem har åtkomst:* **Alla**  (koden ovan skyddar mot obehöriga)
5. Tryck **Distribuera** och kopiera **webbappens URL** (slutar på `/exec`).

### 2. Publicera appen (GitHub Pages)

1. Slå ihop den här grenen till `main`.
2. I repot på GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`** → Save.
3. Efter en minut finns appen på `https://<ditt-användarnamn>.github.io/reminder/`.

> GitHub Pages kräver att repot är **publikt** på gratisplanen. Det är ofarligt: koden innehåller inga hemligheter.
> Din URL och hemliga kod sparas bara i webbläsaren på dina enheter.

### 3. Ställ in första enheten

Öppna appen → ⚙︎ → klistra in **webbappens URL** och **hemliga koden** → **Spara & testa**.
Tryck sedan **Kopiera inställningslänk** och skicka länken **till dig själv** (t.ex. i ett mejl till dig själv).
Öppna länken på varje annan enhet, så ställs de in automatiskt.

### 4. Per enhet

| Enhet | Installera appen | Få notiser |
|---|---|---|
| **Privat iPhone** | Öppna länken i **Safari** → Dela → **Lägg till på hemskärmen** | Installera **Google Kalender** från App Store, logga in med ditt privata konto och slå på notiser. Kontrollera att kalendern *Påminnelser* är ibockad. |
| **Jobbets Samsung** | Öppna i **Chrome** → ⋮ → **Installera app** / Lägg till på startskärmen | Lägg till ditt privata Google-konto i Google Kalender-appen. Om jobbets MDM blockerar det: dela kalendern *Påminnelser* till jobbkontot (se nedan). |
| **Jobbdatorn (Windows)** | Öppna i **Chrome/Edge** → installera-ikonen i adressfältet | Ha Google Kalender öppen i en flik (eller installerad som app) och tillåt webbläsarnotiser. Alternativt den delade kalendern i jobbkontot. |
| **Privat Chromebook** | Öppna i Chrome → installera-ikonen i adressfältet | Inloggad med privat konto: tillåt notiser i Google Kalender (calendar.google.com → Inställningar → Aviseringar). |

**Dela kalendern med jobbkontot (om jobbenheterna inte får ha ditt privata konto):**
calendar.google.com (privat konto) → *Påminnelser* → ⋮ → **Inställningar och delning** → *Dela med specifika personer* →
lägg till din jobbadress med behörigheten ”Se all information om händelser”. Ställ sedan in **standardaviseringar** för kalendern
i jobbkontot, eftersom aviseringar inte följer med vid delning. Kontrollera först att din arbetsgivare tillåter det.

## Använda appen

* Skriv eller tala in. Appen tolkar tid och datum direkt och visar ett förslag som du kan justera innan du sparar.
* **Enter** sparar. Den runda knappen markerar *klar* (för upprepade påminnelser: bara den gången). ✕ tar bort (hela serien).
* Fungerar offline: ändringar köas och synkas när nätet är tillbaka.

Exempel som förstås:

| Du säger/skriver | Blir |
|---|---|
| imorgon kl 9 ringa tandläkaren | *Ringa tandläkaren*, imorgon 09:00 |
| om 20 minuter ta ut tvätten | om 20 minuter |
| på fredag kl 14:30 möte med rektorn | nästa fredag 14:30 |
| kom ihåg att köpa mjölk ikväll | idag 19:00 |
| halv tre hämta barnen | 14:30 |
| 15 december handla julklappar | 15 dec 09:00 |
| varje måndag kl 8.15 veckomöte | upprepas varje vecka |
| varje vardag kl 7 träna | måndag till fredag |
| varje dag kl 21 ta medicin | dagligen |

## Säkerhet

* Den hemliga koden är det enda som skyddar din webbapp. Dela inte inställningslänken med någon annan.
  Läcker den: kör `rotateToken` i Apps Script och ställ in enheterna igen.
* Skriv inte känsliga personuppgifter om andra (t.ex. elever) i påminnelserna, eftersom de hamnar i din privata Google Kalender.

## Filer

| Fil | Innehåll |
|---|---|
| `index.html` | Appen (gränssnitt, röst, synk, offline) |
| `parse.js` | Tolkning av svensk text till datum/tid |
| `sw.js`, `manifest.webmanifest`, `icon*` | Gör appen installerbar och offline-kapabel |
| `apps-script/Code.gs` | Backend som skriver till Google Kalender |
