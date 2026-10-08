import { Injectable, CanActivate, ExecutionContext, Inject, Optional } from '@nestjs/common';
import { PROVIDER_IDENTITY_PORT } from './provider-identity.port.js';
import type { ProviderIdentityPort, ProviderIdentity } from './provider-identity.port.js';

@Injectable()
export class NoOpAuthGuard implements CanActivate {
  constructor(
    @Optional() @Inject(PROVIDER_IDENTITY_PORT) private readonly providerIdentityPort?: ProviderIdentityPort
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    
    if (this.providerIdentityPort) {
      const token = this.providerIdentityPort.extractTokenFromRequest(request);
      if (token) {
        const identity = await this.providerIdentityPort.validateToken(token);
        if (identity) {
          request.providerIdentity = identity;
          return true;
        }
      }
    }
    
    request.providerIdentity = {
      providerId: 'anonymous',
      claims: {},
    };
    
    return true;
  }
}