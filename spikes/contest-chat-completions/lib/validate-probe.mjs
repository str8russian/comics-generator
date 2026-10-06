import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';

const schemaPath = fileURLToPath(new URL('../fixture/structure-probe.schema.json', import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(schema);

export function validateStructureProbe(value) {
  const schemaValid = validate(value) === true;
  const schemaErrors = schemaValid
    ? []
    : (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`);
  const structural = [];
  if (value && Array.isArray(value.frames)) {
    value.frames.forEach((frame, index) => {
      const expectedId = `F${String(index + 1).padStart(2, '0')}`;
      if (frame?.id !== expectedId) structural.push(`${expectedId} id mismatch`);
      if (frame?.order !== index + 1) structural.push(`${expectedId} order mismatch`);
      const panelCount = Array.isArray(frame?.panels) ? frame.panels.length : 0;
      if (frame?.layout === 'single' && panelCount !== 1) structural.push(`${expectedId} single layout needs one panel`);
      if (frame?.layout === 'split2' && panelCount !== 2) structural.push(`${expectedId} split layout needs two panels`);
      if (frame?.derived === true && frame?.dialogue !== '') structural.push(`${expectedId} derived frame must not add dialogue`);
      if (frame?.derived === false && !String(frame?.dialogue ?? '').trim()) structural.push(`${expectedId} source frame needs dialogue`);
    });
  }
  return {
    schemaValid: schemaValid && structural.length === 0,
    schemaErrors: schemaErrors.concat(structural),
  };
}

export function tryParseJson(text) {
  try {
    return { jsonParsed: true, value: JSON.parse(String(text ?? '').trim()) };
  } catch {
    return { jsonParsed: false, value: null };
  }
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function jsonValuesEqual(actual, expected) {
  return canonicalJson(actual) === canonicalJson(expected);
}
