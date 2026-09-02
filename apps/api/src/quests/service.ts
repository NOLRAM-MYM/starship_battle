/**
 * Lógica de negócio de missões.
 *
 * Converte erros do repository em códigos HTTP-friendly via QuestError.
 */

import {
  abandonQuest as abandonQuestRepo,
  acceptQuest as acceptQuestRepo,
  applyProgress as applyProgressRepo,
  DbUnavailableError,
  findTemplate as findTemplateRepo,
  getInstance as getInstanceRepo,
  InvalidStateError,
  listInstancesForAccount as listInstancesForAccountRepo,
  listTemplates as listTemplatesRepo,
  QuestConflictError,
  QuestNotFoundError,
  upsertTemplate as upsertTemplateRepo,
} from './repository.js';
import type { ProgressEvent, QuestInstance, QuestStatus, QuestTemplate } from './types.js';

export class QuestError extends Error {
  constructor(
    public readonly code:
      | 'db_unavailable'
      | 'template_not_found'
      | 'instance_not_found'
      | 'invalid_state'
      | 'conflict'
      | 'invalid_input',
    message: string,
  ) {
    super(message);
    this.name = 'QuestError';
  }
}

function wrap<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err: unknown) => {
    if (err instanceof DbUnavailableError) {
      throw new QuestError('db_unavailable', 'banco indisponível');
    }
    if (err instanceof QuestNotFoundError) {
      const code = err.code === 'template_not_found' ? 'template_not_found' : 'instance_not_found';
      throw new QuestError(code, err.message);
    }
    if (err instanceof QuestConflictError) {
      throw new QuestError('conflict', err.message);
    }
    if (err instanceof InvalidStateError) {
      throw new QuestError('invalid_state', err.message);
    }
    throw err;
  });
}

export async function listTemplatesService(): Promise<QuestTemplate[]> {
  return wrap(() => listTemplatesRepo());
}

export async function findTemplateService(id: string): Promise<QuestTemplate | null> {
  return wrap(() => findTemplateRepo(id));
}

export async function upsertTemplateService(t: QuestTemplate): Promise<QuestTemplate> {
  return wrap(async () => {
    await upsertTemplateRepo(t);
    return t;
  });
}

export async function acceptQuestService(
  accountId: number,
  templateId: string,
): Promise<QuestInstance> {
  if (!templateId || typeof templateId !== 'string') {
    throw new QuestError('invalid_input', 'templateId inválido');
  }
  return wrap(() => acceptQuestRepo(accountId, templateId));
}

export async function applyProgressService(event: ProgressEvent): Promise<QuestInstance> {
  if (!Number.isInteger(event.amount) || event.amount <= 0) {
    throw new QuestError('invalid_input', 'amount deve ser > 0');
  }
  return wrap(() => applyProgressRepo(event));
}

export async function abandonQuestService(
  accountId: number,
  instanceId: number,
): Promise<void> {
  if (!Number.isInteger(instanceId) || instanceId <= 0) {
    throw new QuestError('invalid_input', 'instanceId inválido');
  }
  return wrap(() => abandonQuestRepo(accountId, instanceId));
}

export async function getInstanceService(instanceId: number): Promise<QuestInstance | null> {
  return wrap(() => getInstanceRepo(instanceId));
}

export async function listInstancesService(
  accountId: number,
  status?: QuestStatus,
): Promise<QuestInstance[]> {
  return wrap(() => listInstancesForAccountRepo(accountId, status));
}
