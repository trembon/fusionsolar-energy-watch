import 'dotenv/config';
import express from 'express';
import { FusionSolarAPI } from './fusion-solar-api';
import IConfig, { readConfig } from './interfaces/config';
import { EnergyFlowResult } from './interfaces/fusion-solar-interfaces';

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
        //var changes = detectUpdates(state, newState);
        energyFlow = newEnergyFlow;

        //console.log('App :: update processed', changes);
    }, config.server.pollInterval * 1000);

    app.get('/', (req, res) => {
        res.json([
            {
                url: '/energy-flow',
                method: 'GET',
                info: 'List current energy flow',
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
