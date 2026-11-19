import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { check, percentSpellings } from '../../src/domain/check.js';
import type { InvoiceDraft } from '../../src/domain/model.js';

const sample = (): InvoiceDraft => JSON.parse(readFileSync(new URL('../../examples/sample-invoice.json', import.meta.url), 'utf8'));

/** The sample with one change applied. */
const withChange = (change: (draft: any) => void): InvoiceDraft => {
  const draft = sample();
  change(draft);
  return draft;
};

const codesAt = (draft: InvoiceDraft, path: string, options?: { pdfText?: string }) =>
  check(draft, options)
    .findings.filter((f) => f.path === path)
    .map((f) => `${f.severity}:${f.code}`);

describe('check', () => {
  it('accepts a complete invoice and returns it with defaults and totals', () => {
    const result = check(sample());
    expect(result.findings).toEqual([]);
    expect(result.invoice).toMatchObject({ typeCode: '380', currency: 'EUR' });
    expect(result.totals).toMatchObject({ net: 1499, vat: 284.81, gross: 1783.81 });
  });

  it('returns no invoice while an error is open', () => {
    expect(check(withChange((d) => delete d.number)).invoice).toBeUndefined();
  });

  it('asks where the goods of an intra-community supply went, unless the data says so', () => {
    const supply = (change: (d: any) => void = () => {}) =>
      withChange((d) => {
        Object.assign(d.buyer, { country: 'AT', vatId: 'ATU12345678' });
        for (const line of d.lines) Object.assign(line, { vatCategory: 'K', vatRate: 0 });
        d.vatExemptionReason = 'Steuerfreie innergemeinschaftliche Lieferung';
        delete d.totals;
        change(d);
      });
    expect(codesAt(supply(), 'deliveryCountry')).toEqual(['warning:delivery-country']);
    expect(
      codesAt(
        supply((d) => (d.deliveryCountry = 'it')),
        'deliveryCountry',
      ),
    ).toEqual([]);
    expect(
      codesAt(
        supply((d) => (d.deliveryCountry = 'Italien')),
        'deliveryCountry',
      ),
    ).toEqual(['error:format']);
    expect(codesAt(sample(), 'deliveryCountry')).toEqual([]);
  });

  it('reports an amount that is not a number instead of failing', () => {
    expect(
      codesAt(
        withChange((d) => (d.prepaidAmount = 'abc')),
        'prepaidAmount',
      ),
    ).toEqual(['error:format']);
    expect(
      codesAt(
        withChange((d) => (d.prepaidAmount = Number.NaN)),
        'prepaidAmount',
      ),
    ).toEqual(['error:format']);
  });

  it('wants a line total to be quantity times price, two cents apart at most', () => {
    const lineTotal = (netAmount: number, currency = 'EUR') =>
      codesAt(
        withChange((d) => {
          Object.assign(d, { currency });
          d.lines[1].netAmount = netAmount;
          delete d.totals;
        }),
        'lines.1.netAmount',
      );
    expect(lineTotal(499.03)).toEqual(['error:line-net']);
    expect(lineTotal(499.02)).toEqual([]);
    expect(lineTotal(498.98)).toEqual([]);
    expect(lineTotal(498.97)).toEqual(['error:line-net']);
    // Forint has no cents in practice: there half a forint is allowed.
    expect(lineTotal(499.5, 'HUF')).toEqual([]);
    expect(lineTotal(499.51, 'HUF')).toEqual(['error:line-net']);
  });

  it('quotes the line total it expects in cents: 1 x 1.005 less 0.02 is 0.99', () => {
    const result = check(
      withChange((d) => {
        delete d.totals;
        Object.assign(d.lines[0], { quantity: 1, unitPrice: 1.005, discount: { amount: 0.02 }, netAmount: 0.5 });
      }),
    );
    expect(result.findings.find((f) => f.code === 'line-net')?.message).toContain('is 0.99,');
  });

  it('checks a line total against quantity times price less the discount', () => {
    const at = (netAmount: number) =>
      codesAt(
        withChange((d) => {
          delete d.totals;
          Object.assign(d.lines[1], { discount: { percent: 10 }, netAmount });
        }),
        'lines.1.netAmount',
      );
    expect(at(449.1)).toEqual([]);
    expect(at(499)).toEqual(['error:line-net']);
  });

  it('wants a discount to have a percentage or an amount, a percentage that is not negative, and numbers', () => {
    const at = (discount: unknown, path: string) =>
      codesAt(
        withChange((d) => {
          delete d.totals;
          d.lines[1].discount = discount;
        }),
        path,
      );
    expect(at({ reason: 'Treuerabatt' }, 'lines.1.discount')).toEqual(['error:discount']);
    expect(at({ percent: -5 }, 'lines.1.discount.percent')).toEqual(['error:discount']);
    expect(at({ percent: '10 %' }, 'lines.1.discount.percent')).toEqual(['error:format']);
  });

  it('ignores a discount whose fields were all left empty', () => {
    const result = check(
      withChange((d) => {
        delete d.totals;
        d.lines[1].discount = { percent: null, amount: '' };
      }),
    );
    expect(result.findings.filter((f) => f.path.startsWith('lines.1'))).toEqual([]);
    expect(result.invoice?.lines[1]).not.toHaveProperty('discount');
  });

  it('wants percentage and amount of a discount to agree, two cents apart at most', () => {
    const at = (amount: number) =>
      codesAt(
        withChange((d) => {
          delete d.totals;
          d.lines[1].discount = { percent: 10, amount };
        }),
        'lines.1.discount.amount',
      );
    expect(at(49.92)).toEqual([]);
    expect(at(49.93)).toEqual(['error:discount-mismatch']);
  });

  it('compares the discount the XML gets, in cents, with its percentage', () => {
    // 9.995 is two cents from 10 % of 99.75 (9.975), but the XML gets 10.00, which is 0.025 off.
    const at = (amount: number) =>
      codesAt(
        withChange((d) => {
          delete d.totals;
          Object.assign(d.lines[1], { quantity: 1, unitPrice: 99.75, discount: { percent: 10, amount } });
        }),
        'lines.1.discount.amount',
      );
    expect(at(9.995)).toEqual(['error:discount-mismatch']);
    expect(at(9.99)).toEqual([]);
  });

  it('warns about a fixed discount whose sign differs from its line', () => {
    const at = (quantity: number, amount: number) =>
      codesAt(
        withChange((d) => {
          delete d.totals;
          Object.assign(d.lines[1], { quantity, discount: { amount } });
        }),
        'lines.1.discount.amount',
      );
    expect(at(-2, 50)).toEqual(['warning:discount-sign']);
    expect(at(-2, -50)).toEqual([]);
    expect(at(0, 5)).toEqual([]);
  });

  it('spells a percentage the ways a page prints it', () => {
    expect(percentSpellings(10)).toEqual(expect.arrayContaining(['10%', '10,00%', '10.0%']));
    expect(percentSpellings(12.345)).toEqual(expect.arrayContaining(['12,345%', '12.345%']));
  });

  it('looks for the percentage of a discount on the page, never for the amount derived from it', () => {
    const draft = withChange((d) => {
      delete d.totals;
      d.lines[1].discount = { percent: 10, amount: 49.9 };
    });
    expect(codesAt(draft, 'lines.1.discount.percent', { pdfText: 'Rabatt 10 %' })).toEqual([]);
    expect(codesAt(draft, 'lines.1.discount.amount', { pdfText: 'Rabatt 10 %' })).toEqual([]);
    expect(codesAt(draft, 'lines.1.discount.percent', { pdfText: 'Rabatt' })).toEqual(['warning:not-in-pdf']);
  });

  it('looks for the amount of a discount that has no percentage', () => {
    const draft = withChange((d) => {
      delete d.totals;
      d.lines[1].discount = { amount: 37.5 };
    });
    expect(codesAt(draft, 'lines.1.discount.amount', { pdfText: 'Rabatt 37,50' })).toEqual([]);
    expect(codesAt(draft, 'lines.1.discount.amount', { pdfText: 'Rabatt' })).toEqual(['warning:not-in-pdf']);
  });

  describe('discounts and charges on the whole invoice', () => {
    /** The sample without its printed totals, changed. Its lines are both at 19 %. */
    const adjusted = (change: (d: any) => void) =>
      withChange((d) => {
        delete d.totals;
        change(d);
      });
    /** What `check` says about one path, never throwing. */
    const said = (change: (d: any) => void, path: string, options?: { pdfText?: string; rules?: 'xrechnung' }) =>
      check(adjusted(change), options)
        .findings.filter((f) => f.path === path)
        .map((f) => `${f.severity}:${f.code}`);

    it('takes them into the totals', () => {
      const result = check(adjusted((d) => Object.assign(d, { discounts: [{ percent: 10 }], charges: [{ amount: 10, reason: 'Fracht' }] })));
      expect(result.findings).toEqual([]);
      expect(result.totals).toMatchObject({ lineTotal: 1499, allowances: 149.9, charges: 10, net: 1359.1 });
    });

    it('wants each to have a percentage or an amount, numbers, and a percentage that is not negative', () => {
      expect(said((d) => (d.discounts = [{ reason: 'Treuerabatt' }]), 'discounts.0')).toEqual(['error:adjustment']);
      expect(said((d) => (d.discounts = [null]), 'discounts.0')).toEqual(['error:adjustment']);
      expect(said((d) => (d.discounts = [{ percent: -5 }]), 'discounts.0.percent')).toEqual(['error:adjustment']);
      expect(said((d) => (d.discounts = [{ percent: '10 %' }]), 'discounts.0.percent')).toEqual(['error:format']);
      expect(said((d) => (d.charges = [{ amount: Number.NaN, reason: 'Fracht' }]), 'charges.0.amount')).toEqual(['error:format']);
      expect(said((d) => (d.charges = [{ amount: 5, reason: 'Fracht', vatRate: 'neunzehn' }]), 'charges.0.vatRate')).toEqual(['error:format']);
      expect(said((d) => (d.charges = 'Fracht 5,00'), 'charges')).toEqual(['error:format']);
    });

    it('wants the reason of a charge, but not of a discount', () => {
      expect(said((d) => (d.charges = [{ amount: 5 }]), 'charges.0.reason')).toEqual(['error:charge-reason']);
      expect(said((d) => (d.charges = [{ amount: 5, reason: ' ' }]), 'charges.0.reason')).toEqual(['error:charge-reason']);
      expect(said((d) => (d.discounts = [{ percent: 5, reason: ' ' }]), 'discounts.0.reason')).toEqual([]);
    });

    it('names discounts and charges where the totals of the PDF differ, since reading does not find them yet', () => {
      const mismatch = check(withChange((d) => (d.totals.net = 1424.05))).findings.find((f) => f.path === 'totals.net');
      expect(mismatch?.message).toMatch(/discounts or charges on the whole invoice/);
    });

    it('wants a known VAT category and a rate that fits it', () => {
      expect(said((d) => (d.discounts = [{ amount: 5, vatCategory: 'X' }]), 'discounts.0.vatCategory')).toEqual(['error:format']);
      expect(said((d) => (d.discounts = [{ amount: 5, vatCategory: 'Z', vatRate: 7 }]), 'discounts.0.vatRate')).toEqual(['error:vat-rate']);
      expect(said((d) => (d.discounts = [{ amount: 5, vatCategory: 'S', vatRate: 0 }]), 'discounts.0.vatRate')).toEqual(['error:vat-rate']);
    });

    it('does not guess the VAT group of an amount, and gives neither totals nor data while it cannot be placed', () => {
      const twoRates = (change: (d: any) => void) => (d: any) => {
        d.lines[1].vatRate = 7;
        change(d);
      };
      expect(
        said(
          twoRates((d) => (d.discounts = [{ amount: 10 }])),
          'discounts.0.vatRate',
        ),
      ).toEqual(['error:adjustment-group']);
      expect(
        said(
          twoRates((d) => (d.discounts = [{ percent: 10, vatRate: 16 }])),
          'discounts.0.vatRate',
        ),
      ).toEqual(['error:adjustment-group']);
      expect(
        said(
          twoRates((d) => (d.discounts = [{ amount: 10, vatRate: 7 }])),
          'discounts.0.vatRate',
        ),
      ).toEqual([]);
      const result = check(adjusted(twoRates((d) => (d.discounts = [{ amount: 10 }]))));
      expect(result.totals).toBeUndefined();
      expect(result.invoice).toBeUndefined();
    });

    it('wants percentage and amount to agree: within R040 on one VAT group, to the cent on several', () => {
      const one =
        (amount: number, currency = 'EUR') =>
        (d: any) => {
          d.lines = [{ ...d.lines[0], quantity: 1, unitPrice: 0.15 }];
          Object.assign(d, { currency, discounts: [{ percent: 10, amount }] });
        };
      expect(said(one(0.03), 'discounts.0.amount')).toEqual([]);
      expect(said(one(0.04), 'discounts.0.amount')).toEqual(['error:adjustment-mismatch']);
      expect(said(one(0.5, 'HUF'), 'discounts.0.amount')).toEqual([]);
      const several = (amount: number) => (d: any) => {
        d.lines[1].vatRate = 7;
        d.discounts = [{ percent: 10, amount }];
      };
      expect(said(several(149.9), 'discounts.0.amount')).toEqual([]);
      expect(said(several(149.91), 'discounts.0.amount')).toEqual(['error:adjustment-mismatch']);
    });

    it('warns about an amount whose sign differs from its lines', () => {
      expect(said((d) => (d.discounts = [{ amount: -10 }]), 'discounts.0.amount')).toEqual(['warning:adjustment-sign']);
    });

    it('does not mix category O with any other VAT group (BR-O-11), on lines or in a charge', () => {
      const exempt = (d: any) => (d.vatExemptionReason = 'Nicht steuerbar');
      expect(
        said((d) => {
          exempt(d);
          d.lines[1] = { ...d.lines[1], vatCategory: 'O', vatRate: 0 };
        }, 'lines.1.vatCategory'),
      ).toEqual(['error:category-o']);
      expect(
        said((d) => {
          exempt(d);
          d.charges = [{ amount: 5, reason: 'Porto', vatCategory: 'O' }];
        }, 'charges.0.vatCategory'),
      ).toEqual(['error:category-o']);
      expect(
        said((d) => {
          exempt(d);
          for (const line of d.lines) Object.assign(line, { vatCategory: 'O', vatRate: 0 });
          d.charges = [{ amount: 5, reason: 'Porto' }];
        }, 'charges.0.vatCategory'),
      ).toEqual([]);
    });

    it('asks what a VAT category needs also for one that only a discount or charge has', () => {
      const charge = (vatCategory: string) => (d: any) => (d.charges = [{ amount: 5, reason: 'Fracht', vatCategory }]);
      expect(said(charge('AE'), 'vatExemptionReason')).toEqual(['error:exemption-reason']);
      expect(said(charge('AE'), 'buyer.vatId')).toEqual(['error:buyer-vat-id']);
      expect(said(charge('K'), 'deliveryCountry')).toEqual(['warning:delivery-country']);
      expect(said(charge('K'), 'charges.0.vatCategory', { rules: 'xrechnung' })).toEqual(['error:xrechnung-delivery-address']);
      expect(
        said((d) => {
          charge('G')(d);
          d.seller = { ...d.seller, vatId: undefined, taxNumber: '12/345/67890' };
        }, 'seller.vatId'),
      ).toEqual(['error:seller-tax-id']);
    });

    it('looks for the percentage on the page, or else the amount, never for what is derived from them', () => {
      const pdfText = 'Treuerabatt 5 % Fracht 9,90 Gutschrift -3,00';
      const draft = adjusted((d) => {
        d.lines[1].vatRate = 7;
        d.discounts = [{ percent: 5, amount: 74.95, reason: 'Treuerabatt' }];
        d.charges = [
          { amount: 9.9, reason: 'Fracht', vatRate: 19 },
          { amount: -3, reason: 'Gutschrift', vatRate: 19 },
        ];
      });
      const notInPdf = (text: string) => check(draft, { pdfText: text }).findings.filter((f) => f.code === 'not-in-pdf' && /^(discounts|charges)/.test(f.path));
      expect(notInPdf(pdfText)).toEqual([]);
      expect(notInPdf('Fracht 9,90').map((f) => f.path)).toEqual(['discounts.0.percent', 'charges.1.amount']);
    });
  });

  it('treats null and blank strings as missing', () => {
    expect(
      codesAt(
        withChange((d) => (d.number = '  ')),
        'number',
      ),
    ).toEqual(['error:required']);
    expect(
      codesAt(
        withChange((d) => (d.buyer.name = null)),
        'buyer.name',
      ),
    ).toEqual(['error:required']);
  });

  it.each(['number', 'issueDate', 'seller.name', 'seller.country', 'buyer.name', 'buyer.country'])('requires %s', (path) => {
    const draft = withChange((d) => {
      const keys = path.split('.');
      const last = keys.pop()!;
      delete keys.reduce((o, k) => o[k], d)[last];
    });
    expect(codesAt(draft, path)).toEqual(['error:required']);
  });

  it('requires at least one line', () => {
    expect(
      codesAt(
        withChange((d) => (d.lines = [])),
        'lines',
      ),
    ).toEqual(['error:required']);
  });

  it('requires name, quantity and unit price on every line', () => {
    const draft = withChange((d) => (d.lines[1] = { vatRate: 19 }));
    expect(codesAt(draft, 'lines.1.name')).toEqual(['error:required']);
    expect(codesAt(draft, 'lines.1.quantity')).toEqual(['error:required']);
    expect(codesAt(draft, 'lines.1.unitPrice')).toEqual(['error:required']);
  });

  it('rejects a date that does not exist', () => {
    expect(
      codesAt(
        withChange((d) => (d.issueDate = '2026-02-30')),
        'issueDate',
      ),
    ).toEqual(['error:format']);
    expect(
      codesAt(
        withChange((d) => (d.issueDate = '03.11.2026')),
        'issueDate',
      ),
    ).toEqual(['error:format']);
  });

  it('rejects a country that is not a two-letter code', () => {
    expect(
      codesAt(
        withChange((d) => (d.seller.country = 'Germany')),
        'seller.country',
      ),
    ).toEqual(['error:format']);
  });

  it('rejects an IBAN with a wrong check digit', () => {
    expect(
      codesAt(
        withChange((d) => (d.iban = 'DE03120300000000202051')),
        'iban',
      ),
    ).toEqual(['error:format']);
  });

  it('accepts an IBAN written with spaces', () => {
    expect(
      codesAt(
        withChange((d) => (d.iban = 'DE02 1203 0000 0000 2020 51')),
        'iban',
      ),
    ).toEqual([]);
  });

  it('rejects a negative unit price', () => {
    expect(
      codesAt(
        withChange((d) => (d.lines[0].unitPrice = -5)),
        'lines.0.unitPrice',
      ),
    ).toEqual(['error:negative-price']);
  });

  it('keeps the code for a malformed price apart from that of a negative one', () => {
    expect(
      codesAt(
        withChange((d) => (d.lines[0].unitPrice = '12,50')),
        'lines.0.unitPrice',
      ),
    ).toEqual(['error:format']);
  });

  it('requires a tax identifier of the seller', () => {
    expect(
      codesAt(
        withChange((d) => delete d.seller.vatId),
        'seller.vatId',
      ),
    ).toEqual(['error:seller-tax-id']);
  });

  it('accepts a tax number in place of the VAT ID', () => {
    const draft = withChange((d) => {
      delete d.seller.vatId;
      d.seller.taxNumber = '123/456/78901';
    });
    expect(codesAt(draft, 'seller.vatId')).toEqual([]);
  });

  it('requires a due date or payment terms when money is owed', () => {
    const draft = withChange((d) => {
      delete d.dueDate;
      delete d.paymentTerms;
    });
    expect(codesAt(draft, 'dueDate')).toEqual(['error:payment-terms']);
  });

  it('requires a VAT rate above zero for the standard category', () => {
    expect(
      codesAt(
        withChange((d) => (d.lines[0].vatRate = 0)),
        'lines.0.vatRate',
      ),
    ).toEqual(['error:vat-rate']);
  });

  it('requires a zero rate, a reason and the buyer VAT ID for reverse charge', () => {
    const draft = withChange((d) => {
      for (const line of d.lines) Object.assign(line, { vatCategory: 'AE', vatRate: 19 });
      delete d.totals;
    });
    expect(codesAt(draft, 'lines.0.vatRate')).toEqual(['error:vat-rate']);
    expect(codesAt(draft, 'vatExemptionReason')).toEqual(['error:exemption-reason']);
    expect(codesAt(draft, 'buyer.vatId')).toEqual(['error:buyer-vat-id']);
  });

  it('reports printed totals that contradict the calculation', () => {
    const draft = withChange((d) => (d.totals.gross = 1783.8));
    expect(codesAt(draft, 'totals.gross')).toEqual(['error:totals-mismatch']);
  });

  it('warns when an address is incomplete', () => {
    expect(
      codesAt(
        withChange((d) => delete d.buyer.street),
        'buyer.street',
      ),
    ).toEqual(['warning:address']);
  });

  it('warns when the date of supply is missing', () => {
    expect(
      codesAt(
        withChange((d) => delete d.deliveryDate),
        'deliveryDate',
      ),
    ).toEqual(['warning:delivery-date']);
  });

  it('accepts a service period as the date of supply', () => {
    const draft = withChange((d) => {
      delete d.deliveryDate;
      Object.assign(d, { periodStart: '2026-10-01', periodEnd: '2026-10-31' });
    });
    expect(codesAt(draft, 'deliveryDate')).toEqual([]);
  });

  it('rejects a service period that ends before it starts', () => {
    const draft = withChange((d) => Object.assign(d, { periodStart: '2026-10-31', periodEnd: '2026-10-01' }));
    expect(codesAt(draft, 'periodEnd')).toEqual(['error:period-reversed']);
  });

  it('keeps the code for a malformed end of the period apart from that of a reversed one', () => {
    const draft = withChange((d) => Object.assign(d, { periodStart: '2026-10-01', periodEnd: '31.10.2026' }));
    expect(codesAt(draft, 'periodEnd')).toEqual(['error:format']);
  });

  it('warns when a corrected invoice does not name the invoice it corrects', () => {
    expect(
      codesAt(
        withChange((d) => (d.typeCode = '384')),
        'precedingInvoiceNumber',
      ),
    ).toEqual(['warning:preceding-invoice']);
  });

  it('still returns the invoice when only warnings are open', () => {
    expect(check(withChange((d) => delete d.buyer.street)).invoice).toBeDefined();
  });
});

describe('check against the PDF text', () => {
  const pdfText = [
    'Muster Software GmbH · Beispielweg 1 · 12345 Musterstadt',
    'Beispiel AG, Hauptstraße 5, 54321 Beispielstadt',
    'Rechnung Nr. RE-2026-0042   Rechnungsdatum 03.11.2026   Leistungsdatum 31.10.2026',
    '1  Beratung E-Rechnung   10 Std.   100,00 €   1.000,00 €',
    '2  Softwarelizenz (Jahr)   2 Stk.   249,50 €   499,00 €',
    'Netto 1.499,00 €   USt 19 % 284,81 €   Gesamtbetrag 1.783,81 €',
    'Zahlbar bis 17. November 2026. IBAN DE02 1203 0000 0000 2020 51  USt-IdNr. DE123456789',
  ].join('\n');

  it('finds every value of the sample in its own text', () => {
    expect(check(sample(), { pdfText }).findings).toEqual([]);
  });

  it('warns about an invoice number the PDF does not show', () => {
    expect(
      codesAt(
        withChange((d) => (d.number = 'RE-2026-0043')),
        'number',
        { pdfText },
      ),
    ).toEqual(['warning:not-in-pdf']);
  });

  it.each(['seller.street', 'seller.postalCode', 'seller.city', 'buyer.street', 'buyer.postalCode', 'buyer.city'])(
    'warns about a part of an address the PDF does not show: %s',
    (path) => {
      const [who, field] = path.split('.') as [string, string];
      const draft = withChange((d) => (d[who][field] = field === 'postalCode' ? '99999' : 'Anderswo 7'));
      expect(codesAt(draft, path, { pdfText })).toEqual(['warning:not-in-pdf']);
    },
  );

  it('warns about a date the PDF does not show', () => {
    expect(
      codesAt(
        withChange((d) => (d.dueDate = '2026-11-18')),
        'dueDate',
        { pdfText },
      ),
    ).toEqual(['warning:not-in-pdf']);
  });

  it.each(['09.08.23', '9.8.23', '09/08/23', '08/09/23'])('finds a date the PDF prints with a two-digit year, as %s', (printed) => {
    const draft = withChange((d) => (d.dueDate = '2023-08-09'));
    expect(codesAt(draft, 'dueDate', { pdfText: `${pdfText}\nFällig ${printed}` })).toEqual([]);
  });

  it('warns about a unit price the PDF does not show', () => {
    const draft = withChange((d) => {
      d.lines[1].unitPrice = 249.4;
      delete d.totals;
    });
    expect(codesAt(draft, 'lines.1.unitPrice', { pdfText })).toEqual(['warning:not-in-pdf']);
  });

  it('finds a unit price with more decimals than cents, as the PDF prints it', () => {
    const draft = withChange((d) => {
      Object.assign(d.lines[1], { quantity: 1000, unitPrice: 0.4995 });
      delete d.totals;
    });
    const fine = pdfText.replace('2 Stk.   249,50 €   499,00 €', '1.000 Stk.   0,4995 €   499,50 €');
    expect(codesAt(draft, 'lines.1.unitPrice', { pdfText: fine })).toEqual([]);
  });

  it('warns when the calculated total is not on the PDF', () => {
    const draft = withChange((d) => {
      d.lines[0].quantity = 11;
      delete d.totals;
    });
    expect(codesAt(draft, 'totals.gross', { pdfText })).toEqual(['warning:not-in-pdf']);
  });

  it('finds a line name whose words are spread over several table rows', () => {
    const wrapped = pdfText.replace('1  Beratung E-Rechnung   10 Std.   100,00 €   1.000,00 €', '1  Beratung   10 Std.   100,00 €   1.000,00 €\n   E-Rechnung');
    expect(check(sample(), { pdfText: wrapped }).findings).toEqual([]);
  });

  it('still warns about a line name of which a word is missing from the PDF', () => {
    expect(
      codesAt(
        withChange((d) => (d.lines[0].name = 'Beratung XRechnung')),
        'lines.0.name',
        { pdfText },
      ),
    ).toEqual(['warning:not-in-pdf']);
  });

  it('says so once when the PDF has no text to compare with', () => {
    expect(check(sample(), { pdfText: '  ' }).findings.map((f) => f.code)).toEqual(['no-pdf-text']);
  });
});

describe('check with the XRechnung rules', () => {
  /** The sample with what XRechnung asks for on top, and one change applied. */
  const xrechnung = (change: (draft: any) => void = () => {}) =>
    withChange((d) => {
      d.buyerReference = '99000000-BEISPIEL-00';
      Object.assign(d.seller, { contactName: 'Erika Muster', phone: '+49 30 1234567' });
      d.buyer.email = 'einkauf@beispiel.example';
      change(d);
    });
  const found = (draft: InvoiceDraft) => check(draft, { rules: 'xrechnung' }).findings.map((f) => `${f.severity} ${f.path}: ${f.code}`);
  const remove = (path: string) => (d: any) => {
    const keys = path.split('.');
    const last = keys.pop()!;
    delete keys.reduce((o, k) => o[k], d)[last];
  };

  it('accepts an invoice that has what XRechnung asks for', () => {
    const result = check(xrechnung(), { rules: 'xrechnung' });
    expect(result.findings).toEqual([]);
    expect(result.invoice).toBeDefined();
  });

  it('asks for none of it unless the rules are named', () => {
    expect(check(sample()).findings).toEqual([]);
    expect(check(sample(), { rules: 'xrechnung' }).invoice).toBeUndefined();
  });

  it.each([
    ['buyerReference', 'xrechnung-buyer-reference'],
    ['seller.contactName', 'xrechnung-seller-contact'],
    ['seller.phone', 'xrechnung-seller-phone'],
    ['seller.email', 'xrechnung-seller-email'],
    ['buyer.email', 'xrechnung-buyer-email'],
    ['seller.city', 'xrechnung-address'],
    ['seller.postalCode', 'xrechnung-address'],
    ['buyer.city', 'xrechnung-address'],
    ['buyer.postalCode', 'xrechnung-address'],
  ])('requires %s', (path, code) => {
    expect(found(xrechnung(remove(path)))).toContain(`error ${path}: ${code}`);
  });

  it('says in plain words what is missing, without rule numbers', () => {
    const { findings } = check(sample(), { rules: 'xrechnung' });
    expect(findings.length).toBeGreaterThan(3);
    for (const finding of findings) {
      expect(finding.message).toContain('XRechnung');
      expect(finding.message).not.toMatch(/BR-|BT-\d|PEPPOL/);
    }
  });

  it('reports a line total that is not quantity times price once, as every profile does', () => {
    const findings = found(
      xrechnung((d) => {
        d.lines[1].netAmount = 499.03;
        delete d.totals;
      }),
    );
    expect(findings).toEqual(['error lines.1.netAmount: line-net']);
  });

  it('reads a payment terms line that starts with # as a cash discount in the fixed form', () => {
    const terms = (paymentTerms: string) => found(xrechnung((d) => (d.paymentTerms = paymentTerms)));
    expect(terms('#Rabatt nach Vereinbarung')).toEqual(['error paymentTerms: xrechnung-payment-terms']);
    expect(terms('Zahlbar in 30 Tagen.\n#SKONTO#TAGE=14#PROZENT=2#')).toEqual(['error paymentTerms: xrechnung-payment-terms']);
    expect(terms('Zahlbar in 30 Tagen.\n#SKONTO#TAGE=14#PROZENT=2.00#')).toEqual([]);
    expect(terms('#SKONTO#TAGE=14#PROZENT=2.00#BASISBETRAG=1000.00#\nSonst 30 Tage netto.')).toEqual([]);
    expect(terms('Rechnung #42 zahlbar in 14 Tagen')).toEqual([]);
    // After the last #...# of the text the validator wants a line break, whatever that line is.
    expect(terms('#SKONTO#TAGE=14#PROZENT=2.00#\nRechnungen #42 und #43 zahlbar in 30 Tagen')).toEqual(['error paymentTerms: xrechnung-payment-terms']);
    expect(terms('Rechnungen #42 und #43 zahlbar in 30 Tagen\n  #SKONTO#TAGE=14#PROZENT=2.00#')).toEqual([]);
  });

  it('refuses a country of delivery, which XRechnung takes with city and postal code only', () => {
    expect(found(xrechnung((d) => (d.deliveryCountry = 'AT')))).toEqual(['error deliveryCountry: xrechnung-delivery-address']);
  });

  it('refuses an intra-community supply, which needs a delivery address the data cannot hold', () => {
    const draft = xrechnung((d) => {
      for (const line of d.lines) Object.assign(line, { vatCategory: 'K', vatRate: 0 });
      Object.assign(d.buyer, { country: 'AT', vatId: 'ATU12345678' });
      d.vatExemptionReason = 'Tax-free intra-community supply.';
      delete d.totals;
    });
    expect(found(draft)).toEqual(['error lines.0.vatCategory: xrechnung-delivery-address']);
  });

  it('warns about what XRechnung only recommends', () => {
    expect(found(xrechnung((d) => (d.typeCode = '386')))).toEqual(['warning typeCode: xrechnung-type-code']);
    expect(found(xrechnung((d) => (d.seller.phone = 'auf Anfrage')))).toEqual(['warning seller.phone: xrechnung-phone']);
    expect(found(xrechnung((d) => (d.seller.email = 'rechnung@muster')))).toEqual(['warning seller.email: xrechnung-email']);
    expect(
      check(
        xrechnung((d) => (d.typeCode = '386')),
        { rules: 'xrechnung' },
      ).invoice,
    ).toBeDefined();
  });
});
