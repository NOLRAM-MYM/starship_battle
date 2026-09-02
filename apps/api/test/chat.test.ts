/**
 * Testes do módulo chat.
 *
 * Em dev sem Redis/NATS:
 *  - sanitizeText (puro)                                ✓ testável
 *  - dmChannelId (puro)                                 ✓ testável
 *  - subjectFor (puro)                                  ✓ testável
 *  - Endpoints sem auth                                ✓ testável
 *  - Endpoints com auth + Redis indisponível            ✗ esperado 503
 *  - Validação de input (text vazio)                    ✓ testável
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { signToken } from '../src/auth/tokens.js';
import {
  __resetChatStateForTests,
  dmChannelId,
  sanitizeText,
} from '../src/chat/service.js';
import { subjectFor } from '../src/chat/publish.js';
import type { ChatMessage } from '../src/chat/types.js';

describe('chat pure helpers', () => {
  it('sanitizeText removes control chars and trims', () => {
    expect(sanitizeText('  hello  ')).toBe('hello');
    expect(sanitizeText('a\u0000b\u0001c')).toBe('abc');
    expect(sanitizeText('\n\tfoo\n')).toBe('foo');
  });

  it('dmChannelId ordena lexicograficamente', () => {
    expect(dmChannelId(1, 2)).toBe('1:2');
    expect(dmChannelId(2, 1)).toBe('1:2');
    expect(dmChannelId(10, 2)).toBe('2:10');
  });

  it('subjectFor gera subjects corretos', () => {
    const m1: ChatMessage = {
      id: 'a', channelKind: 'global', channelId: 'global',
      accountId: 1, username: 'p', text: 'x', createdAt: 0,
    };
    expect(subjectFor(m1)).toBe('chat.global');

    const m2: ChatMessage = { ...m1, channelKind: 'team', channelId: 'team-1' };
    expect(subjectFor(m2)).toBe('chat.team.team-1');

    const m3: ChatMessage = { ...m1, channelKind: 'clan', channelId: 'clan-1' };
    expect(subjectFor(m3)).toBe('chat.clan.clan-1');

    const m4: ChatMessage = { ...m1, channelKind: 'dm', channelId: '2:10' };
    expect(subjectFor(m4)).toBe('chat.dm.2:10');
  });
});

describe('chat routes (sem Redis/NATS)', () => {
  let app: FastifyInstance;
  const token = signToken({ accountId: 7, username: 'pilot-7' });

  beforeEach(async () => {
    app = await buildServer({ testMode: true });
    await app.ready();
    __resetChatStateForTests();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /chat/global sem auth retorna 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/chat/global' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /chat/global com auth retorna 503 (Redis indisponível)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/chat/global',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
  });

  it('POST /chat/global com auth retorna 503 (Redis indisponível)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/chat/global',
      headers: { authorization: `Bearer ${token}` },
      payload: { text: 'hello' },
    });
    expect(res.statusCode).toBe(503);
  });

  it('POST /chat/global com texto vazio retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/chat/global',
      headers: { authorization: `Bearer ${token}` },
      payload: { text: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /chat/team/:teamId requer auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/chat/team/abc',
      payload: { text: 'hi' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /chat/team/:teamId com auth retorna 503', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/chat/team/abc',
      headers: { authorization: `Bearer ${token}` },
      payload: { text: 'hi' },
    });
    expect(res.statusCode).toBe(503);
  });

  it('POST /chat/dm/:peerId sem auth retorna 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/chat/dm/9',
      payload: { text: 'hi' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /chat/dm/:peerId com peer inválido retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/chat/dm/abc',
      headers: { authorization: `Bearer ${token}` },
      payload: { text: 'hi' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /chat/dm/:peerId consigo mesmo retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/chat/dm/7',
      headers: { authorization: `Bearer ${token}` },
      payload: { text: 'hi' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /chat/dm/:peerId com auth retorna 503', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/chat/dm/9',
      headers: { authorization: `Bearer ${token}` },
      payload: { text: 'hi' },
    });
    expect(res.statusCode).toBe(503);
  });

  it('GET /chat/dm/:peerId com auth retorna 503', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/chat/dm/9',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
  });
});
