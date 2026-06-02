/**
 * Custom resource Lambda handler for creating an Amazon Connect Health domain.
 *
 * On Create: Creates a Connect Health domain with the specified name.
 * On Update: No-op (domain name cannot be changed).
 * On Delete: No-op (domains are retained for audit purposes).
 */

import {
  ConnectHealthClient,
  CreateDomainCommand,
  ListDomainsCommand,
} from '@aws-sdk/client-connecthealth';

interface Event {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResourceProperties: {
    DomainName: string;
    Region: string;
  };
}

interface Response {
  PhysicalResourceId: string;
  Data: {
    DomainId: string;
    DomainName: string;
  };
}

export async function handler(event: Event): Promise<Response> {
  const { DomainName, Region } = event.ResourceProperties;

  console.log(`Connect Health Domain handler: ${event.RequestType} for domain "${DomainName}" in ${Region}`);

  if (event.RequestType === 'Delete') {
    // Don't delete domains — they're retained for audit
    return {
      PhysicalResourceId: DomainName,
      Data: { DomainId: '', DomainName },
    };
  }

  // For Create and Update, ensure the domain exists
  const client = new ConnectHealthClient({ region: Region });

  // Check if domain already exists
  try {
    const listResponse = await client.send(new ListDomainsCommand({}));
    const existing = listResponse.domains?.find((d) => d.name === DomainName);

    if (existing) {
      console.log(`Domain "${DomainName}" already exists with ID: ${existing.domainId}`);
      return {
        PhysicalResourceId: existing.domainId || DomainName,
        Data: {
          DomainId: existing.domainId || '',
          DomainName,
        },
      };
    }
  } catch (err) {
    console.log('ListDomains failed, attempting create:', err);
  }

  // Create the domain
  try {
    const createResponse = await client.send(new CreateDomainCommand({
      name: DomainName,
    }));

    const domainId = createResponse.domainId || '';
    console.log(`Created domain "${DomainName}" with ID: ${domainId}`);

    return {
      PhysicalResourceId: domainId || DomainName,
      Data: {
        DomainId: domainId,
        DomainName,
      },
    };
  } catch (err: any) {
    // If domain already exists (race condition), that's fine
    if (err.name === 'ResourceInUseException' || err.name === 'ConflictException') {
      console.log(`Domain "${DomainName}" already exists (conflict). Listing to get ID...`);
      const listResponse = await client.send(new ListDomainsCommand({}));
      const existing = listResponse.domains?.find((d) => d.name === DomainName);
      return {
        PhysicalResourceId: existing?.domainId || DomainName,
        Data: {
          DomainId: existing?.domainId || '',
          DomainName,
        },
      };
    }
    throw err;
  }
}
