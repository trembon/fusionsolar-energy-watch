import 'dotenv/config';
import express from 'express';
import { FusionSolarAPI } from './fusion-solar-api';
import IConfig, { readConfig } from './interfaces/config';
import { EnergyFlowResult } from './interfaces/fusion-solar-interfaces';
import { getChangedProperties } from './utils';

console.log('App :: Starting');

const app = express();
app.use(express.json());

let config: IConfig;
try {
    config = readConfig();
    console.log('App :: Configuration loaded', config);
} catch (ex) {
    console.error('App :: Failed to read configuration variables', ex);
    process.exit();
}

async function main() {
    console.log('FusionSolar :: Authenticating');
    const fs = new FusionSolarAPI(config.fusionSolar.username, config.fusionSolar.password, config.fusionSolar.host);
    const loginResult = await fs.login();
    if (loginResult) {
        console.log('FusionSolar :: Authenticated successfully');
    } else {
        console.error('FusionSolar :: Failed to authenticate');
        process.exit();
    }

    let energyFlow: EnergyFlowResult;
    try {
        energyFlow = await fs.getEnergyFlow();
        if (!energyFlow) {
            throw new Error('Empty energy flow result');
        }
        console.log('FusionSolar :: Initial energy flow loaded');
    } catch (ex) {
        console.error('Verisure :: Failed to fetch initial energy flow', ex);
        process.exit();
    }
    console.log('energy flow result', energyFlow);

    setInterval(async () => {
        console.log('FusionSolar :: Querying for updated energy flow');
        let newEnergyFlow = await fs.getEnergyFlow();
        if (!newEnergyFlow) {
            const renewed = await fs.renewSession();
            if (renewed) {
                console.log('FusionSolar :: Session renewed');
                newEnergyFlow = await fs.getEnergyFlow();
                if (!newEnergyFlow) {
                    console.log('FusionSolar :: Failed to fetch energy flow after renewed session');
                    console.log('App :: Shutting down');
                    process.exit(1);
                }
            } else {
                console.log('FusionSolar :: Failed to renew session');
                console.log('App :: Shutting down');
                process.exit(1);
            }
        }

        var changes = getChangedProperties(energyFlow, newEnergyFlow);
        energyFlow = newEnergyFlow;

        for (const key of changes) {
            let id = fs.station;
            switch (key) {
                case 'solarGeneration':
                    id += '_panels';
                    break;
                case 'batteryFlow':
                    id += '_battery';
                    break;
                case 'batteryChargeLevel':
                    id += '_battery';
                    break;
                case 'gridFlow':
                    id += '_grid';
                    break;
                case 'houseConsumption':
                    id += '_house';
                    break;
            }

            const payload = {
                id: id,
                property: key,
                value: energyFlow[key],
                timestamp: new Date().toISOString(),
            };

            try {
                const response = await fetch(config.webhooks.energyUpdates, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                });

                if (!response.ok) {
                    throw new Error(`request failed: ${response.status} ${response.statusText}`);
                }
                console.log('App :: Webhook sent successfully', config.webhooks.energyUpdates, payload);
            } catch (error) {
                console.error('App :: Error sending webhook:', error);
            }
        }

        console.log('App :: update processed', changes);
    }, config.server.pollInterval * 1000);

    app.get('/', (_req, res) => {
        res.json([
            {
                url: '/devices',
                method: 'GET',
                info: 'List of devices',
            },
            {
                url: '/energy-flow',
                method: 'GET',
                info: 'List current energy flow',
            },
            {
                url: '/set-config-signals',
                method: 'POST',
                info: 'Sets the payload as configuration for the battery',
            },
        ]);
    });

    app.get('/devices', (_req, res) => {
        res.json([
            {
                id: fs.station + '_panels',
                name: 'FusionSolar - SolarCells',
            },
            {
                id: fs.station + '_battery',
                name: 'FusionSolar - Battery',
            },
            {
                id: fs.station + '_grid',
                name: 'FusionSolar - Grid',
            },
            {
                id: fs.station + '_house',
                name: 'FusionSolar - House',
            },
        ]);
    });

    app.get('/energy-flow', (_req, res) => {
        res.json(energyFlow);
    });

    app.post('/set-config-signals', async (req, res) => {
        console.log('/set-config-signals', req.body);
        const result = await fs.setConfigSignals(req.body);
        res.json(result);
    });

    app.listen(config.server.port, () => {
        return console.log(`App :: Started (http://*:${config.server.port})`);
    });
}

main().catch((ex) => {
    console.error('App :: fatal error, shutting down... ', ex);
    process.exit(1);
});
