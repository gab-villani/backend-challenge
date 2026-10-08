export const PROVIDER_IDENTITY_PORT = Symbol('PROVIDER_IDENTITY_PORT');

export interface ProviderIdentity {
  providerId: string;
  claims: Record<string, unknown>;
}

export interface ProviderIdentityPort {
  validateToken(token: string): Promise<ProviderIdentity | null>;
  extractTokenFromRequest(request: any): string | null;
}