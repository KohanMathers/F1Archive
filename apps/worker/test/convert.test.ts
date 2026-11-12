import { describe, expect, it } from 'vitest';
import { ConversionError, convert, copyField, pgArrayLiteral } from '../src/ingest/convert.js';
import { radioRelPath } from '../src/radio.js';

describe('strict conversion', () => {
  it('keeps nulls null and never turns them into zero', () => {
    expect(convert(null, 'int', 't', 'c')).toBeNull();
    expect(convert(undefined, 'float', 't', 'c')).toBeNull();
    expect(convert('', 'bigint', 't', 'c')).toBeNull();
  });
  it('preserves real zeros', () => {
    expect(convert(0, 'int', 't', 'c')).toBe(0);
    expect(convert(0, 'bool', 't', 'c')).toBe(false);
  });
  it('converts integers from numbers and integer strings', () => {
    expect(convert(92799999999, 'bigint', 't', 'c')).toBe(92799999999);
    expect(convert('44', 'int', 't', 'c')).toBe(44);
    expect(convert(2.0, 'int', 't', 'c')).toBe(2);
  });
  it('refuses lossy integer conversion loudly', () => {
    expect(() => convert(2.5, 'int', 't', 'c')).toThrow(ConversionError);
    expect(() => convert('abc', 'int', 't', 'c')).toThrow(ConversionError);
    expect(() => convert(3_000_000_000, 'int', 't', 'c')).toThrow(ConversionError);
  });
  it('keeps text verbatim, including empty strings', () => {
    expect(convert('', 'text', 't', 'c')).toBe('');
    expect(convert('+11.300', 'text', 't', 'c')).toBe('+11.300');
    expect(convert(33, 'text', 't', 'c')).toBe('33');
  });
  it('parses booleans in the source forms', () => {
    expect(convert(1, 'bool', 't', 'c')).toBe(true);
    expect(convert('True', 'bool', 't', 'c')).toBe(true);
    expect(() => convert(2, 'bool', 't', 'c')).toThrow(ConversionError);
  });
  it('validates JSON and text arrays', () => {
    expect(convert('{"a":1}', 'json', 't', 'c')).toBe('{"a":1}');
    expect(() => convert('{bad', 'json', 't', 'c')).toThrow(ConversionError);
    expect(convert('["red_bull","alpha"]', 'textarray', 't', 'c')).toBe('{"red_bull","alpha"}');
  });
});

describe('COPY encoding', () => {
  it('escapes special characters and nulls', () => {
    expect(copyField(null)).toBe('\\N');
    expect(copyField('a\tb\nc\\d')).toBe('a\\tb\\nc\\\\d');
    expect(copyField(true)).toBe('t');
    expect(copyField(1.5)).toBe('1.5');
  });
  it('builds array literals with quoting', () => {
    expect(pgArrayLiteral(['a"b', 'c\\d'])).toBe('{"a\\"b","c\\\\d"}');
  });
});

describe('radio paths', () => {
  it('mirrors the live timing layout', () => {
    expect(radioRelPath('2021/2021-12-12_Abu_Dhabi_Grand_Prix/2021-12-12_Race/', 'TeamRadio/MAXVER01_33_20211212_174512.mp3')).toBe(
      '2021/2021-12-12_Abu_Dhabi_Grand_Prix/2021-12-12_Race/TeamRadio/MAXVER01_33_20211212_174512.mp3',
    );
  });
  it('never escapes the radio folder', () => {
    expect(radioRelPath('2021/x/', '../../../etc/passwd.mp3')).toBeNull();
    expect(radioRelPath('/abs/', 'a.mp3')).toBeNull();
    expect(radioRelPath('2021/x/', 'TeamRadio/a.wav')).toBeNull();
  });
});
