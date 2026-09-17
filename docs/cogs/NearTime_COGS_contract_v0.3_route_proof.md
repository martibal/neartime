# NearTime — Pre-Build COGS-kontrakt (v0.3, route-proof revision)

**Dato:** 17. september 2026  
**Status:** **IKKE klar for build.** Offentlig dokumentasjon og tilgjengelig kode er nå gjennomgått så langt det er mulig uten tilgang til TomTom-kontoens gjeldende Pay-as-you-grow-satser og uten et komplett Android-prosjektarkiv. De gjenværende åpne portene er eksplisitt listet i del H.

---

## A. Metodikk og ufravikelige invariants

- Alle USD-priser regnes med **stresskurs 10,50 NOK/USD**.
- Gratisnivå settes til **0 i produktøkonomien**. Gratis månedsvolum behandles kun som midlertidig bonus i tidlig drift.
- Ingen providerkostnad får oppstå uten at backend først har autorisert og reservert worst-case kostnad for den aktuelle provider-hendelsen.
- **Ingen automatisk provider-retry** i v1. Ett forsøk som faktisk er sendt til provider behandles økonomisk som potensielt billable også hvis NearTime får timeout/uklar respons.
- Manuell retry fra bruker er en ny logisk handling og krever ny reservasjon.
- Ingen provider-kall ved app-oppstart, GPS-oppdatering, pan/zoom, kategoriendring, filterendring, tilbake-navigasjon eller visning av cachet resultat.
- Produktkvalitet er hard constraint: resultatet skal ikke presenteres som komplett hvis systemet ikke kan underbygge kandidatunivers, ferskhet og faktisk pedestrian-ruting.
- `COMPLETE_TOP_K` kan ha K<10 når det er bevist at flere kvalifiserende treff ikke finnes. `DEGRADED` brukes når økonomisk/teknisk cap stopper søket før kompletthet er underbygget.

---

## B. Kart og lokal UI

| Brukerhandling | Provider/SKU | Billable events | Stresskost | Wallet | Status |
|---|---|---:|---:|---|---|
| Native Android-kart uten `mapId` | Google Maps SDK | Native map load | **0 kr** | Ingen | ✅ Offisiell prisliste: Maps SDK = Unlimited / ingen betalt sats |
| Pan/zoom/lagbytte | — | 0 ekstra provider-events | **0 kr** | Ingen | ✅ |
| GPS fra telefonen | Android OS | 0 paid API-events | **0 kr** | Ingen | ✅ |
| Kategori/filterendring | — | 0 | **0 kr** | Ingen | ✅ Produktinvariant |
| Tilbake til cachet resultat | — | 0 | **0 kr** | Ingen | ✅ Produktinvariant |
| «Vis vei» via Maps URL | Google Maps URL | 0 paid API-events | **0 kr** | Ingen | ✅ |
| `mapId` / cloud styling / funksjon som flytter kartet til Dynamic Maps-SKU | Google Dynamic Maps | $7/1000 ved første volumtrinn | **7,35 øre / load** | Ville kreve egen klassifisering | 🚫 Forbudt i v1 uten ny COGS-godkjenning |

**Hard build-regel:** v1 skal ikke bruke `mapId`. Dersom web/JavaScript-kart senere bygges, gjelder ikke denne 0-kroners-konklusjonen automatisk og COGS-kontrakten må reåpnes.

Offisiell kilde:  
https://developers.google.com/maps/billing-and-pricing/pricing

---

## C. Hva tilgjengelig Android-kode faktisk gjør i dag

Gjennomgang av tilgjengelig `MainActivity.kt` viser:

1. `MapsInitializer.initialize(applicationContext)` skjer ved `onCreate`, deretter lokal Compose-UI.
2. GPS leses fra Androids lokasjonssystem; kameraet flyttes lokalt ved posisjonsendring.
3. POI-søk mot backend skjer bare når brukeren trykker **Find up to 10 places**.
4. Egendefinert startsted:
   - tekstskriving alene gjør **ingen** provider-lookup,
   - **Find start location** kaller `/location/suggest`,
   - valg av forslag kaller `/location/resolve`.
5. `postJson()` har timeout, men ingen automatisk retry-loop i tilgjengelig klientkode.

**Ikke ferdig auditert:** hele Android-prosjektet er ikke tilgjengelig. `AndroidManifest.xml`, app/root Gradle-filer, `res/**`, eventuell `Application`-klasse og andre SDK-initieringer må gjennomgås før D.2 kan lukkes. GitHub-tilkoblingen har ingen tilgjengelig NearTime/PlaceFinder-repo å hente dette fra.

---

## D. Provider-kostnader som er offentlig og endelig verifiserbare

### D.1 Google Places / Maps — første betalte volumtrinn

Stresskurs: 10,50 NOK/USD.

| SKU | Offisiell pris / 1000 | Stresskost per event | Gratisnivå behandlet i økonomimodell |
|---|---:|---:|---:|
| Maps SDK (native) | $0 | **0 øre** | irrelevant |
| Dynamic Maps | $7 | **7,35 øre** | 0 |
| Places Aggregate API | $10 | **10,50 øre** | 0 |
| Text Search Essentials (IDs Only) | $0 / Unlimited | **0 øre** | irrelevant |
| Place Details Essentials | $5 | **5,25 øre per sted** | 0 |
| Place Details Pro | $17 | **17,85 øre per sted** | 0 |
| Nearby Search Pro | $32 | **33,60 øre** | 0 |
| Nearby Search Enterprise | $35 | **36,75 øre** | 0 |
| Text/Nearby Search Enterprise + Atmosphere | $40 | **42,00 øre** | 0 |
| Routes Compute Route Matrix Essentials | $5 / 1000 elements | **5,25 øre per element** | 0 |

Offisielle kilder:  
https://developers.google.com/maps/billing-and-pricing/pricing  
https://developers.google.com/maps/documentation/routes/usage-and-billing

### D.2 Google Text Search IDs-only og Open now

`places.id` er eksplisitt et **Text Search Essentials (IDs Only)**-felt. Med field mask begrenset til IDs-only er prisen $0 / Unlimited. `openNow: true` er et request-filter og begrenser resultatene til steder som er åpne når søket sendes.

**Viktig unntak:** `openNow` gjelder ikke hotell- eller geopolitiske spørringer. For v1 skal Open now derfor deaktiveres for hotell/overnattingskategorier som ikke kan verifiseres med denne banen, fremfor å gi et falskt inntrykk av filtering.

Hard invariant for produksjon:

```text
X-Goog-FieldMask må være en allowlist-konstant bestående kun av IDs-only-felter.
Wildcard (*) er forbudt.
Ingen displayName/location/formattedAddress/businessStatus/currentOpeningHours
skal kunne snike seg inn i samme request.
```

Offisielle kilder:  
https://developers.google.com/maps/documentation/places/web-service/text-search  
https://developers.google.com/maps/billing-and-pricing/pricing

---

## E. Discovery/ferskhet — korrigert kost- og kvalitetsanalyse

### E.1 Viktig korreksjon fra v0.1

v0.1 hadde denne normale flyten:

1. TomTom Discover
2. Google Places Aggregate
3. Google IDs-only matching
4. eventuelt Google IDs-only `openNow`
5. TomTom pedestrian routing

Men delsum/formel i v0.1 satte discovery/ferskhet til **10,5 øre konstant**. Det var ufullstendig fordi **TomTom Discover også er en billable provider-event**. Korrekt formel er:

```text
Discovery/ferskhet =
    Google Aggregate-kost
  + TomTom Discover-kost
  + Google IDs-only-kost (0)
  + Open-now IDs-only-kost (0)
```

Så lenge TomTom Discover-prisen er ukjent, er discovery-delsummen **ikke ferdig tallsatt**.

### E.2 Google Aggregate — hva den faktisk garanterer

Places Aggregate kan filtrere på:
- geografisk område,
- type,
- operating status,
- m.m.

Med `INSIGHT_PLACES` returnerer den Google Place IDs **bare når totalt antall treff er <=100**. Den returnerer ikke navn/koordinater/adresse som normal datafeed; den er et komplett ID-univers innenfor filteret når <=100.

Det gir en sterk mulig completeness-gate:

```text
Aggregate-sett A = alle OPERATIONAL Google Place IDs i valgt område/type.
Candidate-provider-sett C = kandidater fra TomTom/annen provider,
                            mappet til Google IDs via IDs-only Text Search.

Hvis unique(C_google_ids) == A:
    kandidatuniverset er komplett innenfor det eksakte Aggregate-området.
Hvis settene ikke er like:
    resultatet kan ikke kalles COMPLETE_TOP_K.
```

Dette er bedre enn å anta at TomTom alene har funnet «alle» POI-er.

Offisiell kilde:  
https://developers.google.com/maps/documentation/places-aggregate/request-parameters

### E.3 Kritisk ny kostnadsdriver: >100 treff

Aggregate er **ikke alltid ett 10,5-øres kall**.

Hvis et område/type har >100 treff, får vi ikke hele ID-listen. Det finnes ingen dokumentert vanlig paginering som bare lar oss hente «neste 100». Derfor kan en komplett løsning måtte splitte området i subområder og gjøre flere Aggregate-kall.

Det betyr:

```text
Aggregate-kost = N_aggregate_calls × 10,5 øre
```

Ikke automatisk 10,5 øre konstant.

En normalflyt som hevder «10,5 øre uansett tetthet» er derfor ikke godkjent. For tette kategorier som restauranter i sentrum må enten:

- et deterministisk, wallet-bundet tilingsopplegg med hard maks antall Aggregate-kall defineres, eller
- søket gå `DEGRADED` når komplett kandidatunivers ikke kan hentes innen den forhåndsreserverte økonomiske grensen.

**Å bare krympe søkeområdet er ikke tillatt** dersom det kan ekskludere steder som kunne kvalifisert til topp-10.

### E.4 IDs-only matching — billig, men ikke ferdig kvalitetsbevist

Planen er å mappe TomTom-kandidatens navn/adresse/type til Google Place ID med Text Search IDs Only. Kostnaden er 0, men kvaliteten er ikke automatisk bevist:

- én tekstquery kan returnere flere IDs,
- likt navn i nærheten kan gi feil ID,
- kun ID-felter betyr at Google-responsen ikke gir oss koordinat/navn tilbake til en rik sammenligning,
- Open now må bekrefte **den samme** Google-ID-en som ble knyttet til kandidaten.

Før production build må spike måle:

- exact-ID match rate,
- false-positive rate,
- unmatched Aggregate IDs,
- `openNow` match rate,
- faktisk SKU i Cloud Billing = IDs Only,
- hotell-unntaket.

Ingen Place Details-fallback skal være skjult i normalflyten. Place Details Essentials/Pro er for dyrt per kandidat til at dette kan «reddes» uten eksplisitt ny COGS-kontrakt.

---

## F. TomTom — det som er verifisert og det som ikke kan hentes offentlig

### F.1 Offentlig verifisert gratisvolum

Offisiell TomTom-prisside viser:

| API | Offentlig gratisvolum / måned |
|---|---:|
| Routing API | 20 000 |
| Matrix Routing API | 2 500 |
| Places Suggest | 10 000 |
| Places Details | 5 000 |
| Places Discover | 5 000 |

Disse gratisvolumene brukes **ikke** i lønnsomhetsmodellen, men bekrefter API-klassene.

Offisiell kilde:  
https://docs.tomtom.com/pricing

### F.2 Betalt sats er fortsatt en ekte ekstern blokkering

Den offentlige TomTom-prissiden viser «Pricing details» og kalkulatorfelter, men den statiske/offentlig lesbare dokumentasjonen eksponerer ikke en verifiserbar Pay-as-you-grow enhetspris for Routing, Discover, Suggest eller Details.

Derfor kan følgende **ikke fylles ut troverdig fra offentlig research alene**:

- `TT_DISCOVER_PRICE`
- `TT_ROUTE_PRICE`
- `TT_SUGGEST_PRICE`
- `TT_DETAILS_PRICE`

Disse må tas fra **den faktiske TomTom-kontoens gjeldende kalkulator/prismodell**, i kontovaluta og med bekreftelse på at kontoen står på gjeldende prisregime etter 2026-endringen.

### F.3 TomTom `Attributes` er en skjult COGS-risiko

TomTom dokumenterer eksplisitt for Places Discover at dersom man ber om et ikke-leaf attributt, returneres alle underattributter implisitt, og at slik implisitt attributthenting kan ha **variable cost/billing implications** og ikke anbefales i produksjon.

Dermed er dette ikke tillatt i final build:

```text
Attributes: results
```

uten eksplisitt kostverifisering.

Final build må bruke en **minimal leaf-attribute allowlist** med bare feltene NearTime trenger, og TomTom-kalkulatoren/kontoen må avklare om pris påvirkes av attributtsettet.

Offisiell kilde:  
https://docs.tomtom.com/places-search-api/documentation/places-search/discover

---

## G. Routing — COGS og completeness er koblet

### G.1 Hard økonomisk grense

Dagens tilgjengelige backend har:

```text
ROUTE_CANDIDATE_LIMIT = 20
TOMTOM_ROUTE_CALLS_PER_SEARCH_CAP = 20
```

Den gjør også `reserveUsage('tomtomRoute')` før hvert TomTom routing-kall og har ingen automatisk fetch-retry.

Dermed finnes allerede en teknisk modell for:

```text
routing_max = 20 × TT_ROUTE_PRICE
```

Men dette alene beviser ikke at topp-10 alltid er komplett.

### G.2 Lower-bound pruning — korrigert bevismodell

Ny dokumentasjonsgjennomgang bekrefter at TomTom kan rapportere `FERRY`-seksjoner, og Routing API har `avoid=ferries`. TomTom dokumenterer samtidig `avoid` som noe ruteren **prøver** å unngå, ikke som en ubetinget garanti. TomTom dokumenterer også at forespurt `travelMode` kan være utilgjengelig for deler av ruten; i `TRAVEL_MODE`-seksjoner rapporteres slike deler som `travelMode=other`.

Det betyr at følgende **ikke er tilstrekkelig** som matematisk bevis alene:

```text
avoid=ferries
+ inspiser seksjonene på rutene vi faktisk beregner
```

Årsaken er enkel: en kandidat som blir prunet blir aldri rutet, og vi kan derfor ikke inspisere dens sections. I tillegg betyr `PEDESTRIAN`-seksjon bare en del av ruten som er *kun* egnet for fotgjengere; fravær av en slik seksjon betyr ikke at resten av en pedestrian-rute er ugyldig.

Den robuste løsningen er å gjøre `V_VALID_MAX` til en **NearTime-validitetsregel**, ikke en påstand om TomToms interne hastighetsmodell.

Definer for hver kandidat:

```text
d = luftlinjeavstand origin -> kandidat
T = faktisk TomTom pedestrian route time

lower_bound = d / V_VALID_MAX
```

En rutet kandidat er NearTime-gyldig bare dersom alle disse holder:

```text
1. request bruker travelMode=pedestrian
2. request bruker avoid=ferries og avoid=carTrains
3. response inneholder ingen FERRY- eller CAR_TRAIN-seksjon
4. TRAVEL_MODE-seksjoner dekker ruten uten travelMode=other
5. T >= d / V_VALID_MAX
6. T <= brukerens maxWalkMinutes for å kvalifisere som treff
```

Punkt 5 er nøkkelen. Dersom provider noen gang returnerer en "pedestrian"-rute som er raskere enn NearTimes eksplisitte maksimalt tillatte effektive hastighet, blir ruten **ugyldig for NearTime** i stedet for å få lov til å bryte pruning-beviset.

Da følger beviset direkte:

```text
For enhver NearTime-gyldig kandidat i:
    T_i >= d_i / V_VALID_MAX = LB_i

Kandidater prosesseres i stigende d_i.
Dermed er LB_i ikke-avtagende.

Hvis 10 kvalifiserende, faktisk rutede kandidater finnes og:
    LB_next >= T_10

kan ingen senere NearTime-gyldig kandidat ha T < T_10.
Top-10 er derfor komplett.

Hvis færre enn 10 kvalifiserende finnes og:
    LB_next > maxWalkMinutes

kan ingen senere NearTime-gyldig kandidat kvalifisere.
K<10 er derfor COMPLETE_TOP_K, ikke DEGRADED.
```

Dette beviset er **uavhengig av TomToms udokumenterte interne pedestrian-hastighet**. En senere kandidat som hypotetisk ville fått `T < LB` hos provider, er per definisjon ikke en NearTime-gyldig walking-rute og kan derfor ikke slå inn i produktets gyldige top-10.

`avoid=ferries`, `avoid=carTrains` og section-verifisering beholdes som separate semantiske sikkerhetsgater fordi produktet skal vise faktisk gangrute, ikke en rute som inkluderer ferge eller biltog. De er viktige, men de er ikke selve pruning-beviset.

**G.2 kan derfor lukkes strukturelt**, men build-signoff krever fortsatt at `V_VALID_MAX` får en eksplisitt tallverdi og testes mot et representativt sett av legitime pedestrian-ruter for å sikre at regelen ikke avviser normale kunde-resultater.

Offisielle TomTom-kilder:
- `avoid=ferries` / `avoid=carTrains` og travel mode:  
  https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/common-routing-parameters
- `FERRY`, `CAR_TRAIN`, `TRAVEL_MODE`, `PEDESTRIAN` section types:  
  https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/calculate-route

### G.3 Google Route Matrix som kjent-priset fallback

Google Compute Route Matrix faktureres per **element = origins × destinations**, ikke per request. Med bare basic features er Essentials-prisen $5/1000 elementer, altså **5,25 øre per kandidat ved stresskurs**.

Eksempel:

```text
10 kandidater = 52,5 øre routing
20 kandidater = 1,05 kr routing
```

Det løser prisusikkerheten, men er for dyrt til å være en attraktiv standardløsning dersom NearTime skal rute mange kandidater per søk.

Offisielle kilder:  
https://developers.google.com/maps/documentation/routes/usage-and-billing  
https://developers.google.com/maps/billing-and-pricing/pricing

### G.4 Matrix løser ikke N-problemet

Om 20 destinasjoner sendes som 20 enkeltkall eller én matrix-request endrer ikke nødvendigvis billed COGS når provider fakturerer per element. Den økonomiske gevinsten må komme fra:

- lavere pris per element, eller
- færre elementer `N`.

---

## H. Retry, timeout og wallet — korrigert regel

v0.1 formulerte muligheten for å bruke samme idempotency key slik at duplikat ikke reserverer/committer kostnad to ganger. Dette er ikke tilstrekkelig som provider-COGS-garanti.

En NearTime-idempotency-key kan hindre dobbel **intern bokføring**, men den kan ikke gjøre en ny ekstern request gratis dersom provider allerede har behandlet begge.

Final v1-regel:

```text
AUTOMATIC_PROVIDER_RETRY = OFF
```

For hvert provider-forsøk:

1. wallet reserverer før request sendes,
2. når request er sendt, behandles reservasjonen konservativt som potensielt billable,
3. en timeout/uklar response skal ikke automatisk refundere kostnaden,
4. refundering kan bare skje hvis providerens telemetry/billing semantics faktisk underbygger at forsøket ikke ble billable,
5. brukerinitiert nytt forsøk er en ny full reservasjon.

Dette lukker en ellers skjult kostnadsvei.

---

## I. Separat kostnadsvei: egendefinert startsted

Normal «My location»-flyt bruker OS-GPS og koster 0.

Egendefinert startsted har to eksplisitte brukerhandlinger:

```text
Find start location -> 1 × TomTom Suggest
Velg forslag        -> 1 × TomTom Details
```

Dette er **ikke** kostnad per vanlig POI-søk dersom startstedet gjenbrukes lokalt, men det er ekte variable COGS og må ha egne wallet-regler.

Formler:

```text
Custom-location suggestion cost = TT_SUGGEST_PRICE
Custom-location selection cost  = TT_DETAILS_PRICE
```

Ingen provider-kall skal skje for hvert tastetrykk i v1.

---

## J. Vurderte alternativer som IKKE er godkjent som final build

### J.1 Google Nearby Search — dagens live-referanse

Fordel:
- sterk Google-datafeed,
- ferskhet/status/type i ett kall,
- fungerer live i appen.

Ulempe:
- Nearby Pro = **33,60 øre** før routing ved stresskurs,
- Open-now med `currentOpeningHours` kan løfte til Enterprise,
- derfor for dyrt som planlagt marginalarkitektur.

Status: **referanse/benchmark, ikke valgt final COGS-design.**

### J.2 Google routing summaries i Places Search

`routingSummaries` kan returnere rutetid/distanse, men feltet løfter Text Search til **Enterprise + Atmosphere**, $40/1000 = **42 øre per search** ved stresskurs.

Status: **avvist på kost**.

### J.3 Places UI Kit

Prisen er attraktiv og Android-komponentene er GA, men providerforbruket skjer klient-side. Backend-wallet kan derfor ikke mekanisk være en ufravikelig forutsetning før Google-kallet.

Status: **avvist for v1 på economic-authority/invariant**, ikke på pris eller modenhet.

### J.4 Self-hosted routing

Kunne fjerne marginal routingpris, men global drift av OSM/routinggrafer er utenfor ønsket scope for et lite team og internasjonalt produkt.

Status: **avvist på driftsmodell**.

---

## K. Kandidatarkitektur med best dokumentert potensial per nå

Den billigste **server-first**-arkitekturen som fortsatt har en plausibel vei til Google-ferskhetskontroll er:

```text
1. Server wallet reserverer hele worst-case søket.
2. TomTom Discover med eksplisitt minimal attribute allowlist.
3. Google Places Aggregate:
   OPERATIONAL + riktig type + eksakt geografisk område.
4. Google Text Search IDs Only:
   map TomTom-kandidater -> Google Place IDs.
5. Set-equality completeness gate:
   alle Aggregate IDs må være representert/matchet.
6. Hvis Open now:
   IDs-only Text Search + openNow=true for kandidat-ID-matching
   (ikke hotell).
7. Pedestrian route for kandidater som må rutes.
8. Sorter på faktisk route duration.
9. Returner COMPLETE_TOP_K bare når completeness-reglene holder.
10. Commit faktisk COGS; behold konservativ reservasjon for provider-attempts
    med uklar billing outcome.
```

**Men denne er fortsatt ikke build-ready**, av tre grunner:

1. TomTom betalte satser er ukjente fra offentlig side.
2. Aggregate >100 kan gjøre antall Aggregate-kall variabelt; tiling/cap må designes og prises.
3. ID-only matching og kompletthetsgaten må live-bevises på representativt datasett uten paid-field creep.

---

## L. Korrigert COGS-formel

Definer:

```text
A = antall Aggregate-kall
D = TomTom Discover-kost per kall
R = TomTom Routing-kost per kall
Nr = antall TomTom-ruter
S = TomTom Suggest-kost
T = TomTom Details-kost
```

### Vanlig POI-søk fra GPS

```text
FAKTISK KOST =
    A × 10,5 øre
  + D
  + Nr × R
  + 0 øre Google IDs-only
  + 0 øre native kart/GPS/UI/handoff
```

### Hardt søkemaksimum

Kan først fylles ut når:

```text
A_MAX er definert,
D er kjent,
NR_MAX er både økonomisk og kvalitetsmessig godkjent,
R er kjent.
```

Da:

```text
HARD_MAX_SEARCH_COST =
    A_MAX × 10,5 øre
  + D
  + NR_MAX × R
```

### Egendefinert startsted

Separat:

```text
Find start location = S
Select start location = T
```

---

## M. De gjenværende portene — eksakt hva som må hentes før build

### M.1 TomTom-kontoens gjeldende priser — MÅ komme fra konto/kalkulator

Det eneste vi trenger fra TomTom-kontoen er **ikke-hemmelig prisinformasjon**, aldri API-nøkkel.

Hent/skjermdump følgende fra gjeldende konto/priskalkulator:

```text
Currency / pricing plan / effective date
Routing API:              pris ved første billable volumtrinn
Places Search Discover:   pris ved første billable volumtrinn
Places Search Suggest:    pris ved første billable volumtrinn
Places Search Details:    pris ved første billable volumtrinn
Discover Attributes:      om valgt attribute-sett påvirker satsen,
                          og i så fall hvordan
```

Hvis siden viser terskler/volumtrinn, ta med dem.

**Porten kan ikke lukkes med tredjepartspris.**

### M.2 Komplett Android-prosjekt — nødvendig for zero-hidden-call audit

Lever én ZIP av nåværende prosjekt, helst `C:\neartime` uten tunge genererte mapper:

```text
utelat gjerne:
.gradle/
build/
app/build/
```

Må minst inneholde:

```text
app/src/main/AndroidManifest.xml
app/src/main/java/** eller app/src/main/kotlin/**
app/src/main/res/**
app/build.gradle.kts
build.gradle.kts
settings.gradle.kts
gradle/libs.versions.toml
gradle.properties (uten secrets dersom noen finnes)
```

Da kan vi verifisere:
- ingen `mapId`,
- ingen skjult cloud styling,
- ingen SDK som foretar egne provider-kall,
- ingen background worker,
- ingen network retry interceptor,
- ingen startup geocoding/Places lookup,
- ingen hidden analytics/location-provider kostnadssti som påvirker COGS.

### M.3 Discovery spike — må gjøres kontrollert og forhåndspriset

Før full build skal et lite research-spike kjøre:

- flere tette og glisne kategorier,
- minst én storby med høy POI-tetthet,
- minst ett område med broer/barrierer,
- samme kandidater mot TomTom + Aggregate + Google IDs-only,
- Open-now for ikke-hotellkategori.

Mål:

```text
Aggregate count
Aggregate IDs count
TomTom candidates
Google IDs matched
unmatched Aggregate IDs
wrong/ambiguous matches
openNow verified
actual billed Google SKU
TomTom attributes used
```

Spike skal ha et eksplisitt call-budget **før det kjøres**. Ingen ukjent paid field mask, ingen fallback til Place Details.

### M.4 Aggregate >100-strategi

Må defineres før build:

```text
A_MAX = maksimal Aggregate-provider-events per søk
```

og tiling/splitting må være slik at ingen kandidat som kan påvirke topp-10 stille faller utenfor.

Hvis `A_MAX` nås før fullstendig ID-univers er oppnådd:
`DEGRADED`, ikke komplett resultat.

### M.5 Routing-completeness / NR_MAX og V_VALID_MAX

Routing-completeness er nå delt i to uavhengige spørsmål:

**A. Pruning-beviset**

Dette er strukturelt løst ved å definere `V_VALID_MAX` som en NearTime-validitetsregel:

```text
En kandidat med faktisk route time T < air_distance / V_VALID_MAX
er ikke en gyldig NearTime walking-rute.
```

Da er `air_distance / V_VALID_MAX` en matematisk sikker lower bound for hele det **produktdefinerte gyldige kandidatuniverset**, uavhengig av TomToms interne hastighetsprofil.

Før sign-off må følgende fortsatt bestemmes og verifiseres:

```text
V_VALID_MAX = konkret km/t-verdi
```

Verdien skal være konservativt høy nok til ikke å avvise legitime pedestrian-ruter, men samtidig eksplisitt nok til at pruning-beviset er mekanisk testbart.

**B. Hard provider-cap `NR_MAX`**

Hvis søket når `NR_MAX` før en av de matematiske stoppreglene er oppfylt, er resultatet:

```text
DEGRADED
```

ikke `COMPLETE_TOP_K`.

Dermed trenger ikke `NR_MAX` i seg selv bevise at kandidater utenfor cap aldri kan slå topp-10. Cap er en økonomisk fail-closed-grense; completeness kommer fra lower-bound-stoppregelen.

Final routing-request skal dessuten:

```text
travelMode=pedestrian
avoid=ferries
avoid=carTrains
requeste sectionType=ferry
requeste sectionType=carTrain
requeste sectionType=travelMode
```

og avvise som NearTime-ugyldig enhver rutet kandidat med:
- `FERRY`,
- `CAR_TRAIN`,
- eller `TRAVEL_MODE` med `travelMode=other`.

Det er ikke nødvendig å kreve at alle seksjoner har `sectionType=PEDESTRIAN`; TomTom bruker den seksjonstypen for deler av ruten som er **kun** egnet for fotgjengere, ikke som en etikett på alle vanlige veisegmenter en pedestrian-rute kan bruke.

## N. Pre-build sign-off-kriterium

Build får ikke starte før alle disse feltene har konkrete verdier:

```text
TT_DISCOVER_PRICE       = ?
TT_ROUTE_PRICE          = ?
TT_SUGGEST_PRICE        = ?
TT_DETAILS_PRICE        = ?
A_MAX                   = ?
NR_MAX                  = ?
V_VALID_MAX               = ?
ROUTE_SECTION_GATE        = proven / fail-closed
DISCOVERY_MATCH_GATE    = proven / fail-closed
OPEN_NOW_GATE           = proven / fail-closed
ANDROID_HIDDEN_CALLS    = none
RETRY_POLICY            = no automatic provider retries
```

Og dokumentet skal kunne avsluttes med:

```text
NORMAL SEARCH:
  expected cost = X øre
  deterministic fixed component = Y øre
  variable component = Nr × R
  hard maximum = Z øre

CUSTOM START LOCATION:
  suggest = S øre
  select = T øre

OTHER APP ACTIONS:
  0 øre unless explicitly listed above
```

**Før dette kan fylles ut med faktiske tall og verifiserte gates er NearTime ikke klar for production build.**

---

## O. v0.3 — routing-revisjon

Denne revisjonen endrer én viktig konklusjon fra v0.2:

- Fergefunnet bekrefter at providerens interne pedestrian-modell ikke kan brukes ukritisk som grunnlag for en geometrisk lower bound.
- `avoid=ferries` + section-inspeksjon alene **beviser ikke** pruning for kandidater som aldri rutes.
- Beviset kan derimot gjøres provider-uavhengig ved å gjøre `V_VALID_MAX` til en eksplisitt **produkt-validitetsregel**. En provider-rute som bryter denne grensen er ugyldig for NearTime.
- Ferge/biltog/`travelMode=other` kontrolleres i tillegg som semantiske fail-closed-gater på alle ruter som faktisk beregnes.

Dette bevarer kundeløftet: en kostnadsoptimalisering får aldri gjøre en ukjent rask transportmodalitet til en skjult snarvei i en funksjon som markedsføres som gangtid.

---

## P. Offisielle referanser brukt i v0.3

Google Maps Platform pricing:  
https://developers.google.com/maps/billing-and-pricing/pricing

Google Places Text Search (IDs-only/Open now):  
https://developers.google.com/maps/documentation/places/web-service/text-search

Google Places Aggregate request parameters:  
https://developers.google.com/maps/documentation/places-aggregate/request-parameters

Google Places Aggregate usage/billing:  
https://developers.google.com/maps/documentation/places-aggregate/usage-and-billing

Google Routes usage/billing:  
https://developers.google.com/maps/documentation/routes/usage-and-billing

Google Compute Route Matrix reference:  
https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRouteMatrix

TomTom pricing:  
https://docs.tomtom.com/pricing

TomTom Places Search API — Discover:  
https://docs.tomtom.com/places-search-api/documentation/places-search/discover

TomTom Routing API — Calculate Route:  
https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/calculate-route

TomTom common routing parameters:  
https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/common-routing-parameters

TomTom Calculate Route sections:  
https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/calculate-route
