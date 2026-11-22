import { beforeEach, describe, expect, it } from 'vitest';
import {
  addItem,
  chooseFormat,
  confirm,
  enter,
  fill,
  mark,
  removeItem,
  setExisting,
  setResult,
  startOver,
  state,
  suggest,
} from '../../site/app/state.js';

const file = (mode: 'create' | 'validate' = 'create') => ({
  pdf: new Uint8Array([1]),
  fileName: 'invoice.pdf',
  pdfText: 'Rechnung',
  mode,
});

describe('the state of the page', () => {
  beforeEach(() => startOver(file()));

  it('starts over with another file, with one empty line item and the format chosen before', () => {
    chooseFormat('xrechnung');
    enter('number', 'RE-1');
    mark('number', 'model');
    setResult({ findings: [] });
    startOver({ ...file('validate'), fileName: 'other.pdf' });
    expect(state).toMatchObject({
      fileName: 'other.pdf',
      mode: 'validate',
      format: 'xrechnung',
      draft: { lines: [{}] },
    });
    expect([state.touched.size, state.toCheck.size, state.fileFindings.length, state.result]).toEqual([
      0,
      0,
      0,
      undefined,
    ]);
    chooseFormat('pdf');
  });

  it('takes what the user types, and takes the value and its line item for looked at', () => {
    fill({ lines: [{ name: 'Beratung' }], number: 'RE-1' }, { why: 'model' });
    expect([...state.toCheck.keys()]).toEqual(['lines.0', 'number']);
    enter('lines.0.name', 'Beratung E-Rechnung');
    expect(state.draft.lines).toEqual([{ name: 'Beratung E-Rechnung' }]);
    expect([...state.touched]).toEqual(['lines.0.name']);
    expect([...state.toCheck.keys()]).toEqual(['number']);
    confirm('number');
    expect(state.toCheck.size).toBe(0);
  });

  it('fills in what was read, says which fields, and leaves what the user typed', () => {
    enter('number', 'RE-1');
    expect(fill({ number: 'RE-2', issueDate: '2026-11-03' })).toEqual(['issueDate']);
    expect(fill({ dueDate: '2026-11-17', issueDate: '2026-01-01' }, { onlyEmpty: true, why: 'model' })).toEqual([
      'dueDate',
    ]);
    expect(state.draft).toMatchObject({ number: 'RE-1', issueDate: '2026-11-03', dueDate: '2026-11-17' });
    expect([...state.toCheck]).toEqual([['dueDate', 'model']]);
  });

  it('puts a suggestion into its field, to be confirmed', () => {
    suggest('paymentTerms', 'Zahlbar innerhalb von 14 Tagen.');
    expect(state.draft.paymentTerms).toBe('Zahlbar innerhalb von 14 Tagen.');
    expect(state.toCheck.get('paymentTerms')).toBe('suggested');
  });

  it('adds an item to a list and says where', () => {
    expect(addItem('lines')).toBe(1);
    expect(addItem('charges')).toBe(0);
    expect(state.draft).toMatchObject({ lines: [{}, {}], charges: [{}] });
    expect([...state.touched]).toEqual(['lines.added', 'charges.added']);
  });

  it('removes an item, and moves up what was typed or is to be checked below it', () => {
    addItem('lines');
    addItem('lines');
    enter('lines.0.name', 'A');
    enter('lines.1.name', 'B');
    enter('lines.2.name', 'C');
    mark('lines.1', 'model');
    mark('lines.2.vatCategory', 'inferred');
    removeItem('lines', 1);
    expect(state.draft.lines).toEqual([{ name: 'A' }, { name: 'C' }]);
    expect([...state.toCheck]).toEqual([['lines.1.vatCategory', 'inferred']]);
    expect([...state.touched]).toEqual(['lines.added', 'lines.0.name', 'lines.1.name', 'lines.removed']);
  });

  it('keeps the line items as a list when the last one goes, and leaves discounts out with their last one', () => {
    addItem('discounts');
    removeItem('discounts', 0);
    removeItem('lines', 0);
    expect(state.draft).toEqual({ lines: [] });
  });

  it('holds an existing e-invoice with the verdict on it', () => {
    const finding = { path: '', severity: 'warning' as const, code: 'pdf-a', message: 'Not PDF/A-3.' };
    setExisting({ draft: { number: 'RE-1', lines: [] }, fileFindings: [finding], result: { findings: [] } });
    expect(state).toMatchObject({ draft: { number: 'RE-1' }, fileFindings: [finding], result: { findings: [] } });
    setExisting({ fileFindings: [], result: { findings: [] } });
    expect(state.draft).toEqual({ lines: [{}] });
  });
});
