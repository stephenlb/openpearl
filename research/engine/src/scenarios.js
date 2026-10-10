// Benchmark scenario loader. Reads scenarios/scenarios.json and validates each entry.
// latencySpikes and corruptStateRate are reserved for a follow-up; simulate() currently consumes only failRate.
import { readFileSync } from 'node:fs';

export const SCENARIOS_PATH = new URL('../scenarios/scenarios.json', import.meta.url);

const isRate = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

export function validateScenario(s) {
  if (s === null || typeof s !== 'object' || Array.isArray(s)) throw new Error('scenario must be an object');
  if (typeof s.name !== 'string' || s.name === '') throw new Error('scenario name must be a non-empty string');
  const id = `scenario "${s.name}"`;
  if (s.description !== undefined && typeof s.description !== 'string') throw new Error(`${id}: description must be a string`);
  if (!isRate(s.failRate)) throw new Error(`${id}: failRate must be a number in [0, 1]`);
  const sp = s.latencySpikes;
  if (sp === null || typeof sp !== 'object') throw new Error(`${id}: latencySpikes must be an object`);
  if (!isRate(sp.probability)) throw new Error(`${id}: latencySpikes.probability must be a number in [0, 1]`);
  if (typeof sp.ms !== 'number' || !Number.isFinite(sp.ms) || sp.ms < 0) throw new Error(`${id}: latencySpikes.ms must be a non-negative number`);
  if (!isRate(s.corruptStateRate)) throw new Error(`${id}: corruptStateRate must be a number in [0, 1]`);
  return s;
}

export function validateScenarios(list) {
  if (!Array.isArray(list) || list.length === 0) throw new Error('scenarios must be a non-empty array');
  const seen = new Set();
  for (const s of list) {
    validateScenario(s);
    if (seen.has(s.name)) throw new Error(`duplicate scenario name: ${s.name}`);
    seen.add(s.name);
  }
  return list;
}

export function loadScenarios(path = SCENARIOS_PATH) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  return validateScenarios(data?.scenarios);
}

export function getScenario(name, scenarios = loadScenarios()) {
  const found = scenarios.find((s) => s.name === name);
  if (!found) throw new Error(`Unknown scenario: ${name}`);
  return found;
}
