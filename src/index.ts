import 'dotenv/config';
import express from 'express';
import { FusionSolarAPI } from './fusion-solar-api';
import IConfig, { readConfig } from './interfaces/config';
import { EnergyFlowResult } from './interfaces/fusion-solar-interfaces';
import { getChangedProperties } from './utils';

console.log('App :: Starting');

const app = express();

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
                    id += '_1';
                    break;
                case 'batteryFlow':
                    id += '_2';
                    break;
                case 'batteryChargeLevel':
                    id += '_2';
                    break;
                case 'gridFlow':
                    id += '_3';
                    break;
                case 'houseConsumption':
                    id += '_4';
                    break;
            }

            const payload = {
                id: fs.station,
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

    app.get('/', (req, res) => {
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
        ]);
    });

    app.get('/devices', (req, res) => {
        res.json([
            {
                id: fs.station + '_1',
                name: 'FusionSolar - SolarCells',
            },
            {
                id: fs.station + '_2',
                name: 'FusionSolar - Battery',
            },
            {
                id: fs.station + '_3',
                name: 'FusionSolar - Grid',
            },
            {
                id: fs.station + '_4',
                name: 'FusionSolar - House',
            },
        ]);
    });

    app.get('/energy-flow', (req, res) => {
        res.json(energyFlow);
    });

    app.listen(config.server.port, () => {
        return console.log(`App :: Started (http://*:${config.server.port})`);
    });
}

main().catch((ex) => {
    console.error('App :: fatal error, shutting down... ', ex);
    process.exit(1);
});
