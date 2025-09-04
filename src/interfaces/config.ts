export default interface IConfig {
    server: IConfigServer;
    fusionSolar: IConfigFusionSolar;
    webhooks: IConfigWebhooks;
}

export interface IConfigServer {
    port: number;
    pollInterval: number;
}

export interface IConfigFusionSolar {
    username: string;
    password: string;
    host: string;
}

export interface IConfigWebhooks {
    energyUpdates: string;
}

export function readConfig(): IConfig {
    return {
        server: {
            port: parseInt(readValue('SERVER_PORT', '3000')),
            pollInterval: parseInt(readValue('SERVER_POLL_INTERVAL', (1 * 60).toString())),
        },
        fusionSolar: {
            username: readValue('FUSIONSOLAR_USERNAME'),
            password: readValue('FUSIONSOLAR_PASSWORD'),
            host: readValue('FUSIONSOLAR_HOST'),
        },
        webhooks: {
            energyUpdates: readValue('WEBHOOK_ENERGY_UPDATES'),
        },
    };
}

function readValue(name: string, defaultValue?: string): string {
    const value = process.env[name];
    if (value) return value;
    if (defaultValue) return defaultValue;
    throw new Error(`config_missing: ${name}`);
}
