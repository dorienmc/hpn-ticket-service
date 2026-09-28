export function renderPrivacyPageMarkup(appBaseHref: string): string {
  return `
  <main class="privacy-page">
    <div class="privacy-shell">
      <header class="privacy-header">
        <a class="privacy-back-link" href="${appBaseHref}">← Terug naar reserveren</a>
        <p class="privacy-kicker">Vocalgroup Half Past Nine</p>
        <h1>Privacyverklaring</h1>
        <p class="privacy-lead">Vocalgroup Half Past Nine respecteert je privacy en gaat zorgvuldig om met persoonsgegevens.</p>
        <p class="privacy-updated">Laatst bijgewerkt: 28 september 2026</p>
      </header>

      <article class="privacy-card">
        <nav class="privacy-contents" aria-label="Op deze pagina">
          <span>Op deze pagina</span>
          <a href="#verantwoordelijke">1. Verantwoordelijke</a>
          <a href="#gegevens">2. Persoonsgegevens</a>
          <a href="#doeleinden">3. Doeleinden</a>
          <a href="#grondslag">4. Grondslag</a>
          <a href="#gmail">5. Gmail API</a>
          <a href="#hosting">6. Hosting en beveiliging</a>
          <a href="#bewaren">10. Bewaartermijn</a>
          <a href="#rechten">13. Privacyrechten</a>
          <a href="#contact">16. Contact</a>
        </nav>

        <div class="privacy-copy">
          <section id="verantwoordelijke">
            <p class="privacy-section-number">01</p>
            <h2>Wie is verantwoordelijk voor de verwerking?</h2>
            <p><strong>Vocalgroup Half Past Nine</strong>, gevestigd in Enschede, is verantwoordelijk voor de verwerking van persoonsgegevens zoals beschreven in deze privacyverklaring.</p>
            <p>Website: <a href="http://www.halfpastnine.nl/" target="_blank" rel="noreferrer">www.halfpastnine.nl</a><br />E-mail: <a href="mailto:hp9mail@gmail.com">hp9mail@gmail.com</a></p>
          </section>

          <section id="gegevens">
            <p class="privacy-section-number">02</p>
            <h2>Welke persoonsgegevens verwerken wij?</h2>
            <p>Wanneer je via onze website een reservering maakt, kunnen wij de volgende gegevens verwerken:</p>
            <ul>
              <li>naam;</li>
              <li>e-mailadres;</li>
              <li>aantal gereserveerde plaatsen;</li>
              <li>gegevens die nodig zijn om je reservering te verwerken;</li>
              <li>informatie over de betaling van de reservering, voor zover nodig om vast te stellen of een reservering is betaald.</li>
            </ul>
            <p>Wij verzamelen alleen persoonsgegevens die noodzakelijk zijn voor het verwerken van je reservering en het organiseren van het concert.</p>
            <h3>Geen opslag van bankgegevens</h3>
            <p>Vocalgroup Half Past Nine slaat geen bankrekeningnummers, IBAN-nummers, bankinloggegevens, betaalkaartgegevens of andere bankgegevens van klanten op.</p>
            <p>Voor betalingen maken wij gebruik van een ING-betaalverzoek. Om te controleren of een reservering is betaald, kunnen wij de ontvangen betalingsinformatie handmatig vergelijken met de gegevens van de reservering, bijvoorbeeld de naam en het verschuldigde bedrag.</p>
            <p>Deze controle is uitsluitend bedoeld om vast te stellen of een reservering is betaald. Wij slaan daarbij geen bankgegevens van de betaler op in onze reserveringsdatabase.</p>
          </section>

          <section id="doeleinden">
            <p class="privacy-section-number">03</p>
            <h2>Waarvoor gebruiken wij je persoonsgegevens?</h2>
            <p>Wij gebruiken je persoonsgegevens voor de volgende doeleinden:</p>
            <h3>Reserveringen verwerken</h3>
            <p>Wij gebruiken je naam, e-mailadres en reserveringsgegevens om je reservering voor het concert te verwerken en onze administratie bij te houden.</p>
            <h3>Reserveringsbevestigingen en tickets versturen</h3>
            <p>Wij gebruiken je e-mailadres om je reserveringsbevestiging, ticket en andere noodzakelijke informatie over je reservering toe te sturen.</p>
            <p>Deze e-mails worden namens <strong>Vocalgroup Half Past Nine</strong> verzonden vanaf het e-mailadres <a href="mailto:dorienmc@gmail.com">dorienmc@gmail.com</a>.</p>
            <p>Deze e-mails zijn onderdeel van de uitvoering van je reservering en zijn geen marketingberichten.</p>
            <h3>Betalingen controleren</h3>
            <p>Wij gebruiken de informatie die nodig is om te kunnen vaststellen of een reservering is betaald.</p>
            <h3>Onze administratie bijhouden</h3>
            <p>Wij kunnen persoonsgegevens gebruiken voor onze reserverings- en financiële administratie, voor zover dit noodzakelijk is.</p>
          </section>

          <section id="grondslag">
            <p class="privacy-section-number">04</p>
            <h2>Op welke grondslag verwerken wij je persoonsgegevens?</h2>
            <p>Wij verwerken je persoonsgegevens op basis van de volgende grondslagen uit de Algemene Verordening Gegevensbescherming (AVG):</p>
            <ul>
              <li><strong>uitvoering van een overeenkomst:</strong> voor het verwerken van je reservering, het versturen van je ticket en het verstrekken van informatie die noodzakelijk is voor je reservering;</li>
              <li><strong>wettelijke verplichting:</strong> wanneer wij bepaalde gegevens wettelijk moeten bewaren, bijvoorbeeld voor onze financiële administratie;</li>
              <li><strong>gerechtvaardigd belang:</strong> voor zover noodzakelijk voor een goede administratie, beveiliging van onze systemen en het voorkomen of afhandelen van misbruik of geschillen.</li>
            </ul>
            <p>Wij verwerken niet meer persoonsgegevens dan noodzakelijk is voor deze doeleinden.</p>
          </section>

          <section id="gmail">
            <p class="privacy-section-number">05</p>
            <h2>E-mailverzending via Gmail API</h2>
            <p>Voor het versturen van reserveringsbevestigingen en tickets gebruiken wij het door Vocalgroup Half Past Nine <strong>aangewezen</strong> e-mailadres <a href="mailto:dorienmc@gmail.com">dorienmc@gmail.com</a> en de Gmail API van Google.</p>
            <p>De Gmail API wordt uitsluitend gebruikt om e-mails te versturen vanuit dit vaste e-mailadres.</p>
            <p>Onze toepassing gebruikt hiervoor uitsluitend de Gmail API-scope <code>gmail.send</code>. Deze scope geeft de toepassing de mogelijkheid om e-mail te versturen namens het geautoriseerde Gmail-account.</p>
            <p>Wij gebruiken de Gmail API <strong>niet</strong> om e-mails te lezen, te wijzigen of te verwijderen.</p>
            <p>De e-mailadressen van klanten worden door onze website rechtstreeks verzameld. Wij gebruiken de Gmail API niet om toegang te krijgen tot de Gmail- of andere e-mailaccounts van onze klanten.</p>
            <p>De informatie die nodig is om een reserveringsbevestiging of ticket te versturen, kan via de Gmail API worden doorgegeven aan Google voor het uitvoeren van deze verzending.</p>
            <p>Ons gebruik van Google API's en de daarmee samenhangende gegevensverwerking is onderworpen aan het <strong>Google API Services User Data Policy</strong>, inclusief de daarin opgenomen Limited Use-vereisten.</p>
          </section>

          <section id="hosting">
            <p class="privacy-section-number">06</p>
            <h2>Hosting, database en beveiliging</h2>
            <p>Onze website en bijbehorende technische infrastructuur maken gebruik van diensten van <strong>Cloudflare</strong>.</p>
            <p>Wij gebruiken onder andere:</p>
            <ul>
              <li><strong>Cloudflare Workers</strong> voor het uitvoeren van onderdelen van onze webapplicatie;</li>
              <li><strong>Cloudflare D1</strong> voor het opslaan van reserveringsgegevens.</li>
            </ul>
            <p>Cloudflare kan persoonsgegevens verwerken die noodzakelijk zijn voor het leveren, beveiligen en functioneren van deze diensten.</p>
            <p>Toegang tot het administratieve gedeelte van onze applicatie is beveiligd met authenticatie en tijdelijke HTTP-only sessiecookies. Dit gedeelte is niet openbaar toegankelijk.</p>
            <p>Wij gebruiken deze diensten uitsluitend voor de technische ondersteuning, werking en beveiliging van onze website en reserveringsadministratie.</p>
          </section>

          <section>
            <p class="privacy-section-number">07</p>
            <h2>Betalingen</h2>
            <p>Voor het betalen van een reservering maken wij gebruik van een <strong>ING-betaalverzoek</strong>.</p>
            <p>Vocalgroup Half Past Nine verwerkt of bewaart geen bankinloggegevens, betaalkaartgegevens, bankrekeningnummers of IBAN-nummers van klanten in de reserveringsdatabase.</p>
            <p>Voor zover nodig kunnen wij controleren of een betaling is ontvangen door de betalingsinformatie te vergelijken met de gegevens van de betreffende reservering.</p>
          </section>

          <section>
            <p class="privacy-section-number">08</p>
            <h2>Met wie delen wij persoonsgegevens?</h2>
            <p>Wij verstrekken persoonsgegevens alleen aan partijen die noodzakelijk zijn voor de uitvoering van onze dienstverlening en reserveringsadministratie.</p>
            <p>Dit betreft met name:</p>
            <ul>
              <li><strong>Google</strong>, voor het verzenden van e-mails via de Gmail API;</li>
              <li><strong>Cloudflare</strong>, voor hosting, technische infrastructuur, databasefunctionaliteit en beveiliging;</li>
              <li>eventuele andere dienstverleners wanneer dit noodzakelijk is om aan een wettelijke verplichting te voldoen of om onze rechten te beschermen.</li>
            </ul>
            <p>Wij verkopen je persoonsgegevens niet aan derden.</p>
          </section>

          <section>
            <p class="privacy-section-number">09</p>
            <h2>Doorgifte buiten de Europese Economische Ruimte</h2>
            <p>Voor sommige van de door ons gebruikte technische diensten kunnen persoonsgegevens worden verwerkt buiten de Europese Economische Ruimte (EER).</p>
            <p>Wanneer persoonsgegevens buiten de EER worden verwerkt, zorgen wij ervoor dat dit gebeurt in overeenstemming met de AVG en dat daarvoor een geldige wettelijke grondslag en, waar nodig, passende waarborgen worden toegepast.</p>
            <p>Voor de concrete internationale gegevensverwerking zijn mede de privacy- en gegevensverwerkingsvoorwaarden van de betreffende dienstverleners van toepassing.</p>
          </section>

          <section id="bewaren">
            <p class="privacy-section-number">10</p>
            <h2>Hoe lang bewaren wij je persoonsgegevens?</h2>
            <p>Voor de reserveringen voor het concert van <strong>8 november 2026</strong> geldt als uitgangspunt dat de persoonsgegevens <strong>binnen één maand na het concert worden verwijderd</strong>.</p>
            <p>Dit betekent dat persoonsgegevens die uitsluitend noodzakelijk zijn voor de reservering, betalingscontrole en verzending van tickets uiterlijk rond <strong>8 december 2026</strong> worden verwijderd.</p>
            <p>Als bepaalde gegevens op grond van een wettelijke verplichting langer moeten worden bewaard, bijvoorbeeld voor de financiële administratie, bewaren wij die gegevens gedurende de wettelijk voorgeschreven termijn.</p>
            <p>Wanneer een geschil, wettelijke verplichting of andere rechtmatige reden een langere bewaartermijn noodzakelijk maakt, kunnen bepaalde gegevens langer worden bewaard voor zover dat noodzakelijk is.</p>
          </section>

          <section>
            <p class="privacy-section-number">11</p>
            <h2>Hoe beveiligen wij je persoonsgegevens?</h2>
            <p>Wij nemen passende technische en organisatorische maatregelen om persoonsgegevens te beschermen tegen verlies, onbevoegde toegang, ongewenste wijziging of andere vormen van onrechtmatige verwerking.</p>
            <p>Daarbij maken wij onder andere gebruik van:</p>
            <ul>
              <li>beveiligde technische infrastructuur;</li>
              <li>toegangsbeveiliging voor het administratieve gedeelte;</li>
              <li>beperkte toegang tot reserveringsgegevens;</li>
              <li>het principe dat persoonsgegevens niet langer worden bewaard dan noodzakelijk.</li>
            </ul>
          </section>

          <section>
            <p class="privacy-section-number">12</p>
            <h2>Cookies</h2>
            <p>De openbare reserveringspagina plaatst zelf geen advertentie-, analyse- of marketingcookies en gebruikt geen local storage of session storage.</p>
            <p>Wanneer een beheerder inlogt, gebruikt de applicatie een noodzakelijke, HTTP-only sessiecookie om de toegang tot het administratieve gedeelte te beveiligen. Deze cookie bevat geen reserveringsgegevens en wordt verwijderd bij uitloggen of verloopt automatisch.</p>
            <p>Wanneer Google reCAPTCHA is ingeschakeld, wordt het reCAPTCHA-script pas geladen wanneer het reserveringsformulier wordt gebruikt. Google kan daarbij eigen cookies en vergelijkbare technieken gebruiken voor beveiliging en fraudepreventie. Om de aanvraag te controleren, kan ook het IP-adres dat door Cloudflare wordt doorgegeven aan Google worden verwerkt. De verwerking door Google valt onder het <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">privacybeleid van Google</a>.</p>
            <p>Ook de Google Identity Services-script wordt alleen geladen wanneer Google-login voor het beheer is ingeschakeld. Externe infrastructuur, zoals Cloudflare, kan daarnaast noodzakelijke cookies gebruiken voor beveiliging en beschikbaarheid van de website.</p>
            <p>Voor de vormgeving van de website laden wij lettertypen van Google Fonts. Daardoor maakt je browser verbinding met servers van Google. Google kan daarbij technische gegevens, zoals je IP-adres en browsergegevens, verwerken. De verwerking valt onder het <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">privacybeleid van Google</a>.</p>
            <p>Er worden geen niet-noodzakelijke cookies geplaatst waarvoor toestemming nodig is. Als dat in de toekomst verandert, passen wij deze verklaring aan en vragen wij waar nodig vooraf toestemming.</p>
          </section>

          <section id="rechten">
            <p class="privacy-section-number">13</p>
            <h2>Wat zijn je privacyrechten?</h2>
            <p>Op grond van de AVG heb je verschillende rechten met betrekking tot je persoonsgegevens. Je kunt onder bepaalde voorwaarden:</p>
            <ul>
              <li>inzage vragen in de persoonsgegevens die wij van je verwerken;</li>
              <li>verzoeken om onjuiste persoonsgegevens te laten corrigeren;</li>
              <li>verzoeken om je persoonsgegevens te laten verwijderen;</li>
              <li>verzoeken om de verwerking van je persoonsgegevens te beperken;</li>
              <li>bezwaar maken tegen bepaalde verwerkingen;</li>
              <li>verzoeken om je persoonsgegevens over te dragen wanneer het recht op gegevensoverdraagbaarheid van toepassing is.</li>
            </ul>
            <p>Je kunt hiervoor contact met ons opnemen via <a href="mailto:hp9mail@gmail.com">hp9mail@gmail.com</a>.</p>
            <p>Wij kunnen je vragen om voldoende informatie te verstrekken om je identiteit te kunnen controleren voordat wij een verzoek uitvoeren.</p>
            <p>Wij gebruiken je persoonsgegevens niet voor geautomatiseerde besluitvorming of profilering waaraan rechtsgevolgen of vergelijkbare significante gevolgen zijn verbonden.</p>
          </section>

          <section>
            <p class="privacy-section-number">14</p>
            <h2>Klacht indienen</h2>
            <p>Als je een klacht hebt over de manier waarop wij met je persoonsgegevens omgaan, kun je eerst contact met ons opnemen via <a href="mailto:hp9mail@gmail.com">hp9mail@gmail.com</a>.</p>
            <p>Je hebt daarnaast het recht om een klacht in te dienen bij de <strong>Autoriteit Persoonsgegevens</strong>, de Nederlandse toezichthouder op het gebied van privacy en persoonsgegevens.</p>
          </section>

          <section>
            <p class="privacy-section-number">15</p>
            <h2>Wijzigingen in deze privacyverklaring</h2>
            <p>Wij kunnen deze privacyverklaring wijzigen wanneer onze werkwijze, diensten of wettelijke verplichtingen veranderen.</p>
            <p>De meest recente versie wordt op onze website gepubliceerd. Bovenaan de privacyverklaring vermelden wij wanneer deze voor het laatst is bijgewerkt.</p>
          </section>

          <section id="contact">
            <p class="privacy-section-number">16</p>
            <h2>Contact</h2>
            <p>Heb je vragen over deze privacyverklaring of over de verwerking van je persoonsgegevens?</p>
            <p>Neem dan contact met ons op:</p>
            <p><strong>Vocalgroup Half Past Nine</strong><br />E-mail: <a href="mailto:hp9mail@gmail.com">hp9mail@gmail.com</a></p>
          </section>
        </div>
      </article>

      <footer class="privacy-footer">
        <span>Vocalgroup Half Past Nine</span>
        <a href="${appBaseHref}">Naar reserveren</a>
      </footer>
    </div>
  </main>
`;
}
