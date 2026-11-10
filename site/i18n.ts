export type Lang = 'de' | 'en';

type Entry = { de: string; en: string };

/** Every text of the page. Keys starting with `f.` label form fields, `e.` explain findings. */
export const STRINGS: Record<string, Entry> = {
  'nav.how': { de: 'Was dazukommt', en: 'What is added' },
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

  'mark.title': { de: 'Fundstelle: {f}', en: 'Found here: {f}' },
  'mark.note': {
    de: 'Blau markiert sind die Fundstellen der Angaben. Ein Klick führt zum Feld.',
    en: 'Marked in blue: where each value is printed. Click a mark to go to its field.',
  },

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
  'ai.progress': { de: 'Fortschritt beim Laden des Modells', en: 'Progress of loading the model' },
  'ai.wait': {
    de: 'Sie können weiterarbeiten, während das Modell lädt; es bleibt für das nächste Mal gespeichert.',
    en: 'You can keep working while the model loads; it is kept for next time.',
  },
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

  'xml.title': { de: 'Was in Ihre Datei kommt', en: 'What goes into your file' },
  'xml.seller': { de: 'Rechnungssteller', en: 'Seller' },
  'xml.whole': { de: 'Das ganze XML anzeigen', en: 'Show the whole XML' },
  'xml.label': { de: 'Das XML Ihrer E-Rechnung', en: 'The XML of your e-invoice' },
  'xml.copy': { de: 'Kopieren', en: 'Copy' },
  'xml.copied': { de: 'Kopiert', en: 'Copied' },
  'xml.busy': { de: 'Das XML wird erstellt …', en: 'Creating the XML …' },
  'xml.errors': {
    de: 'Solange Angaben fehlen oder fehlerhaft sind, lässt sich kein XML erstellen.',
    en: 'No XML can be created while values are missing or wrong.',
  },

  'sum.ok': { de: 'Alle Pflichtangaben sind vorhanden.', en: 'All required data is there.' },
  'sum.valid': {
    de: 'Geprüft: passt. Das XML ist vollständig, rechnerisch stimmig und stimmt mit der Seite überein.',
    en: 'Checked: looks right. The XML is complete, adds up and matches the page.',
  },
  'sum.errors.one': { de: '1 Angabe fehlt oder ist fehlerhaft', en: '1 value is missing or wrong' },
  'sum.warnings.one': { de: '1 Hinweis', en: '1 thing to check' },
  'hint.suggested': {
    de: 'Auf Ihrem PDF steht keine Zahlungsfrist, die E-Rechnung braucht aber eine. Dies ist ein Vorschlag: Bitte prüfen oder ändern.',
    en: 'Your PDF states no payment term, but an e-invoice needs one. This is a suggestion: please check or change it.',
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

  'pair.title': { de: 'Was in Ihrer Datei dazukommt', en: 'What is added to your file' },
  'pair.page': { de: 'Auf Ihrer Rechnung steht', en: 'Printed on your invoice' },
  'pair.xml': { de: 'Im XML steht dann', en: 'Written into the XML' },
  'pair.note': {
    de: 'Links lesen Menschen, rechts liest Software. Beides muss dasselbe sagen, deshalb wird jede Angabe mit Ihrem PDF verglichen.',
    en: 'People read the left side, software the right one. Both have to say the same, so every value is compared with your PDF.',
  },

  'kinds.title': { de: 'Diese Rechnungsarten gehen', en: 'Which kinds of invoices work' },
  'kind.1': { de: 'Inland mit Umsatzsteuer, auch mit mehreren Steuersätzen', en: 'Domestic with VAT, also with several rates' },
  'kind.1.xml': { de: 'Kategorie S mit dem Satz je Position', en: 'Category S with the rate of each line' },
  'kind.2': { de: 'Kleinunternehmer ohne Umsatzsteuer (§ 19 UStG)', en: 'Small business without VAT (§ 19 UStG)' },
  'kind.2.xml': { de: 'Kategorie E mit Ihrem Befreiungshinweis', en: 'Category E with your exemption note' },
  'kind.3': { de: 'Leistung an ein Unternehmen im EU-Ausland', en: 'Service for a business in another EU country' },
  'kind.3.xml': { de: 'Kategorie AE (Reverse Charge) mit der USt-IdNr. des Kunden', en: 'Category AE (reverse charge) with the VAT ID of the customer' },
  'kind.4': { de: 'Warenlieferung an ein Unternehmen im EU-Ausland', en: 'Goods delivered to a business in another EU country' },
  'kind.4.xml': { de: 'Kategorie K mit dem Bestimmungsland', en: 'Category K with the country of destination' },
  'kind.5': { de: 'Ausfuhr von Waren in ein Drittland', en: 'Export of goods outside the EU' },
  'kind.5.xml': { de: 'Kategorie G', en: 'Category G' },
  'kind.6': { de: 'Leistung in die USA oder ein anderes Drittland', en: 'Service for a customer in the USA or elsewhere outside the EU' },
  'kind.6.xml': { de: 'Kategorie O (nicht steuerbar), auch in US-Dollar', en: 'Category O (not subject to VAT), also in US dollars' },
  'kind.7': { de: 'Gutschrift oder Korrektur einer früheren Rechnung', en: 'Credit note or correction of an earlier invoice' },
  'kind.7.xml': { de: 'Typ 381 oder 384 mit Bezug auf die ursprüngliche Rechnung', en: 'Type 381 or 384 with a reference to the original invoice' },

  'limits.title': { de: 'Was Sie wissen sollten', en: 'What you should know' },
  'limits.1': {
    de: 'Nur wer die Rechnung ausstellt, kann daraus eine E-Rechnung machen. Eine erhaltene PDF-Rechnung wird durch Umwandeln nicht gültig.',
    en: 'Only the issuer can turn an invoice into an e-invoice. A PDF you received does not become valid by converting it.',
  },
  'limits.2': {
    de: 'Bei einer E-Rechnung zählt das XML, nicht das Bild. Prüfen Sie die Angaben, bevor Sie die Datei erstellen.',
    en: 'In an e-invoice the XML counts, not the picture. Check the data before you create the file.',
  },
  'limits.3': {
    de: 'Ihre Rechnung verlässt den Browser nicht: kein Server, keine Cookies, kein Tracking. Nur für „Mit KI auslesen“ lädt der Browser einmalig ein Modell von huggingface.co.',
    en: 'Your invoice does not leave the browser: no server, no cookies, no tracking. Only for “Read with AI” does the browser download a model from huggingface.co, once.',
  },
  'limits.4': { de: 'Diese Seite ist ein Werkzeug und keine Steuerberatung.', en: 'This page is a tool, not tax advice.' },
  'limits.5': {
    de: 'Die automatische Erkennung liest noch nicht aus jeder Rechnung alles. Wir arbeiten daran, dass Rechnungen jeder Art erkannt werden; was fehlt, zeigt das Formular an.',
    en: 'Automatic reading does not get everything from every invoice yet. We are working on reading invoices of every kind; the form shows what is missing.',
  },

  'dev.title': { de: 'Für Entwickler und KI-Assistenten', en: 'For developers and AI assistants' },
  'dev.text': {
    de: 'Derselbe Kern läuft als Bibliothek, als Kommandozeilenprogramm und als MCP-Server, über den KI-Assistenten Rechnungen umwandeln.',
    en: 'The same core runs as a library, as a command line tool and as an MCP server that lets AI assistants convert invoices.',
  },
  'foot.source': { de: 'Quelltext auf GitHub', en: 'Source on GitHub' },
  'foot.legal': { de: 'Impressum', en: 'Legal notice' },
  'foot.privacy': { de: 'Datenschutz', en: 'Privacy' },
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
