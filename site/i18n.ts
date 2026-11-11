export type Lang = 'de' | 'en';

type Entry = { de: string; en: string };

/** Every text of the page. Keys starting with `f.` label form fields, `e.` explain findings. */
export const STRINGS: Record<string, Entry> = {
  'doc.title': {
    de: 'pdf-to-einvoice: Aus Ihrer PDF-Rechnung wird eine E-Rechnung',
    en: 'pdf-to-einvoice: turn an invoice PDF into an e-invoice (ZUGFeRD / Factur-X)',
  },
  'nav.skip': { de: 'Zum Inhalt', en: 'Skip to content' },
  'nav.label': { de: 'Abschnitte', en: 'Sections' },
  'nav.how': { de: 'Was dazukommt', en: 'What is added' },
  'nav.dev': { de: 'Für Entwickler', en: 'For developers' },
  'nav.limits': { de: 'Fragen', en: 'Questions' },
  'nav.lang': { de: 'Sprache', en: 'Language' },
  'nav.theme': { de: 'Dunkles Design', en: 'Dark theme' },

  // The headline in three parts: the middle one is marked the way the page marks values on an invoice.
  'hero.a': { de: 'Aus Ihrer PDF-Rechnung wird eine', en: 'Turn the invoice PDF you already have into an' },
  'hero.mark': { de: 'E-Rechnung', en: 'e-invoice' },
  'hero.z': { de: '.', en: '.' },
  'hero.lead': {
    de: 'Ihre Rechnung sieht aus wie bisher. Die Rechnungsdaten kommen maschinenlesbar dazu, als XML nach EN 16931 (ZUGFeRD / Factur-X).',
    en: 'Your invoice looks as it did. The invoice data is added in machine-readable form, as XML following EN 16931 (ZUGFeRD / Factur-X).',
  },
  'hero.private': {
    de: 'Nichts wird hochgeladen. Alles passiert in Ihrem Browser.',
    en: 'Nothing is uploaded. Everything happens in your browser.',
  },
  'fact.free': { de: 'Kostenlos', en: 'Free' },
  'fact.open': { de: 'Open Source (MIT)', en: 'Open source (MIT)' },
  'fact.account': { de: 'Ohne Anmeldung', en: 'No sign-up' },
  'drop.title': { de: 'PDF hier ablegen', en: 'Drop your PDF here' },
  'drop.or': { de: 'oder Datei auswählen', en: 'or choose a file' },
  'drop.sample': { de: 'Mit einer Beispielrechnung ausprobieren', en: 'Try it with a sample invoice' },
  'drop.reading': { de: 'PDF wird gelesen\u00a0…', en: 'Reading the PDF…' },

  'work.title': { de: 'Angaben prüfen und ergänzen', en: 'Check and complete the data' },
  'work.lead': {
    de: 'Das XML ist der rechtlich maßgebliche Teil der E-Rechnung. Vergleichen Sie jede Angabe mit Ihrem PDF.',
    en: 'In an e-invoice the XML is what counts legally. Compare every value with your PDF.',
  },
  'valid.title': { de: 'Eingebettete Rechnungsdaten geprüft', en: 'Embedded invoice data checked' },
  'valid.profile': { de: 'Dieses PDF enthält bereits Rechnungsdaten als XML. Profil: {p}', en: 'This PDF already carries invoice data as XML. Profile: {p}' },
  'valid.errors': { de: 'Geprüft: {n} Fehler', en: 'Checked: {n} errors' },
  'valid.errors.one': { de: 'Geprüft: 1 Fehler', en: 'Checked: 1 error' },
  'valid.lead': {
    de: 'Das steht im XML dieser E-Rechnung. Vergleichen Sie es mit der Seite: Es zählt das XML, nicht das Bild. Dies ist eine Plausibilitätsprüfung und ersetzt keinen vollständigen Validator.',
    en: 'This is what the XML of this e-invoice says. Compare it with the page: the XML counts, not the picture. This is a plausibility check and does not replace a full validator.',
  },
  'work.other': { de: 'Anderes PDF wählen', en: 'Choose another PDF' },
  'format.title': { de: 'Erstellen als', en: 'Create as' },
  'format.pdf': { de: 'E-Rechnung (PDF)', en: 'E-invoice (PDF)' },
  // The no-break space keeps the bracket together where the label has to wrap.
  'format.xrechnung': { de: 'XRechnung (für\u00a0Behörden)', en: 'XRechnung (public\u00a0sector)' },
  'format.note': {
    de: 'Für Rechnungen an Behörden und andere öffentliche Auftraggeber. Zusätzlich nötig: die Leitweg-ID oder eine andere Referenz des Kunden, ein Ansprechpartner mit Telefon und E-Mail sowie die E-Mail-Adresse Ihres Kunden.',
    en: "For invoices to public bodies and other public-sector buyers. It also needs the Leitweg-ID or another buyer reference, a contact person with phone and email, and the buyer's email address.",
  },
  'work.preview': { de: 'Vorschau Ihrer Rechnung, Seite {n}', en: 'Preview of your invoice, page {n}' },
  'page.now': { de: 'Seite {n} von {m}', en: 'Page {n} of {m}' },
  'page.prev': { de: 'Vorherige Seite', en: 'Previous page' },
  'page.next': { de: 'Nächste Seite', en: 'Next page' },
  'page.turned': { de: 'Die Vorschau zeigt jetzt Seite {n}: Dort steht „{f}“.', en: 'The preview now shows page {n}: “{f}” is printed there.' },

  'mark.title': { de: 'Fundstelle: {f}', en: 'Found here: {f}' },
  'stamp.note': { de: 'Plausibilität geprüft', en: 'Plausibility checked' },
  'mark.note': {
    de: 'Gelb markiert sind die Fundstellen der Angaben. Ein Klick führt zum Feld.',
    en: 'Marked in yellow: where each value is printed. Click a mark to go to its field.',
  },

  'read.found': { de: '{n} Angaben ohne KI aus dem PDF übernommen.', en: '{n} values taken from the PDF without AI.' },
  'read.found.one': { de: '1 Angabe ohne KI aus dem PDF übernommen.', en: '1 value taken from the PDF without AI.' },
  'read.none': {
    de: 'Das PDF enthält keinen lesbaren Text (vermutlich ein Scan). Bitte tragen Sie die Angaben von Hand ein.',
    en: 'The PDF has no readable text (probably a scan). Please enter the data by hand.',
  },
  'ai.title': { de: 'Mit KI auslesen', en: 'Read with AI' },
  'ai.lead': {
    de: 'Ein Sprachmodell liest Namen, Adressen und Positionen aus dem Text Ihrer Rechnung. Die Modelle der Liste laufen auf Ihrem Gerät; Ihre Rechnung verlässt den Browser nicht.',
    en: 'A language model reads names, addresses and line items from the text of your invoice. The models in the list run on your device; your invoice does not leave the browser.',
  },
  'ai.model': { de: 'Modell', en: 'Model' },
  'ai.download': {
    de: 'Das Modell (etwa {size}\u00a0GB) wird beim ersten Mal von huggingface.co und raw.githubusercontent.com geladen und im Browser gespeichert.',
    en: 'The model (about {size}\u00a0GB) is downloaded from huggingface.co and raw.githubusercontent.com on first use and kept in the browser.',
  },
  // Short, so that it fits the list on a phone; the line under the list says what kind of service it has to be.
  'ai.endpoint': { de: 'Eigener Dienst', en: 'Your own service' },
  'ai.endpoint.note': {
    de: 'Ein Dienst mit OpenAI-kompatibler Schnittstelle, den Sie selbst betreiben oder dem Sie vertrauen.',
    en: 'A service with an OpenAI-compatible interface that you run yourself or trust.',
  },
  'ai.endpoint.url': { de: 'Adresse', en: 'Address' },
  'ai.endpoint.model': { de: 'Modellname', en: 'Model name' },
  'ai.endpoint.key': { de: 'Schlüssel (falls nötig)', en: 'Key (if needed)' },
  'ai.endpoint.missing': {
    de: 'Bitte geben Sie die Adresse Ihres Dienstes vollständig ein, mit http:// oder https:// am Anfang.',
    en: 'Please enter the full address of your service, starting with http:// or https://.',
  },
  'ai.endpoint.warn': {
    de: 'Der Text Ihrer Rechnung wird an diese Adresse gesendet. Liegt sie nicht auf Ihrem Gerät, verlässt er Ihr Gerät.',
    en: 'The text of your invoice is sent to this address. If it is not on your device, the text leaves your device.',
  },
  'ai.run': { de: 'Auslesen', en: 'Read invoice' },
  'ai.loading': { de: 'Modell wird geladen\u00a0… {p}\u00a0%', en: 'Loading the model… {p}%' },
  'ai.progress': { de: 'Fortschritt beim Laden des Modells', en: 'Progress of loading the model' },
  'ai.wait': {
    de: 'Sie können weiterarbeiten, während das Modell lädt; es bleibt für das nächste Mal gespeichert.',
    en: 'You can keep working while the model loads; it is kept for next time.',
  },
  'ai.reading': { de: 'Das Modell liest die Rechnung\u00a0…', en: 'The model is reading the invoice…' },
  'ai.done': { de: 'Fertig. Die KI hat {n} Angaben ergänzt: Bitte prüfen Sie sie.', en: 'Done. The AI added {n} values: please check them.' },
  'ai.done.one': { de: 'Fertig. Die KI hat 1 Angabe ergänzt: Bitte prüfen Sie sie.', en: 'Done. The AI added 1 value: please check it.' },
  'ai.done.none': { de: 'Fertig. Die KI hat nichts gefunden, was noch fehlte.', en: 'Done. The AI found nothing that was missing.' },
  'ai.nogpu': {
    de: 'Dieser Browser unterstützt kein WebGPU, das die Modelle im Browser brauchen. Nutzen Sie einen Browser mit WebGPU, oder wählen Sie einen eigenen Dienst.',
    en: 'This browser lacks WebGPU, which in-browser models need. Use a browser with WebGPU, or choose your own service.',
  },
  'ai.failed': { de: 'Das Auslesen ist fehlgeschlagen: {m}', en: 'Reading failed: {m}' },
  'ai.cancel': { de: 'Abbrechen', en: 'Cancel' },
  'ai.cancelled': { de: 'Abgebrochen. Was die automatische Erkennung gefunden hat, bleibt.', en: 'Cancelled. What automatic reading found is kept.' },

  's.invoice': { de: 'Rechnung', en: 'Invoice' },
  's.seller': { de: 'Rechnungssteller (Sie)', en: 'Seller (you)' },
  's.buyer': { de: 'Kunde', en: 'Buyer' },
  's.lines': { de: 'Positionen', en: 'Line items' },
  's.payment': { de: 'Zahlung und Steuer', en: 'Payment and VAT' },
  's.more': { de: 'Weitere Angaben', en: 'More fields' },
  's.totals': { de: 'Summen', en: 'Totals' },

  'f.number': { de: 'Rechnungsnummer', en: 'Invoice number' },
  'f.issueDate': { de: 'Rechnungsdatum', en: 'Invoice date' },
  'f.deliveryDate': { de: 'Leistungs- oder Lieferdatum (ein Tag)', en: 'Date of supply (one day)' },
  'f.periodStart': { de: 'oder Leistungszeitraum von', en: 'or service period from' },
  'f.periodEnd': { de: 'bis', en: 'to' },
  'f.dueDate': { de: 'Fällig am', en: 'Due date' },
  'f.currency': { de: 'Währung', en: 'Currency' },
  'f.typeCode': { de: 'Art des Dokuments', en: 'Document type' },
  'f.orderReference': { de: 'Bestellnummer des Kunden', en: 'Purchase order number' },
  'f.buyerReference': { de: 'Leitweg-ID oder Referenz des Kunden', en: 'Leitweg-ID or buyer reference' },
  'f.buyerReference.help': {
    de: 'Nennt Ihnen Ihr Kunde. Bei einer Behörde ist es die Leitweg-ID, z.\u00a0B. 12345678-0001-14',
    en: 'The buyer gives it to you. For a public body it is the Leitweg-ID, e.g. 12345678-0001-14',
  },
  'f.precedingInvoiceNumber': { de: 'Bezieht sich auf Rechnung Nr.', en: 'Refers to invoice no.' },
  'f.precedingInvoiceDate': { de: 'Datum der ursprünglichen Rechnung', en: 'Date of the original invoice' },
  'f.note': { de: 'Bemerkung', en: 'Note' },
  'f.paymentTerms': { de: 'Zahlungsbedingungen', en: 'Payment terms' },
  'f.iban': { de: 'IBAN', en: 'IBAN' },
  'f.bic': { de: 'BIC', en: 'BIC' },
  'f.prepaidAmount': { de: 'Bereits gezahlt', en: 'Already paid' },
  'f.vatExemptionReason': { de: 'Grund, warum keine Umsatzsteuer berechnet wird', en: 'Reason why no VAT is charged' },
  'f.name': { de: 'Name', en: 'Name' },
  'f.street': { de: 'Straße und Hausnummer', en: 'Street and number' },
  'f.postalCode': { de: 'PLZ', en: 'Postal code' },
  'f.city': { de: 'Ort', en: 'City' },
  'f.country': { de: 'Land (z.\u00a0B. DE)', en: 'Country (e.g. DE)' },
  'f.vatId': { de: 'USt-IdNr.', en: 'VAT ID' },
  'f.taxNumber': { de: 'Steuernummer', en: 'Tax number' },
  'f.email': { de: 'E-Mail', en: 'Email' },
  'f.contactName': { de: 'Ansprechpartner', en: 'Contact person' },
  'f.phone': { de: 'Telefon', en: 'Phone' },
  'l.name': { de: 'Bezeichnung', en: 'Description' },
  'l.quantity': { de: 'Menge', en: 'Quantity' },
  'l.unit': { de: 'Einheit', en: 'Unit' },
  'l.unitPrice': { de: 'Einzelpreis netto', en: 'Unit price (net)' },
  'l.vatCategory': { de: 'Umsatzsteuer', en: 'VAT' },
  'l.vatRate': { de: 'Satz\u00a0%', en: 'Rate %' },
  'l.add': { de: 'Position hinzufügen', en: 'Add a line item' },
  'l.remove': { de: 'Position {n} entfernen', en: 'Remove line item {n}' },
  'l.item': { de: 'Position {n}', en: 'Line item {n}' },

  'type.380': { de: 'Rechnung', en: 'Invoice' },
  'type.381': { de: 'Gutschrift', en: 'Credit note' },
  'type.384': { de: 'Korrekturrechnung', en: 'Corrected invoice' },
  'type.389': { de: 'Gutschrift im Gutschriftsverfahren', en: 'Self-billed invoice' },
  'type.326': { de: 'Teilrechnung', en: 'Partial invoice' },
  'type.386': { de: 'Vorauszahlungsrechnung', en: 'Prepayment invoice' },
  'unit.C62': { de: 'Stück', en: 'piece' },
  'unit.HUR': { de: 'Stunde', en: 'hour' },
  'unit.DAY': { de: 'Tag', en: 'day' },
  'unit.MON': { de: 'Monat', en: 'month' },
  'unit.KGM': { de: 'kg', en: 'kg' },
  'unit.MTR': { de: 'm', en: 'm' },
  'unit.LTR': { de: 'Liter', en: 'litre' },
  'unit.LS': { de: 'pauschal', en: 'lump sum' },
  'vat.S': { de: 'mit Umsatzsteuer', en: 'with VAT' },
  'vat.Z': { de: '0\u00a0% (Nullsatz)', en: '0% (zero-rated)' },
  'vat.E': { de: 'steuerfrei (z.\u00a0B. Kleinunternehmer)', en: 'exempt (e.g. small business)' },
  // The closed list shows the whole text of the chosen one, also on a phone: they are kept short.
  'vat.AE': { de: 'Reverse Charge (EU)', en: 'reverse charge (EU business)' },
  'vat.K': { de: 'innergemeinschaftliche Lieferung', en: 'intra-community supply' },
  'vat.G': { de: 'Ausfuhr (außerhalb der EU)', en: 'export of goods outside the EU' },
  'vat.O': { de: 'nicht steuerbar (z.\u00a0B. USA)', en: 'not subject to VAT (e.g. USA)' },

  't.net': { de: 'Netto', en: 'Net' },
  't.vat': { de: 'Umsatzsteuer', en: 'VAT' },
  't.gross': { de: 'Gesamt', en: 'Total' },
  't.due': { de: 'Zu zahlen', en: 'Amount due' },
  't.printed': { de: 'im PDF: {v}', en: 'on the PDF: {v}' },
  't.printed.xml': { de: 'laut XML: {v}', en: 'stated in the XML: {v}' },
  't.empty': { de: 'Die Summen erscheinen, sobald die Positionen vollständig sind.', en: 'Totals appear once the line items are complete.' },

  'xml.title': { de: 'Was in Ihre Datei kommt', en: 'What goes into your file' },
  'xml.seller': { de: 'Rechnungssteller', en: 'Seller' },
  'xml.whole': { de: 'Das ganze XML anzeigen', en: 'Show the whole XML' },
  'xml.label': { de: 'Das XML Ihrer E-Rechnung', en: 'The XML of your e-invoice' },
  'xml.copy': { de: 'Kopieren', en: 'Copy' },
  'xml.copied': { de: 'Kopiert', en: 'Copied' },
  'xml.busy': { de: 'Das XML wird erstellt\u00a0…', en: 'Creating the XML…' },
  'xml.errors': {
    de: 'Solange Angaben fehlen oder fehlerhaft sind, lässt sich kein XML erstellen.',
    en: 'No XML can be created while values are missing or wrong.',
  },

  'sum.ok': { de: 'Alle Pflichtangaben sind vorhanden.', en: 'All required data is there.' },
  'sum.valid': {
    de: 'Geprüft, nichts gefunden: Die Pflichtangaben sind vorhanden, die Summen gehen auf, und die verglichenen Angaben stehen so auf der Seite.',
    en: 'Checked, nothing found: the required fields are there, the totals add up, and the compared values appear on the page.',
  },
  'sum.errors.one': { de: '1 Angabe fehlt oder ist fehlerhaft', en: '1 value is missing or wrong' },
  'sum.warnings.one': { de: '1 Hinweis', en: '1 thing to check' },
  'hint.suggested': {
    de: 'Auf Ihrem PDF steht weder ein Fälligkeitsdatum noch Zahlungsbedingungen; die E-Rechnung braucht eines davon. Dies ist ein Vorschlag: Bitte prüfen oder ändern Sie ihn.',
    en: 'Your PDF states neither a due date nor payment terms; the e-invoice needs one of them. This is a suggestion: please check or change it.',
  },
  'hint.inferred': {
    de: 'Das PDF weist keine Umsatzsteuer aus; die Umsatzsteuer-Art ist aus dem Land des Kunden abgeleitet. Bitte prüfen.',
    en: "The PDF shows no VAT; the VAT category was inferred from the buyer's country. Please check.",
  },
  'hint.model': { de: 'Von KI ergänzt: Bitte prüfen.', en: 'Added by AI: please check.' },
  'hint.model.line': { de: 'Diese Position hat die KI ergänzt: Bitte prüfen.', en: 'AI added this line item: please check.' },
  'hint.ok': { de: 'Passt', en: 'Correct' },
  'hint.ok.label': { de: '{f}: passt', en: '{f}: correct' },
  'sum.model': { de: 'Die KI hat {n} Angaben ergänzt: Bitte prüfen Sie sie.', en: 'The AI added {n} values: please check them.' },
  'sum.model.one': { de: 'Die KI hat 1 Angabe ergänzt: Bitte prüfen Sie sie.', en: 'The AI added 1 value: please check it.' },
  'sum.errors': { de: '{n} Angaben fehlen oder sind fehlerhaft', en: '{n} values are missing or wrong' },
  'sum.warnings': { de: '{n} Hinweise', en: '{n} things to check' },
  'create.run': { de: 'E-Rechnung erstellen', en: 'Create e-invoice' },
  'create.run.xr': { de: 'XRechnung erstellen', en: 'Create XRechnung' },
  'create.busy': { de: 'E-Rechnung wird erstellt\u00a0…', en: 'Creating the e-invoice…' },
  'create.failed': { de: 'Die E-Rechnung konnte nicht erstellt werden: {m}', en: 'The e-invoice could not be created: {m}' },
  'done.title': { de: 'Ihre E-Rechnung ist fertig.', en: 'Your e-invoice is ready.' },
  'done.lead': {
    de: 'Dieselbe Rechnung wie vorher, jetzt mit den Rechnungsdaten als XML in der Datei (ZUGFeRD / Factur-X, Profil EN 16931).',
    en: 'The same invoice as before, now with its data inside as XML (ZUGFeRD / Factur-X, profile EN 16931).',
  },
  'done.pdf': { de: 'E-Rechnung herunterladen', en: 'Download e-invoice' },
  'done.xml': { de: 'Nur das XML herunterladen', en: 'Download the XML only' },
  'done.again': { de: 'Angaben noch einmal ändern', en: 'Change the data again' },
  'done.checksum': { de: 'Prüfsumme (SHA-256) von', en: 'Checksum (SHA-256) of' },
  'done.title.xr': { de: 'Ihre XRechnung ist fertig.', en: 'Your XRechnung is ready.' },
  'done.lead.xr': {
    de: 'Die XML-Datei ist die XRechnung: Laden Sie sie im Rechnungsportal der Behörde hoch. Das PDF sieht aus wie Ihre Rechnung und trägt dieselbe XRechnung in sich, als Kopie für Ihre Unterlagen.',
    en: "The XML file is the XRechnung: upload it to the public body's invoice portal. The PDF looks like your invoice and carries the same XRechnung, as a copy for your records.",
  },
  'done.xr.xml': { de: 'XRechnung herunterladen (XML)', en: 'Download XRechnung (XML)' },
  'done.xr.pdf': { de: 'PDF mit XRechnung herunterladen', en: 'Download PDF with XRechnung' },

  // One text per code of the library; in English its own message is shown. `e.<code>.<field>` words a code for one field,
  // and {a}, {b}, {v} and {m} are filled in by the page (see `describe` in main.ts). test/i18n.test.ts checks that no
  // code is missing.
  'e.required': { de: 'Diese Angabe fehlt.', en: '' },
  'e.format': { de: 'Diese Angabe hat nicht das richtige Format. Bitte prüfen Sie die Schreibweise.', en: '' },
  'e.format.country': { de: 'Bitte geben Sie das Land als Kürzel mit zwei Buchstaben an, z.\u00a0B. DE.', en: '' },
  'e.format.currency': { de: 'Bitte geben Sie die Währung als Kürzel mit drei Buchstaben an, z.\u00a0B. EUR.', en: '' },
  'e.format.iban': { de: 'Diese IBAN ist ungültig: Die Prüfziffern passen nicht. Bitte vergleichen Sie sie mit Ihrem PDF.', en: '' },
  'e.period-reversed': { de: 'Der Leistungszeitraum endet vor seinem Beginn. Bitte prüfen Sie beide Daten.', en: '' },
  'e.negative-price': { de: 'Der Preis darf nicht negativ sein. Für eine Gutschrift geben Sie eine negative Menge ein.', en: '' },
  'e.seller-tax-id': {
    de: 'Der Rechnungssteller braucht eine USt-IdNr. oder eine Steuernummer, bei innergemeinschaftlicher Lieferung und Ausfuhr die USt-IdNr.',
    en: '',
  },
  'e.payment-terms': { de: 'Ist ein Betrag zu zahlen, braucht die E-Rechnung ein Fälligkeitsdatum oder Zahlungsbedingungen.', en: '' },
  'e.vat-rate': {
    de: 'Der Steuersatz passt nicht zur gewählten Umsatzsteuer: Bei „mit Umsatzsteuer“ liegt er über 0, sonst bei 0.',
    en: '',
  },
  'e.exemption-reason': { de: 'Bitte nennen Sie den Grund, warum keine Umsatzsteuer berechnet wird, so wie er auf der Rechnung steht.', en: '' },
  'e.buyer-vat-id': { de: 'Für Reverse Charge und innergemeinschaftliche Lieferungen ist die USt-IdNr. des Kunden nötig.', en: '' },
  // An existing e-invoice: both sides of the contradiction are in its XML.
  'e.totals-mismatch.xml': {
    de: 'Die im XML angegebene Summe passt nicht zu seinen Positionen. Bitten Sie den Rechnungssteller um eine korrigierte E-Rechnung.',
    en: 'The total stated in the XML does not match its lines. Ask the issuer for a corrected e-invoice.',
  },
  'e.totals-mismatch': {
    de: 'Die Summe im PDF weicht von der Summe der Positionen ab. Die E-Rechnung darf dem PDF nicht widersprechen: Bitte prüfen Sie Mengen und Preise.',
    en: '',
  },
  'e.address': { de: 'Dieser Teil der Anschrift fehlt. §\u00a014 UStG verlangt die vollständige Anschrift.', en: '' },
  'e.delivery-date': {
    de: 'Das Leistungs- oder Lieferdatum (oder ein Leistungszeitraum) fehlt. Es ist Pflicht, auch wenn es dem Rechnungsdatum entspricht.',
    en: '',
  },
  'e.preceding-invoice': { de: 'Eine Korrektur oder Gutschrift sollte die ursprüngliche Rechnung nennen.', en: '' },
  'e.not-in-pdf': { de: 'Diese Angabe steht so nicht im PDF. Bitte prüfen.', en: '' },
  'e.no-pdf-text': {
    de: 'Das PDF enthält keinen lesbaren Text (vermutlich ein Scan). Bitte prüfen Sie jede Angabe selbst.',
    en: '',
  },
  'e.xrechnung-buyer-reference': {
    de: 'Für eine XRechnung ist die Leitweg-ID oder eine andere Referenz des Kunden nötig. Ihr Kunde nennt sie Ihnen, eine Behörde meist mit dem Auftrag.',
    en: '',
  },
  'e.xrechnung-seller-contact': {
    de: 'Für eine XRechnung ist ein Ansprechpartner nötig: die Person oder Abteilung, an die sich Ihr Kunde mit Fragen zur Rechnung wendet.',
    en: '',
  },
  'e.xrechnung-seller-phone': { de: 'Für eine XRechnung ist die Telefonnummer Ihres Ansprechpartners nötig.', en: '' },
  'e.xrechnung-seller-email': {
    de: 'Für eine XRechnung ist Ihre E-Mail-Adresse nötig. Sie steht im XML beim Ansprechpartner und als Ihre elektronische Adresse.',
    en: '',
  },
  'e.xrechnung-buyer-email': {
    de: 'Für eine XRechnung ist die E-Mail-Adresse Ihres Kunden nötig: Sie steht im XML als seine elektronische Adresse. Fragen Sie Ihren Kunden, an welche Adresse Rechnungen gehen sollen.',
    en: '',
  },
  'e.xrechnung-address': { de: 'Dieser Teil der Anschrift fehlt. Für eine XRechnung ist er Pflicht.', en: '' },
  'e.xrechnung-line-net': {
    de: 'Menge mal Preis ergibt {a}, auf Ihrer Rechnung steht als Betrag dieser Position aber {b}. Bei einer XRechnung muss beides bis auf Rundung übereinstimmen. Passen Sie Menge oder Preis an; einen Rabatt auf einzelne Positionen kann diese Seite noch nicht angeben.',
    en: '',
  },
  'e.xrechnung-payment-terms': {
    de: 'Beginnen die Zahlungsbedingungen mit #, liest die XRechnung sie als Skonto. Das muss genau so geschrieben sein: #SKONTO#TAGE=14#PROZENT=2.00# (Tage, dann Prozent mit zwei Nachkommastellen). Schreiben Sie es so, oder lassen Sie das # weg.',
    en: '',
  },
  'e.xrechnung-delivery-address': {
    de: 'Eine innergemeinschaftliche Lieferung lässt sich hier noch nicht als XRechnung erstellen: Die XRechnung verlangt dann Postleitzahl und Ort des Lieferorts, und dafür gibt es noch kein Feld. Wählen Sie oben „E-Rechnung (PDF)“, wenn Ihr Kunde sie annimmt.',
    en: '',
  },
  'e.xrechnung-type-code': {
    de: 'Die XRechnung kennt die Vorauszahlungsrechnung (Typ 386) nicht; der Empfänger nimmt sie womöglich nicht an. Klären Sie das vorher, oder wählen Sie eine andere Art des Dokuments.',
    en: '',
  },
  'e.xrechnung-phone': { de: 'Das sieht nicht nach einer Telefonnummer aus: Die XRechnung erwartet mindestens drei Ziffern.', en: '' },
  'e.xrechnung-email': { de: 'Das sieht nicht nach einer E-Mail-Adresse aus. Die XRechnung erwartet eine Adresse wie name@example.org.', en: '' },
  'e.pdf-fonts': {
    de: 'Im PDF sind nicht alle Schriften eingebettet. Das XML ist davon nicht betroffen, die Datei ist aber kein strenges PDF/A-3. Abhilfe: das PDF mit eingebetteten Schriften (oder als PDF/A) exportieren und die E-Rechnung daraus neu erstellen.',
    en: '',
  },
  'e.generator': { de: 'Beim Schreiben des XML kam diese Meldung: {m}', en: '' },
  'e.not-written': { de: '„{v}“ ließ sich nicht in das XML schreiben. Bitte melden Sie das als Fehler auf GitHub.', en: '' },
  'e.invalid-invoice': { de: 'Die Angaben sind noch nicht vollständig oder fehlerhaft: Bitte beheben Sie, was die Prüfung nennt.', en: '' },
  'e.already-einvoice': { de: 'Dieses PDF ist bereits eine E-Rechnung. Nehmen Sie das PDF ohne XML, um eine neue zu erstellen.', en: '' },
  'e.no-xml': { de: 'Das PDF enthält kein Rechnungs-XML: Es ist ein gewöhnliches PDF, keine E-Rechnung.', en: '' },
  'e.xml-syntax': {
    de: 'Das eingebettete XML lässt sich nicht als Rechnung lesen. Bitten Sie den Rechnungssteller um eine E-Rechnung nach ZUGFeRD 2 / Factur-X.',
    en: '',
  },
  'e.profile': {
    de: 'Das XML hat kein Profil auf Grundlage der EN 16931; MINIMUM und BASIC WL gelten nicht als E-Rechnung. Bitten Sie den Rechnungssteller um das Profil EN 16931 (COMFORT), EXTENDED oder XRECHNUNG.',
    en: '',
  },
  'e.pdf-a': {
    de: 'Die Datei ist nicht als PDF/A-3 gekennzeichnet, wie ZUGFeRD / Factur-X es verlangt. Ein strenger Empfänger kann sie ablehnen. Lassen Sie sie als PDF/A-3 neu ausgeben.',
    en: '',
  },
  'e.invalid-pdf': { de: 'Diese Datei lässt sich nicht als PDF lesen.', en: 'This file cannot be read as a PDF.' },

  'pair.title': { de: 'Was in Ihrer Datei dazukommt', en: 'What is added to your file' },
  'pair.page': { de: 'Auf Ihrer Rechnung steht', en: 'Printed on your invoice' },
  'pair.xml': { de: 'Im XML steht dann', en: 'Written into the XML' },
  'pair.note': {
    de: 'Links lesen Menschen, rechts liest Software. Beides muss dasselbe sagen, deshalb werden die wichtigsten Angaben mit Ihrem PDF verglichen.',
    en: 'People read the left side, software the right one. Both have to say the same, so the key values are compared with your PDF.',
  },

  // Compared with typical online converters, none of them named. Each row: the question, their side, this tool.
  'cmp.title': { de: 'Im Vergleich', en: 'Compared' },
  'cmp.lead': {
    de: 'Viele Dienste wandeln PDF-Rechnungen ebenfalls um. Der Unterschied liegt vor allem darin, wo Ihre Rechnung verarbeitet wird.',
    en: 'Many services convert PDF invoices too. The main difference is where your invoice is processed.',
  },
  'cmp.them': { de: 'Typischer Online-Konverter', en: 'Typical online converter' },
  'cmp.1': { de: 'Wo wird Ihre Rechnung verarbeitet?', en: 'Where is your invoice processed?' },
  'cmp.1.them': { de: 'Auf den Servern des Anbieters: Die Datei wird hochgeladen.', en: "On the provider's servers: the file is uploaded." },
  'cmp.1.us': { de: 'Auf Ihrem Gerät, im Browser. Nichts wird hochgeladen.', en: 'On your device, in the browser. Nothing is uploaded.' },
  'cmp.2': { de: 'Wer liest die Angaben aus?', en: 'Who reads the data?' },
  'cmp.2.them': {
    de: 'Je nach Anbieter ein KI-Dienst in der Cloud, auch außerhalb der EU, oder Sie tippen alles ab.',
    en: 'Depending on the provider, an AI service in the cloud, also outside the EU, or you type everything in.',
  },
  'cmp.2.us': {
    de: 'Regeln auf Ihrem Gerät; auf Wunsch zusätzlich ein Sprachmodell, das ebenfalls in Ihrem Browser läuft.',
    en: 'Rules on your device; on request also a language model that runs in your browser too.',
  },
  'cmp.3': { de: 'Woher stammt jede Angabe?', en: 'Where does each value come from?' },
  'cmp.3.them': { de: 'Sie sehen ein Formular zum Korrigieren.', en: 'You get a form to correct.' },
  'cmp.3.us': {
    de: 'Jede Angabe ist im PDF markiert, und das XML wird mit dem PDF abgeglichen.',
    en: 'Each value is marked on the PDF, and the XML is compared with the PDF.',
  },
  'cmp.4': { de: 'Konto, Werbung, Tracking', en: 'Account, ads, tracking' },
  'cmp.4.them': { de: 'Je nach Anbieter Anmeldung, Werbung oder Abo.', en: 'Depending on the provider, sign-up, ads or a subscription.' },
  'cmp.4.us': { de: 'Keine Anmeldung, keine Werbung, keine Cookies.', en: 'No sign-up, no ads, no cookies.' },
  'cmp.5': { de: 'Quelltext', en: 'Source code' },
  'cmp.5.them': { de: 'Meist nicht einsehbar.', en: 'Mostly closed.' },
  'cmp.5.us': { de: 'Offen (MIT-Lizenz): Jeder kann nachprüfen, was die Seite tut.', en: 'Open (MIT licence): anyone can check what the page does.' },
  'cmp.6': { de: 'Für Software und KI-Assistenten', en: 'For software and AI assistants' },
  'cmp.6.them': { de: 'Meist eine Schnittstelle, an die Rechnungen geschickt werden.', en: 'Mostly an API that invoices are sent to.' },
  'cmp.6.us': {
    de: 'Bibliothek, Kommandozeile und MCP-Server, alles auf dem eigenen Rechner.',
    en: 'Library, command line tool and MCP server, all on your own machine.',
  },
  'cmp.7': { de: 'Formate', en: 'Formats' },
  'cmp.7.them': { de: 'ZUGFeRD, oft auch XRechnung und weitere.', en: 'ZUGFeRD, often XRechnung and more.' },
  'cmp.7.us': { de: 'ZUGFeRD / Factur-X und XRechnung nach EN 16931.', en: 'ZUGFeRD / Factur-X and XRechnung, following EN 16931.' },
  'cmp.8': { de: 'Prüfung gegen die offiziellen Regelwerke', en: 'Checking against the official rule sets' },
  'cmp.8.them': { de: 'Teils mit eigenem Prüfwerkzeug.', en: 'Some offer their own validator.' },
  'cmp.8.us': {
    de: 'Eine eigene Plausibilitätsprüfung; keine vollständige Prüfung gegen die offiziellen Regelwerke.',
    en: 'Its own plausibility check; not a complete check against the official rule sets.',
  },

  'kinds.title': { de: 'Welche Rechnungsarten gehen?', en: 'Which kinds of invoices work?' },
  'kind.1': { de: 'Inland mit Umsatzsteuer, auch mit mehreren Steuersätzen', en: 'Domestic with VAT, also with several rates' },
  'kind.1.xml': { de: 'Kategorie S mit dem Satz je Position', en: 'Category S with the rate of each line item' },
  'kind.2': { de: 'Kleinunternehmer ohne Umsatzsteuer (§\u00a019 UStG)', en: 'Small business without VAT (§ 19 UStG)' },
  'kind.2.xml': { de: 'Kategorie E mit Ihrem Befreiungshinweis', en: 'Category E with your exemption note' },
  'kind.3': { de: 'Leistung an ein Unternehmen im EU-Ausland', en: 'Service for a business in another EU country' },
  'kind.3.xml': { de: 'Kategorie AE (Reverse Charge) mit der USt-IdNr. des Kunden', en: 'Category AE (reverse charge) with the VAT ID of the buyer' },
  'kind.4': { de: 'Warenlieferung an ein Unternehmen im EU-Ausland', en: 'Goods delivered to a business in another EU country' },
  'kind.4.xml': { de: 'Kategorie K mit dem Bestimmungsland', en: 'Category K with the country of destination' },
  'kind.5': { de: 'Ausfuhr von Waren in ein Land außerhalb der EU', en: 'Export of goods outside the EU' },
  'kind.5.xml': { de: 'Kategorie G', en: 'Category G' },
  'kind.6': { de: 'Leistung in die USA oder in ein anderes Land außerhalb der EU', en: 'Service for a buyer in the USA or elsewhere outside the EU' },
  'kind.6.xml': { de: 'Kategorie O (nicht steuerbar), auch in US-Dollar', en: 'Category O (not subject to VAT), also in US dollars' },
  'kind.7': { de: 'Gutschrift oder Korrektur einer früheren Rechnung', en: 'Credit note or correction of an earlier invoice' },
  'kind.7.xml': { de: 'Typ 381 oder 384 mit Bezug auf die ursprüngliche Rechnung', en: 'Type 381 or 384 with a reference to the original invoice' },

  'limits.title': { de: 'Fragen und Antworten', en: 'Questions and answers' },
  // Each note answers one question; the number is that of its note.
  'ask.1': { de: 'Wer darf eine Rechnung umwandeln?', en: 'Who may convert an invoice?' },
  'ask.2': { de: 'Was zählt: das PDF oder das XML?', en: 'What counts: the PDF or the XML?' },
  'ask.3': { de: 'Verlässt meine Rechnung den Browser?', en: 'Does my invoice leave the browser?' },
  'ask.4': { de: 'Ist das eine Steuer- oder Rechtsberatung?', en: 'Is this tax or legal advice?' },
  'ask.5': { de: 'Wird jede Rechnung erkannt?', en: 'Is every invoice recognised?' },
  'limits.1': {
    de: 'Nur wer die Rechnung ausstellt, kann daraus eine E-Rechnung machen. Eine erhaltene PDF-Rechnung wird durch Umwandeln nicht zur E-Rechnung.',
    en: 'Only the issuer can turn an invoice into an e-invoice. A PDF you received does not become an e-invoice by converting it.',
  },
  'limits.2': {
    de: 'Bei einer E-Rechnung zählt das XML, nicht das Bild. Prüfen Sie die Angaben, bevor Sie die Datei erstellen.',
    en: 'In an e-invoice the XML counts, not the picture. Check the data before you create the file.',
  },
  'limits.3': {
    de: 'Ihre Rechnung verlässt den Browser nicht: nichts wird hochgeladen, keine Cookies, kein Tracking. Nur für „Mit KI auslesen“ lädt der Browser einmalig ein Modell von huggingface.co und raw.githubusercontent.com.',
    en: 'Your invoice does not leave the browser: nothing is uploaded, no cookies, no tracking. Only for “Read with AI” does the browser download a model from huggingface.co and raw.githubusercontent.com, once.',
  },
  'limits.4': { de: 'Diese Seite ist ein Werkzeug und keine Steuer- oder Rechtsberatung.', en: 'This page is a tool, not tax or legal advice.' },
  'limits.5': {
    de: 'Die automatische Erkennung liest noch nicht aus jeder Rechnung alles, und sie kann sich irren. Wir arbeiten daran, dass Rechnungen jeder Art erkannt werden. Was fehlt, zeigt das Formular; ob ein erkannter Wert stimmt, prüfen Sie bitte selbst.',
    en: 'Automatic reading does not get everything from every invoice yet, and it can be wrong. We are working on reading invoices of every kind. The form shows what is missing; please check every value it read.',
  },

  'dev.title': { de: 'Für Entwickler und KI-Assistenten', en: 'For developers and AI assistants' },
  'dev.text': {
    de: 'Derselbe Kern läuft als Bibliothek, als Kommandozeilenprogramm und als MCP-Server, über den KI-Assistenten Rechnungen umwandeln.',
    en: 'The same core runs as a library, as a command line tool and as an MCP server that lets AI assistants convert invoices.',
  },
  'dev.npm': { de: 'Das Paket: Bibliothek, Kommandozeile, MCP-Server', en: 'The package: library, command line tool, MCP server' },
  'dev.github': { de: 'Quelltext, Dokumentation, Fehler melden', en: 'Source, documentation, issues' },
  'dev.llms': { de: 'Die Kurzfassung für Sprachmodelle', en: 'The short version for language models' },
  'dev.schema': { de: 'Alle Felder der Rechnungsdaten als JSON Schema', en: 'Every field of the invoice data, as JSON Schema' },
  'dev.tabs': { de: 'Wege, es zu nutzen', en: 'Ways to use it' },
  'dev.tab.lib': { de: 'Bibliothek', en: 'Library' },
  'dev.tab.cli': { de: 'Kommandozeile', en: 'Command line' },
  'dev.tab.mcp': { de: 'MCP-Server', en: 'MCP server' },
  'foot.source': { de: 'Quelltext auf GitHub', en: 'Source on GitHub' },
  'foot.legal': { de: 'Impressum', en: 'Legal notice' },
  'foot.privacy': { de: 'Datenschutz', en: 'Privacy' },
  'foot.licence': { de: 'MIT-Lizenz', en: 'MIT licence' },
  'foot.third': { de: 'Lizenzen Dritter', en: 'Third-party licences' },
};

const stored = () => {
  try {
    return localStorage.getItem('lang');
  } catch {
    return null;
  }
};

export let lang: Lang = (() => {
  const wanted = new URLSearchParams(location.search).get('lang') ?? stored() ?? navigator.language;
  return wanted.toLowerCase().startsWith('de') ? 'de' : 'en';
})();

export function t(key: string, values: Record<string, string | number> = {}): string {
  const text = STRINGS[key]?.[lang] || STRINGS[key]?.en || key;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
}

/** Translates every element that carries `data-i18n`, and remembers the choice. */
export function setLang(next: Lang): void {
  lang = next;
  try {
    localStorage.setItem('lang', next);
  } catch {
    // Private mode: the choice simply lasts for this visit.
  }
  document.documentElement.lang = next;
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n!);
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel!));
}
