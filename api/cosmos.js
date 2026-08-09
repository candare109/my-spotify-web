'use strict';

const { CosmosClient } = require('@azure/cosmos');

const DATABASE_ID = process.env.COSMOS_DATABASE || 'spotify-web';
const CONTAINER_ID = process.env.COSMOS_CONTAINER || 'subscriptions';

let containerPromise;

function createClient() {
  const connectionString = process.env.COSMOS_CONNECTION_STRING;
  if (connectionString) {
    return new CosmosClient(connectionString);
  }

  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;
  if (!endpoint || !key) {
    throw new Error(
      'Cosmos DB is not configured. Set COSMOS_CONNECTION_STRING, or COSMOS_ENDPOINT and COSMOS_KEY.'
    );
  }
  return new CosmosClient({ endpoint, key });
}

/**
 * Resolves the container, creating the database/container on first use.
 * The promise is cached so warm invocations skip the setup round-trips; a
 * failure clears the cache so the next request can retry.
 */
function getContainer() {
  if (!containerPromise) {
    containerPromise = (async () => {
      const client = createClient();
      const { database } = await client.databases.createIfNotExists({ id: DATABASE_ID });
      const { container } = await database.containers.createIfNotExists({
        id: CONTAINER_ID,
        partitionKey: { paths: ['/email'] },
      });
      return container;
    })().catch((error) => {
      containerPromise = undefined;
      throw error;
    });
  }
  return containerPromise;
}

async function findSubscription(email, plan) {
  const container = await getContainer();
  const { resources } = await container.items
    .query(
      {
        query: 'SELECT TOP 1 * FROM c WHERE c.email = @email AND c.plan = @plan',
        parameters: [
          { name: '@email', value: email },
          { name: '@plan', value: plan },
        ],
      },
      { partitionKey: email }
    )
    .fetchAll();

  return resources[0];
}

async function createSubscription(record) {
  const container = await getContainer();
  const { resource } = await container.items.create(record);
  return resource;
}

module.exports = {
  getContainer,
  findSubscription,
  createSubscription,
  DATABASE_ID,
  CONTAINER_ID,
};
