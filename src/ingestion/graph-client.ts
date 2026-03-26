import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js';
import { ClientSecretCredential } from '@azure/identity';

export interface GraphClientOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  scopes?: string[];
}

export function createGraphClient(options: GraphClientOptions): Client {
  const credential = new ClientSecretCredential(
    options.tenantId,
    options.clientId,
    options.clientSecret,
  );

  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: options.scopes ?? ['https://graph.microsoft.com/.default'],
  });

  return Client.initWithMiddleware({ authProvider });
}
