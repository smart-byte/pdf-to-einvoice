export type Lang = 'de' | 'en';

type Entry = { de: string; en: string };

/** Every text of the page. Keys starting with `f.` label form fields, `e.` explain findings. */
export const STRINGS: Record<string, Entry> = {
  'nav.how': { de: 'So funktioniert es', en: 'How it works' },
  'nav.dev': { de: 'Für Entwickler', en: 'For developers' },
  'nav.limits': { de: 'Grenzen', en: 'Limits' },

  'hero.title': { de: 'Aus Ihrer PDF-Rechnung wird eine E-Rechnung.', en: 'Turn the invoice PDF you already have into an e-invoice.' },
  'hero.lead': {
    de: 'Ihr Layout bleibt, wie es ist. Die Rechnungsdaten kommen als XML dazu, nach EN 16931 (ZUGFeRD / Factur-X).',
    en: 'Your layout stays exactly as it is. The invoice data is added as XML, following EN 16931 (ZUGFeRD / Factur-X).',
  },
  'hero.private': {
    de: 'Nichts wird hochgeladen. Alles passiert in Ihrem Browser.',
    en: 'Nothing is uploaded. Everything happens in your browser.',
  },
  'drop.title': { de: 'PDF hier ablegen', en: 'Drop your PDF here' },
  'drop.or': { de: 'oder Datei auswählen', en: 'or choose a file' },
  'drop.sample': { de: 'Mit einer Beispielrechnung ausprobieren', en: 'Try it with a sample invoice' },
  'drop.reading': { de: 'PDF wird gelesen …', en: 'Reading the PDF …' },

  'work.title': { de: 'Angaben prüfen und ergänzen', en: 'Check and complete the data' },
  'work.lead': {
    de: 'Das XML ist der rechtlich maßgebliche Teil der E-Rechnung. Vergleichen Sie jede Angabe mit Ihrem PDF.',
    en: 'The XML is the legally binding part of an e-invoice. Compare every value with your PDF.',
  },
  'valid.title': { de: 'E-Rechnung geprüft', en: 'E-invoice checked' },
  'valid.profile': { de: 'Dieses PDF ist bereits eine E-Rechnung. Profil: {p}', en: 'This PDF already is an e-invoice. Profile: {p}' },
  'valid.errors': { de: 'Geprüft: {n} Auffälligkeiten', en: 'Checked: {n} problems' },
  'valid.errors.one': { de: 'Geprüft: 1 Auffälligkeit', en: 'Checked: 1 problem' },
  'valid.lead': {
    de: 'Das steht in ihrem XML. Vergleichen Sie es mit der Seite: Es zählt das XML, nicht das Bild. Dies ist eine Plausibilitätsprüfung und ersetzt keinen vollständigen Validator.',
    en: 'This is what its XML says. Compare it with the page: the XML counts, not the picture. This is a plausibility check and does not replace a full validator.',
  },
  'work.other': { de: 'Anderes PDF wählen', en: 'Choose another PDF' },
  'work.preview': { de: 'Vorschau Ihrer Rechnung, Seite 1', en: 'Preview of your invoice, page 1' },

  'read.found': { de: '{n} Angaben per Mustersuche erkannt.', en: '{n} values found by pattern matching.' },
  'read.none': {
    de: 'Das PDF enthält keinen lesbaren Text (vermutlich ein Scan). Bitte tragen Sie die Angaben von Hand ein.',
    en: 'The PDF has no readable text (probably a scan). Please enter the data by hand.',
  },
  'ai.title': { de: 'Mit KI auslesen', en: 'Read with AI' },
  'ai.lead': {
    de: 'Ein Sprachmodell liest Namen, Adressen und Positionen aus dem Text Ihrer Rechnung. Es läuft auf Ihrem Gerät; Ihre Rechnung verlässt den Browser nicht.',
    en: 'A language model reads names, addresses and line items from the text of your invoice. It runs on your device; your invoice does not leave the browser.',
  },
  'ai.model': { de: 'Modell', en: 'Model' },
  'ai.download': {
    de: 'Das Modell wird beim ersten Mal von huggingface.co geladen und im Browser gespeichert.',
    en: 'The model is downloaded from huggingface.co on first use and kept in the browser.',
  },
  'ai.endpoint': { de: 'Eigener Dienst (OpenAI-kompatibel, z. B. Ollama)', en: 'Your own service (OpenAI-compatible, e.g. Ollama)' },
  'ai.endpoint.url': { de: 'Adresse', en: 'Address' },
  'ai.endpoint.model': { de: 'Modellname', en: 'Model name' },
  'ai.endpoint.key': { de: 'Schlüssel (falls nötig)', en: 'Key (if needed)' },
  'ai.endpoint.warn': {
    de: 'Der Text Ihrer Rechnung wird an diese Adresse gesendet. Bei einer Adresse außerhalb Ihres Geräts verlässt er den Browser.',
    en: 'The text of your invoice is sent to this address. If it is not on your device, the text leaves the browser.',
  },
  'ai.run': { de: 'Auslesen', en: 'Read invoice' },
  'ai.loading': { de: 'Modell wird geladen … {p} %', en: 'Loading the model … {p} %' },
  'ai.reading': { de: 'Das Modell liest die Rechnung …', en: 'The model is reading the invoice …' },
  'ai.done': {
    de: 'Fertig. Die Angaben wurden ergänzt. Ein Modell kann sich irren: Bitte alles prüfen.',
    en: 'Done. The data has been filled in. A model can be wrong: please check everything.',
  },
  'ai.nogpu': {
    de: 'Dieser Browser unterstützt kein WebGPU, das die Modelle im Browser brauchen. Nutzen Sie Chrome oder Edge, oder wählen Sie einen eigenen Dienst.',
    en: 'This browser lacks WebGPU, which in-browser models need. Use Chrome or Edge, or choose your own service.',
  },
  'ai.failed': { de: 'Das Auslesen ist fehlgeschlagen: {m}', en: 'Reading failed: {m}' },

  's.invoice': { de: 'Rechnung', en: 'Invoice' },
  's.seller': { de: 'Rechnungssteller (Sie)', en: 'Seller (you)' },
  's.buyer': { de: 'Kunde', en: 'Buyer' },
  's.lines': { de: 'Positionen', en: 'Line items' },
  's.payment': { de: 'Zahlung', en: 'Payment' },
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
  'f.buyerReference': { de: 'Käuferreferenz (Leitweg-ID)', en: 'Buyer reference' },
  'f.precedingInvoiceNumber': { de: 'Bezieht sich auf Rechnung Nr.', en: 'Refers to invoice no.' },
  'f.precedingInvoiceDate': { de: 'Datum jener Rechnung', en: 'Date of that invoice' },
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
  'f.country': { de: 'Land (z. B. DE)', en: 'Country (e.g. DE)' },
  'f.vatId': { de: 'USt-IdNr.', en: 'VAT ID' },
  'f.taxNumber': { de: 'Steuernummer', en: 'Tax number' },
  'f.email': { de: 'E-Mail', en: 'E-mail' },
  'l.name': { de: 'Bezeichnung', en: 'Description' },
  'l.quantity': { de: 'Menge', en: 'Quantity' },
  'l.unit': { de: 'Einheit', en: 'Unit' },
  'l.unitPrice': { de: 'Preis netto', en: 'Net price' },
  'l.vatCategory': { de: 'Umsatzsteuer', en: 'VAT' },
  'l.vatRate': { de: 'Satz %', en: 'Rate %' },
  'l.add': { de: 'Position hinzufügen', en: 'Add a line' },
  'l.remove': { de: 'Position {n} entfernen', en: 'Remove line {n}' },

  'type.380': { de: 'Rechnung', en: 'Invoice' },
  'type.381': { de: 'Gutschrift', en: 'Credit note' },
  'type.384': { de: 'Korrekturrechnung', en: 'Corrected invoice' },
  'type.389': { de: 'Gutschrift im Gutschriftsverfahren', en: 'Self-billed invoice' },
  'type.326': { de: 'Teilrechnung', en: 'Partial invoice' },
  'type.386': { de: 'Abschlagsrechnung', en: 'Prepayment invoice' },
  'unit.C62': { de: 'Stück', en: 'piece' },
  'unit.HUR': { de: 'Stunde', en: 'hour' },
  'unit.DAY': { de: 'Tag', en: 'day' },
  'unit.MON': { de: 'Monat', en: 'month' },
  'unit.KGM': { de: 'kg', en: 'kg' },
  'unit.MTR': { de: 'm', en: 'm' },
  'unit.LTR': { de: 'Liter', en: 'litre' },
  'unit.LS': { de: 'pauschal', en: 'lump sum' },
  'vat.S': { de: 'mit Umsatzsteuer', en: 'with VAT' },
  'vat.Z': { de: '0 % (Nullsatz)', en: '0 % (zero rated)' },
  'vat.E': { de: 'steuerfrei (z. B. Kleinunternehmer)', en: 'exempt (e.g. small business)' },
  'vat.AE': { de: 'Reverse Charge (EU-Unternehmen)', en: 'reverse charge (EU business)' },
  'vat.K': { de: 'innergemeinschaftliche Lieferung', en: 'intra-community supply' },
  'vat.G': { de: 'Ausfuhr (Waren ins Nicht-EU-Ausland)', en: 'export of goods outside the EU' },
  'vat.O': { de: 'nicht steuerbar (z. B. Leistung in die USA)', en: 'not subject to VAT (e.g. service to the USA)' },

  't.net': { de: 'Netto', en: 'Net' },
  't.vat': { de: 'Umsatzsteuer', en: 'VAT' },
  't.gross': { de: 'Gesamt', en: 'Total' },
  't.due': { de: 'Zu zahlen', en: 'Amount due' },
  't.printed': { de: 'im PDF: {v}', en: 'on the PDF: {v}' },
  't.empty': { de: 'Die Summen erscheinen, sobald die Positionen vollständig sind.', en: 'Totals appear once the line items are complete.' },

  'sum.ok': { de: 'Alle Pflichtangaben sind vorhanden.', en: 'All required data is there.' },
  'sum.valid': {
    de: 'Geprüft: passt. Das XML ist vollständig, rechnerisch stimmig und stimmt mit der Seite überein.',
    en: 'Checked: looks right. The XML is complete, adds up and matches the page.',
  },
  'sum.errors.one': { de: '1 Angabe fehlt oder ist fehlerhaft', en: '1 value is missing or wrong' },
  'sum.warnings.one': { de: '1 Hinweis', en: '1 thing to check' },
  'hint.suggested': {
    de: 'Auf Ihrem PDF steht keine Zahlungsfrist. Vorschlag: {n} Tage ab Rechnungsdatum. Bitte prüfen oder ändern.',
    en: 'Your PDF states no payment term. Suggested: {n} days from the invoice date. Please check or change it.',
  },
  'sum.errors': { de: '{n} Angaben fehlen oder sind fehlerhaft', en: '{n} values are missing or wrong' },
  'sum.warnings': { de: '{n} Hinweise', en: '{n} things to check' },
  'create.run': { de: 'E-Rechnung erstellen', en: 'Create e-invoice' },
  'create.busy': { de: 'E-Rechnung wird erstellt …', en: 'Creating the e-invoice …' },
  'create.failed': { de: 'Die E-Rechnung konnte nicht erstellt werden: {m}', en: 'The e-invoice could not be created: {m}' },
  'done.title': { de: 'Ihre E-Rechnung ist fertig.', en: 'Your e-invoice is ready.' },
  'done.lead': {
    de: 'Dieselbe Rechnung wie vorher, jetzt als PDF/A-3 mit den Daten als XML (ZUGFeRD / Factur-X, Profil EN 16931).',
    en: 'The same invoice as before, now a PDF/A-3 that carries its data as XML (ZUGFeRD / Factur-X, profile EN 16931).',
  },
  'done.pdf': { de: 'E-Rechnung herunterladen', en: 'Download e-invoice' },
  'done.xml': { de: 'Nur das XML herunterladen', en: 'Download the XML only' },
  'done.again': { de: 'Angaben noch einmal ändern', en: 'Change the data again' },

  'e.required': { de: 'Diese Angabe fehlt.', en: '' },
  'e.format': { de: 'Diese Angabe hat nicht das richtige Format.', en: '' },
  'e.seller-tax-id': { de: 'Der Rechnungssteller braucht eine USt-IdNr. oder eine Steuernummer.', en: '' },
  'e.payment-terms': { de: 'Bei einem offenen Betrag ist ein Fälligkeitsdatum oder eine Zahlungsbedingung nötig.', en: '' },
  'e.vat-rate': { de: 'Der Steuersatz passt nicht zur gewählten Umsatzsteuer-Art.', en: '' },
  'e.exemption-reason': { de: 'Bitte nennen Sie den Grund, warum keine Umsatzsteuer berechnet wird, so wie er auf der Rechnung steht.', en: '' },
  'e.buyer-vat-id': { de: 'Für Reverse Charge und innergemeinschaftliche Lieferungen ist die USt-IdNr. des Kunden nötig.', en: '' },
  'e.totals-mismatch': { de: 'Die Summe im PDF weicht von der Summe der Positionen ab. Die E-Rechnung darf dem PDF nicht widersprechen.', en: '' },
  'e.address': { de: 'Diese Angabe der Anschrift fehlt. § 14 UStG verlangt die vollständige Anschrift.', en: '' },
  'e.delivery-date': { de: 'Das Leistungsdatum fehlt. Es ist Pflicht, auch wenn es dem Rechnungsdatum entspricht.', en: '' },
  'e.preceding-invoice': { de: 'Eine Korrektur oder Gutschrift sollte die ursprüngliche Rechnung nennen.', en: '' },
  'e.not-in-pdf': { de: 'Dieser Wert steht so nicht im PDF. Bitte prüfen.', en: '' },
  'e.no-pdf-text': { de: 'Das PDF enthält keinen Text. Die Angaben konnten nicht mit dem PDF verglichen werden.', en: '' },
  'e.pdf-fonts': {
    de: 'Im PDF sind nicht alle Schriften eingebettet. Das XML ist gültig, die Datei aber kein strenges PDF/A-3. Exportieren Sie das PDF mit eingebetteten Schriften (oder als PDF/A), um das zu beheben.',
    en: '',
  },
  'e.no-xml': { de: 'Das PDF enthält kein Rechnungs-XML.', en: '' },
  'e.xml-syntax': { de: 'Das eingebettete XML lässt sich nicht als Rechnung (CII) lesen.', en: '' },
  'e.profile': {
    de: 'Das XML nennt kein Profil der EN 16931. Die Profile MINIMUM und BASIC WL gelten nicht als E-Rechnung.',
    en: '',
  },
  'e.pdf-a': { de: 'Die Datei weist sich nicht als PDF/A-3 aus.', en: '' },
  'e.invalid-pdf': { de: 'Diese Datei lässt sich nicht als PDF lesen.', en: 'This file cannot be read as a PDF.' },

  'how.title': { de: 'So funktioniert es', en: 'How it works' },
  'how.1.title': { de: 'PDF wählen', en: 'Choose your PDF' },
  'how.1.text': {
    de: 'Die Rechnung, wie Sie sie heute schreiben: aus Word, Ihrem Rechnungsprogramm oder einer Vorlage.',
    en: 'The invoice as you write it today: from Word, your invoicing tool or a template.',
  },
  'how.2.title': { de: 'Angaben prüfen', en: 'Check the data' },
  'how.2.text': {
    de: 'Die Angaben werden aus dem PDF gelesen. Sie sehen, was fehlt oder nicht zum PDF passt, und ergänzen es.',
    en: 'The data is read from the PDF. You see what is missing or does not match the PDF, and complete it.',
  },
  'how.3.title': { de: 'E-Rechnung herunterladen', en: 'Download the e-invoice' },
  'how.3.text': {
    de: 'Sie erhalten dasselbe PDF, das jetzt die Daten als XML trägt. Versenden Sie es wie gewohnt.',
    en: 'You get the same PDF, which now carries its data as XML. Send it the way you always do.',
  },

  'kinds.title': { de: 'Für jede Art von Rechnung', en: 'For every kind of invoice' },
  'kinds.text': {
    de: 'Inland mit Umsatzsteuer, mehrere Steuersätze, Kleinunternehmer, Reverse Charge in der EU, innergemeinschaftliche Lieferung, Ausfuhr, Leistungen in die USA ohne Umsatzsteuer, Gutschriften und Korrekturen. Jede dieser Arten wird mit dem Referenzprüfer der ZUGFeRD-Community getestet.',
    en: 'Domestic with VAT, several VAT rates, small businesses, reverse charge within the EU, intra-community supplies, exports, services to the USA without VAT, credit notes and corrections. Each of these is tested with the reference validator of the ZUGFeRD community.',
  },

  'limits.title': { de: 'Was Sie wissen sollten', en: 'What you should know' },
  'limits.1': {
    de: 'Nur der Rechnungssteller kann eine E-Rechnung ausstellen. Eine erhaltene PDF-Rechnung wird durch Umwandeln beim Empfänger nicht zur gültigen E-Rechnung.',
    en: 'Only the issuer can issue an e-invoice. A PDF you received does not become a valid e-invoice by converting it yourself.',
  },
  'limits.2': {
    de: 'Bei einer E-Rechnung zählt das XML, nicht das Bild. Sie sind dafür verantwortlich, dass die Angaben stimmen.',
    en: 'In an e-invoice the XML counts, not the picture. You are responsible for the data being right.',
  },
  'limits.3': {
    de: 'Ein strenges PDF/A-3 setzt voraus, dass Ihr PDF seine Schriften einbettet. Fehlen sie, weist die Seite darauf hin.',
    en: 'A strict PDF/A-3 requires your PDF to embed its fonts. If they are missing, the page tells you.',
  },
  'limits.4': {
    de: 'Rabatte auf die ganze Rechnung gibt es noch nicht als eigenes Feld: Tragen Sie sie als Position mit negativer Menge ein.',
    en: 'Discounts on the whole invoice have no field of their own yet: enter them as a line with a negative quantity.',
  },
  'limits.5': { de: 'Diese Seite ist ein Werkzeug und keine Steuerberatung.', en: 'This page is a tool, not tax advice.' },

  'dev.title': { de: 'Für Entwickler und KI-Assistenten', en: 'For developers and AI assistants' },
  'dev.text': {
    de: 'Derselbe Kern läuft als Bibliothek, als Kommandozeilenprogramm und als MCP-Server, über den Assistenten wie Claude Rechnungen umwandeln.',
    en: 'The same core runs as a library, as a command line tool and as an MCP server that lets assistants like Claude convert invoices.',
  },
  'privacy.title': { de: 'Datenschutz', en: 'Privacy' },
  'privacy.text': {
    de: 'Die Seite hat keinen Server, der Ihre Rechnung sieht, keine Cookies und kein Tracking. Nur wenn Sie „Mit KI auslesen“ wählen, lädt der Browser einmalig ein Modell von huggingface.co; Ihre Rechnung wird dabei nicht übertragen.',
    en: 'There is no server that sees your invoice, no cookies and no tracking. Only if you choose “Read with AI” does the browser download a model from huggingface.co, once; your invoice is not transmitted.',
  },
  'foot.source': { de: 'Quelltext auf GitHub', en: 'Source on GitHub' },
  'foot.licence': { de: 'MIT-Lizenz', en: 'MIT licence' },
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
