// Dev utility: lists stored subscriptions so you can verify writes locally.
// Usage (from the api/ folder):  node list-subscriptions.js
const fs = require('node:fs');
const path = require('node:path');
const { CosmosClient } = require('@azure/cosmos');

function loadLocalSettings() {
    const file = path.join(__dirname, 'local.settings.json');
    if (!fs.existsSync(file)) return;
    const { Values } = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(Values || {})) {
        if (!process.env[key]) process.env[key] = value;
    }
}

async function main() {
    loadLocalSettings();

    const endpoint = process.env.COSMOS_ENDPOINT;
    const key = process.env.COSMOS_KEY;
    if (!endpoint || !key) {
        throw new Error('COSMOS_ENDPOINT and COSMOS_KEY must be set (check api/local.settings.json).');
    }

    const container = new CosmosClient({ endpoint, key })
        .database(process.env.COSMOS_DATABASE || 'spotify-web')
        .container(process.env.COSMOS_CONTAINER || 'subscriptions');

    const { resources } = await container.items
        .query(
            'SELECT c.id, c.firstName, c.lastName, c.email, c.plan, c.price, ' +
            'c.cardBrand, c.cardLast4, c.cardExpiryMonth, c.cardExpiryYear, c.createdAt FROM c'
        )
        .fetchAll();

    console.log(`\n${resources.length} subscription(s) found:\n`);
    console.table(resources);
}

main().catch((err) => {
    console.error('Query failed:', err.message);
    process.exit(1);
});
