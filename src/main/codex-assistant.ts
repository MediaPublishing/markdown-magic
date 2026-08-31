import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

type JsonRpcMessage = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
};

type CodexAccount = {
  type?: string;
  email?: string | null;
  planType?: string | null;
};

export type AssistantProviderStatus = {
  kind: 'chatgpt' | 'offline';
  connected: boolean;
  label: string;
  detail: string;
};

export type CodexAssistantDraft = {
  action: 'answer' | 'propose_edit';
  reply: string;
  summary: string | null;
  markdown: string | null;
};

export type CodexAssistantHistoryMessage = { role: 'user' | 'assistant'; text: string };

type ProcessFactory = typeof spawn;

export type CodexAssistantOptions = {
  binary?: string;
  cwd?: string;
  timeoutMs?: number;
  model?: string;
  spawnImpl?: ProcessFactory;
  forceStatusRefresh?: boolean;
};

const DEFAULT_TIMEOUT_MS = 90_000;
const STATUS_CACHE_MS = 30_000;
export const MAX_ASSISTANT_DOCUMENT_LENGTH = 350_000;
let cachedDefaultStatus: { expiresAt: number; value: AssistantProviderStatus } | null = null;

export async function getCodexAssistantStatus(options: CodexAssistantOptions = {}): Promise<AssistantProviderStatus> {
  if (process.env.MARKDOWN_MAGIC_ASSISTANT_MODE === 'local') {
    return { kind: 'offline', connected: false, label: 'Lokaler Assistent', detail: 'ChatGPT ist für diese Sitzung deaktiviert.' };
  }
  const cacheable = !options.binary && !options.cwd && !options.model && !options.spawnImpl;
  if (cacheable && !options.forceStatusRefresh && cachedDefaultStatus && cachedDefaultStatus.expiresAt > Date.now()) {
    return cachedDefaultStatus.value;
  }
  let status: AssistantProviderStatus;
  try {
    const account = await withCodexAppServer(options, async (session) => {
      const result = await session.request(2, 'account/read', { refreshToken: false });
      return (result as { account?: CodexAccount | null }).account ?? null;
    });
    if (account?.type === 'chatgpt') {
      const plan = account.planType ? ` · ${account.planType}` : '';
      status = { kind: 'chatgpt', connected: true, label: 'ChatGPT-Abo erkannt', detail: `Über lokalen Codex App Server${plan}` };
    } else {
      status = { kind: 'offline', connected: false, label: 'Lokaler Assistent', detail: 'ChatGPT ist in Codex nicht angemeldet.' };
    }
  } catch {
    status = { kind: 'offline', connected: false, label: 'Lokaler Assistent', detail: 'Codex App Server ist auf diesem Mac nicht verfügbar.' };
  }
  if (cacheable) cachedDefaultStatus = { value: status, expiresAt: Date.now() + STATUS_CACHE_MS };
  return status;
}

export async function createCodexAssistantDraft(
  prompt: string,
  markdown: string,
  documentTitle: string,
  history: CodexAssistantHistoryMessage[] = [],
  options: CodexAssistantOptions = {},
): Promise<CodexAssistantDraft> {
  if (markdown.length > MAX_ASSISTANT_DOCUMENT_LENGTH) throw new Error('Das Dokument ist für den ChatGPT-Assistenten zu gross.');
  return withCodexAppServer(options, async (session) => {
    const accountResponse = await session.request(2, 'account/read', { refreshToken: false });
    const account = (accountResponse as { account?: CodexAccount | null }).account;
    if (account?.type !== 'chatgpt') throw new Error('ChatGPT ist in Codex nicht angemeldet.');

    const threadResponse = await session.request(3, 'thread/start', {
      cwd: options.cwd ?? os.tmpdir(),
      runtimeWorkspaceRoots: [],
      environments: [],
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
      developerInstructions: 'Du bist der Dokumentassistent von Markdown Magic. Nutze keine Tools, lies keine Dateien und ändere keine Dateien. Arbeite ausschliesslich mit dem übergebenen Dokument und Gespräch. Antworte knapp und hilfreich. Erzeuge nur dann einen Änderungsvorschlag, wenn der Nutzer das Dokument ausdrücklich ändern, umschreiben, übersetzen, einfügen oder formatieren will.',
    }) as { thread?: { id?: string } };
    const threadId = threadResponse.thread?.id;
    if (!threadId) throw new Error('Codex konnte keine Assistenten-Sitzung starten.');

    const result = await session.request(4, 'turn/start', {
      threadId,
      environments: [],
      approvalPolicy: 'never',
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'reply', 'summary', 'markdown'],
        properties: {
          action: { type: 'string', enum: ['answer', 'propose_edit'] },
          reply: { type: 'string', minLength: 1, maxLength: 4000 },
          summary: { type: ['string', 'null'], maxLength: 320 },
          markdown: { type: ['string', 'null'] },
        },
      },
      input: [{
        type: 'text',
        text_elements: [],
        text: [
          'Führe das Gespräch über dieses Dokument fort.',
          'Gib exakt ein JSON-Objekt mit action, reply, summary und markdown zurück.',
          'Bei einer Frage, Analyse oder Zusammenfassung ohne ausdrücklichen Änderungswunsch: action="answer", summary=null, markdown=null.',
          'Bei einem ausdrücklichen Änderungswunsch: action="propose_edit", eine kurze summary und das vollständige neue Dokument in markdown.',
          'Keine Erklärungen ausserhalb des JSON. Keine Tools verwenden.',
          `Dokumenttitel: ${documentTitle}`,
          `Bisheriges Gespräch: ${JSON.stringify(history.slice(-12))}`,
          `Nutzerauftrag: ${prompt}`,
          'Dokumentinhalt folgt:',
          markdown,
        ].join('\n\n'),
      }],
    });
    return parseAssistantDraft(result, session.agentMessages.join(''));
  });
}

function resolveCodexBinary(explicitBinary?: string): string {
  if (explicitBinary) return explicitBinary;
  const localBinary = path.join(os.homedir(), '.local', 'bin', 'codex');
  return existsSync(localBinary) ? localBinary : 'codex';
}

async function withCodexAppServer<T>(options: CodexAssistantOptions, run: (session: CodexSession) => Promise<T>): Promise<T> {
  const spawnImpl = options.spawnImpl ?? spawn;
  const child = spawnImpl(resolveCodexBinary(options.binary), [
    '-c', 'openai_base_url="https://chatgpt.com/backend-api/codex"',
    '-c', `model="${options.model ?? 'gpt-5.6-terra'}"`,
    'app-server',
  ], {
    cwd: options.cwd ?? os.tmpdir(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (!child.stdin || !child.stdout || !child.stderr) throw new Error('Codex App Server konnte nicht gestartet werden.');

  return new Promise<T>((resolve, reject) => {
    const lines = readline.createInterface({ input: child.stdout });
    const responses = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    const agentMessages: string[] = [];
    let initialized = false;
    let settled = false;
    let stderr = '';
    const finish = (error?: Error, value?: T): void => {
      if (settled) return;
      settled = true;
      windowClearTimeout(timer);
      lines.close();
      responses.forEach(({ reject: rejectRequest }) => rejectRequest(error ?? new Error('Codex App Server wurde beendet.')));
      if (!child.killed) child.kill();
      if (error) reject(error);
      else resolve(value as T);
    };
    const timer = setTimeout(() => finish(new Error('ChatGPT-Assistent hat nicht rechtzeitig geantwortet.')), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', () => finish(new Error('Codex App Server konnte nicht gestartet werden.')));
    child.once('exit', (code) => {
      if (!settled) finish(new Error(`Codex App Server wurde beendet (${code ?? 'Signal'}).${stderr ? ` ${stderr.trim()}` : ''}`));
    });

    const send = (message: JsonRpcMessage): void => {
      child.stdin?.write(`${JSON.stringify(message)}\n`);
    };
    const session: CodexSession = {
      request: (id, method, params) => new Promise((resolveRequest, rejectRequest) => {
        responses.set(id, { resolve: resolveRequest, reject: rejectRequest });
        send({ id, method, params });
      }),
      agentMessages,
    };
    lines.on('line', (line) => {
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line) as JsonRpcMessage;
      } catch {
        return;
      }
      if (message.method === 'item/agentMessage/delta') {
        const delta = (message.params as { delta?: unknown } | undefined)?.delta;
        if (typeof delta === 'string') agentMessages.push(delta);
        return;
      }
      if (message.method === 'turn/completed') {
        const params = message.params as { turn?: unknown } | undefined;
        const pending = responses.get(4);
        if (pending) {
          responses.delete(4);
          pending.resolve(params?.turn ?? { items: [] });
        }
        return;
      }
      if (typeof message.id !== 'number') return;
      if (message.id === 1 && !initialized) {
        initialized = true;
        if (message.error) return finish(new Error(message.error.message ?? 'Codex App Server konnte nicht initialisiert werden.'));
        send({ method: 'initialized', params: {} });
        run(session).then((value) => finish(undefined, value)).catch((error: unknown) => finish(error instanceof Error ? error : new Error('ChatGPT-Assistent fehlgeschlagen.')));
        return;
      }
      const pending = responses.get(message.id);
      if (!pending) return;
      // turn/start acknowledges the request before the final assistant message arrives.
      // Keep its promise pending until the turn/completed notification below.
      if (message.id === 4 && !message.error) return;
      responses.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? 'Codex App Server Anfrage fehlgeschlagen.'));
      else pending.resolve(message.result);
    });
    send({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'markdown_magic', title: 'Markdown Magic', version: '0.1.4' },
        capabilities: { experimentalApi: true },
      },
    });
  });
}

type CodexSession = {
  request(id: number, method: string, params: unknown): Promise<unknown>;
  agentMessages: string[];
};

function parseAssistantDraft(turn: unknown, streamedMessage = ''): CodexAssistantDraft {
  const items = (turn as { items?: unknown[] } | null)?.items ?? [];
  const finalMessage = items.findLast((item) => (item as { type?: unknown }).type === 'agentMessage') as { text?: unknown } | undefined;
  const raw = typeof finalMessage?.text === 'string' ? finalMessage.text : streamedMessage;
  const json = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('ChatGPT lieferte keinen gültigen Änderungsvorschlag.');
  }
  const draft = value as Partial<CodexAssistantDraft>;
  if ((draft.action !== 'answer' && draft.action !== 'propose_edit') || typeof draft.reply !== 'string' || !draft.reply.trim()) {
    throw new Error('ChatGPT lieferte keine gültige Antwort.');
  }
  if (draft.action === 'propose_edit' && (typeof draft.summary !== 'string' || !draft.summary.trim() || typeof draft.markdown !== 'string')) {
    throw new Error('ChatGPT lieferte einen unvollständigen Änderungsvorschlag.');
  }
  return {
    action: draft.action,
    reply: draft.reply.trim(),
    summary: typeof draft.summary === 'string' ? draft.summary.trim() : null,
    markdown: typeof draft.markdown === 'string' ? draft.markdown : null,
  };
}

function windowClearTimeout(timer: ReturnType<typeof setTimeout>): void {
  clearTimeout(timer);
}
