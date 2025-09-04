import 'dotenv/config';
import { FusionSolarAPI } from './FusionSolarAPI';

function env(name: string, fallback?: string): string {
    const v = process.env[name] ?? fallback;
    if (v === undefined || v === '') throw new Error(`Missing env ${name}`);
    return v;
}

const stop = () => {
    console.log('Shutting down...');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

async function main() {
    const host = env('FUSIONSOLAR_HOST');
    const username = env('FUSIONSOLAR_USERNAME');
    const password = env('FUSIONSOLAR_PASSWORD');
    //const pollSec = parseInt(process.env.POLL_INTERVAL_SEC || '60', 10);

    const fs = new FusionSolarAPI(username, password, host);
    const loginResult = await fs.login();

    console.log('loginResult:', loginResult);

    if (loginResult) {
        const deviceResult = await fs.getDevices();
        console.log('deviceResult', deviceResult);
    }
}

main().catch((e) => {
    console.error('fatal error, shutting down: ', e);
    process.exit(1);
});
