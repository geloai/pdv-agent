// Thin wrapper around the Claude API: one structured-output call with a disk cache.
//
// - Structured outputs (output_config.format = JSON schema) so every answer is machine-checkable.
// - Server-side refusal fallback ("default" mode) so a classifier false positive doesn't break a run.
// - Responses are cached by request hash in data/ai-cache: re-running the demo costs nothing and
//   works offline once the cache is warm.
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../db.js';

export const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const CACHE_DIR = join(ROOT, 'data', 'ai-cache');

let client;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error('Nema Claude API ključa. Upiši ANTHROPIC_API_KEY u datoteku .env (vidi .env.example).');
  }
  client ??= new Anthropic();
  return client;
}

export class AiRefusalError extends Error {}

/**
 * @param {object} p
 * @param {string} p.task      short name, used for cache file names
 * @param {string} p.system    system prompt
 * @param {Array}  p.content   user message content blocks
 * @param {object} p.schema    JSON schema of the expected answer
 * @param {'low'|'medium'|'high'|'xhigh'|'max'} [p.effort]
 */
export async function askJson({ task, system, content, schema, effort = 'medium' }) {
  const request = {
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort, format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content }],
  };

  const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0, 16);
  const cacheFile = join(CACHE_DIR, `${task}-${hash}.json`);
  // A cache hit costs nothing, so it reports no usage.
  if (existsSync(cacheFile)) return { ...JSON.parse(readFileSync(cacheFile, 'utf8')), usage: null, cached: true };

  const response = await getClient().beta.messages.create(request);
  if (response.stop_reason === 'refusal') {
    throw new AiRefusalError(`Model je odbio zahtjev (${response.stop_details?.category ?? 'nepoznato'})`);
  }
  if (response.stop_reason === 'max_tokens') throw new Error('Odgovor je prekinut (max_tokens).');
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Model nije vratio tekstualni odgovor.');

  const result = { data: JSON.parse(text), model: response.model, usage: response.usage };
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(result, null, 2), 'utf8');
  return { ...result, cached: false };
}

export const pdfBlock = (path) => ({
  type: 'document',
  source: { type: 'base64', media_type: 'application/pdf', data: readFileSync(path).toString('base64') },
});
