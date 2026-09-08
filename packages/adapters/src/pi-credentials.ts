import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore,
  OAuthCredential,
} from "@earendil-works/pi-ai";
import type { AgentModelOAuthCredential, ModifyModelOAuthCredential } from "@rakazo/adapter-kit";

export function toOAuthCredential(value: AgentModelOAuthCredential): OAuthCredential {
  return { ...value, type: "oauth" };
}

/**
 * Request-scoped Pi store for one already-authorized provider. Pi's default
 * in-memory store cannot see Rakazo's encrypted database; refreshes are
 * serialized here and published back for encryption.
 */
export class PiRuntimeCredentialStore implements CredentialStore {
  private credential?: Credential;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly providerId: string,
    credential?: Credential,
    private readonly persistOAuth?: (credential: OAuthCredential) => Promise<void>,
    private readonly modifyOAuth?: ModifyModelOAuthCredential,
  ) {
    this.credential = credential;
  }

  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();
    return providerId === this.providerId ? this.credential : undefined;
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted();
    return this.credential ? [{ providerId: this.providerId, type: this.credential.type }] : [];
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    if (providerId !== this.providerId) return Promise.resolve(undefined);
    const previous = this.chain;
    const operation = previous.then(async () => {
      options?.signal?.throwIfAborted();
      if (this.modifyOAuth) {
        const next = await this.modifyOAuth(async (current) => {
          const updated = await fn(toOAuthCredential(current));
          if (updated && updated.type !== "oauth") {
            throw new Error(
              "Subscription credential cannot change authentication type during refresh.",
            );
          }
          return updated;
        }, options?.signal);
        this.credential = toOAuthCredential(next);
        return this.credential;
      }
      const current = this.credential;
      const next = await fn(current);
      options?.signal?.throwIfAborted();
      if (next !== undefined) {
        if (next.type === "oauth" && next !== current) {
          await this.persistOAuth?.(next);
        }
        this.credential = next;
      }
      return this.credential;
    });
    this.chain = operation.catch(() => undefined);
    return operation;
  }

  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    if (providerId !== this.providerId) return Promise.resolve();
    const previous = this.chain;
    const operation = previous.then(() => {
      options?.signal?.throwIfAborted();
      this.credential = undefined;
    });
    this.chain = operation.catch(() => undefined);
    return operation;
  }
}
