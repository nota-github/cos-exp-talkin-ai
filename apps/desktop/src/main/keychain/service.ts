import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const providerSecretIds = ['openai', 'anthropic', 'google'] as const;
export type ProviderSecretId = (typeof providerSecretIds)[number];

export type SecretVaultEntry = {
  service: string;
  account: string;
};

export interface SecretVault {
  get(entry: SecretVaultEntry): Promise<string | null>;
  set(entry: SecretVaultEntry, value: string): Promise<void>;
  delete(entry: SecretVaultEntry): Promise<void>;
}

export interface SecretKeychainClient {
  getGenericPassword(entry: SecretVaultEntry): Promise<string | null>;
  setGenericPassword(entry: SecretVaultEntry, value: string): Promise<void>;
  deleteGenericPassword(entry: SecretVaultEntry): Promise<void>;
}

export interface SecretService {
  getProviderApiKey(provider: ProviderSecretId): Promise<string | null>;
  setProviderApiKey(provider: ProviderSecretId, apiKey: string): Promise<void>;
  deleteProviderApiKey(provider: ProviderSecretId): Promise<void>;
  getLocalEngineCredential(engineId: string): Promise<string | null>;
  setLocalEngineCredential(engineId: string, credential: string): Promise<void>;
  deleteLocalEngineCredential(engineId: string): Promise<void>;
}

export type KeychainCommandResult = {
  stdout: string;
  stderr: string;
};

export type RunKeychainCommand = (args: string[]) => Promise<KeychainCommandResult>;

export type OsKeychainSecretVaultOptions = {
  keychainClient?: SecretKeychainClient;
  platform?: NodeJS.Platform;
  securityCommand?: string;
  runCommand?: RunKeychainCommand;
};

const defaultSecretServiceName = 'talkin-ai.desktop';
const defaultSecurityCommand = '/usr/bin/security';
const macOsItemNotFoundExitCode = 44;

const execFileAsync = promisify(execFile);

function buildEntryKey(entry: SecretVaultEntry) {
  return `${entry.service}:${entry.account}`;
}

function createProviderEntry(serviceName: string, provider: ProviderSecretId): SecretVaultEntry {
  return {
    service: serviceName,
    account: `provider:${provider}`,
  };
}

function createLocalEngineEntry(serviceName: string, engineId: string): SecretVaultEntry {
  return {
    service: serviceName,
    account: `local-engine:${engineId}`,
  };
}

function trimTrailingNewline(value: string) {
  return value.replace(/\r?\n$/, '');
}

function isGenericPasswordNotFound(error: unknown) {
  const keychainError = error as {
    code?: number | string;
    stderr?: string;
    message?: string;
  };
  const detail = `${keychainError.stderr ?? ''}\n${keychainError.message ?? ''}`;

  return (
    keychainError.code === macOsItemNotFoundExitCode ||
    /could not be found in the keychain/i.test(detail)
  );
}

function createSecurityCommandRunner(
  securityCommand: string = defaultSecurityCommand,
): RunKeychainCommand {
  return async (args) => {
    const result = await execFileAsync(securityCommand, args, {
      encoding: 'utf8',
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  };
}

export function createMacOsKeychainClient(
  options: Omit<OsKeychainSecretVaultOptions, 'keychainClient'> = {},
): SecretKeychainClient {
  const platform = options.platform ?? process.platform;

  if (platform !== 'darwin') {
    throw new Error('Talkin AI keychain-backed secrets are currently supported only on macOS.');
  }

  const runCommand =
    options.runCommand ?? createSecurityCommandRunner(options.securityCommand);

  return {
    async getGenericPassword(entry) {
      try {
        const result = await runCommand([
          'find-generic-password',
          '-s',
          entry.service,
          '-a',
          entry.account,
          '-w',
        ]);

        return trimTrailingNewline(result.stdout);
      } catch (error) {
        if (isGenericPasswordNotFound(error)) {
          return null;
        }

        throw new Error(
          `Failed to read keychain secret for ${buildEntryKey(entry)}`,
          {
            cause: error,
          },
        );
      }
    },

    async setGenericPassword(entry, value) {
      try {
        await runCommand([
          'add-generic-password',
          '-U',
          '-s',
          entry.service,
          '-a',
          entry.account,
          '-w',
          value,
        ]);
      } catch (error) {
        throw new Error(
          `Failed to write keychain secret for ${buildEntryKey(entry)}`,
          {
            cause: error,
          },
        );
      }
    },

    async deleteGenericPassword(entry) {
      try {
        await runCommand([
          'delete-generic-password',
          '-s',
          entry.service,
          '-a',
          entry.account,
        ]);
      } catch (error) {
        if (isGenericPasswordNotFound(error)) {
          return;
        }

        throw new Error(
          `Failed to delete keychain secret for ${buildEntryKey(entry)}`,
          {
            cause: error,
          },
        );
      }
    },
  };
}

export function createOsKeychainSecretVault(
  options: OsKeychainSecretVaultOptions,
): SecretVault {
  const keychainClient = options.keychainClient ?? createMacOsKeychainClient(options);

  return {
    async get(entry) {
      return keychainClient.getGenericPassword(entry);
    },

    async set(entry, value) {
      await keychainClient.setGenericPassword(entry, value);
    },

    async delete(entry) {
      await keychainClient.deleteGenericPassword(entry);
    },
  };
}

export function createInMemorySecretVault(): SecretVault {
  const entries = new Map<string, string>();

  return {
    async get(entry) {
      return entries.get(buildEntryKey(entry)) ?? null;
    },

    async set(entry, value) {
      entries.set(buildEntryKey(entry), value);
    },

    async delete(entry) {
      entries.delete(buildEntryKey(entry));
    },
  };
}

export function createSecretService(
  vault: SecretVault,
  serviceName = defaultSecretServiceName,
): SecretService {
  return {
    getProviderApiKey(provider) {
      return vault.get(createProviderEntry(serviceName, provider));
    },

    setProviderApiKey(provider, apiKey) {
      return vault.set(createProviderEntry(serviceName, provider), apiKey);
    },

    deleteProviderApiKey(provider) {
      return vault.delete(createProviderEntry(serviceName, provider));
    },

    getLocalEngineCredential(engineId) {
      return vault.get(createLocalEngineEntry(serviceName, engineId));
    },

    setLocalEngineCredential(engineId, credential) {
      return vault.set(createLocalEngineEntry(serviceName, engineId), credential);
    },

    deleteLocalEngineCredential(engineId) {
      return vault.delete(createLocalEngineEntry(serviceName, engineId));
    },
  };
}

export function createPersistentSecretService(
  options: OsKeychainSecretVaultOptions,
): SecretService {
  return createSecretService(createOsKeychainSecretVault(options));
}
