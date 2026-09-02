import { getRedis } from '../db/redis.js';

export class LeaderboardError extends Error {
  constructor(public code: 'redis_unavailable' | 'invalid_input', message: string) {
    super(message);
    this.name = 'LeaderboardError';
  }
}

export async function submitScore(boardId: string, accountId: number, score: number): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    throw new LeaderboardError('redis_unavailable', 'Redis is unavailable');
  }
  
  if (score < 0) {
    throw new LeaderboardError('invalid_input', 'Score cannot be negative');
  }

  const key = `leaderboard:${boardId}`;
  await redis.zadd(key, score, accountId.toString());
}

export interface LeaderboardEntry {
  accountId: number;
  score: number;
  rank: number;
}

export async function getLeaderboard(boardId: string, limit: number = 100): Promise<LeaderboardEntry[]> {
  const redis = getRedis();
  if (!redis) {
    throw new LeaderboardError('redis_unavailable', 'Redis is unavailable');
  }

  const key = `leaderboard:${boardId}`;
  // Fetch top 'limit' accounts with their scores
  // ZREVRANGE returns array like: [ 'accountId1', 'score1', 'accountId2', 'score2', ... ]
  const data = await redis.zrevrange(key, 0, limit - 1, 'WITHSCORES');
  
  const results: LeaderboardEntry[] = [];
  for (let i = 0; i < data.length; i += 2) {
    // ZREVRANGE WITHSCORES devolve pares; um par truncado significa
    // resposta parcial do Redis, e aí paramos em vez de gerar NaN.
    const rawId = data[i];
    const rawScore = data[i + 1];
    if (rawId === undefined || rawScore === undefined) break;
    const accountId = Number.parseInt(rawId, 10);
    const score = Number.parseFloat(rawScore);
    const rank = i / 2 + 1;
    results.push({ accountId, score, rank });
  }

  return results;
}

export async function getPlayerRank(boardId: string, accountId: number): Promise<{ rank: number | null, score: number | null }> {
  const redis = getRedis();
  if (!redis) {
    throw new LeaderboardError('redis_unavailable', 'Redis is unavailable');
  }

  const key = `leaderboard:${boardId}`;
  const rankZeroBased = await redis.zrevrank(key, accountId.toString());
  if (rankZeroBased === null) {
    return { rank: null, score: null };
  }

  const scoreStr = await redis.zscore(key, accountId.toString());
  const score = scoreStr ? Number.parseFloat(scoreStr) : null;

  return {
    rank: rankZeroBased + 1,
    score
  };
}
