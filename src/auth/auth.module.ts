import { Module, Global } from '@nestjs/common';
import { NoOpAuthGuard } from './noop-auth.guard.js';


@Global()
@Module({
  providers: [
    NoOpAuthGuard,
  ],
  exports: [NoOpAuthGuard],
})
export class AuthModule {}

export type { ProviderIdentityPort, ProviderIdentity } from './provider-identity.port.js';
export { PROVIDER_IDENTITY_PORT } from './provider-identity.port.js';