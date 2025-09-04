// FusionSolarAPI.ts
import axios, { AxiosResponse } from 'axios';
import { URL } from 'url'; // Node.js built-in
import { format } from 'date-fns'; // For date formatting
import { encryptPassword, generateNonce } from './secrets';
import { json } from 'stream/consumers';

// --- Enums ---
export enum DeviceType {
    SENSOR_KW = 'sensor',
    SENSOR_KWH = 'sensor_kwh',
    SENSOR_PERCENTAGE = 'sensor_percentage',
    SENSOR_TIME = 'sensor_time',
}

export enum ENERGY_BALANCE_CALL_TYPE {
    DAY = '2',
    PREVIOUS_MONTH = '3',
    MONTH = '4',
    YEAR = '5',
    LIFETIME = '6',
}

// --- Device type ---
export interface Device {
    device_id: string;
    device_unique_id: string;
    device_type: DeviceType;
    name: string;
    state: number | string | Date;
    icon: string;
}

// --- Example Devices List (port of DEVICES in Python) ---
export const DEVICES: Array<{ id: string; type: DeviceType; icon: string }> = [
    {
        id: 'House Load Power',
        type: DeviceType.SENSOR_KW,
        icon: 'mdi:home-lightning-bolt-outline',
    },
    {
        id: 'House Load Today',
        type: DeviceType.SENSOR_KWH,
        icon: 'mdi:home-lightning-bolt-outline',
    },
    // ... add the rest from Python here
];

// --- Main FusionSolarAPI class ---
export class FusionSolarAPI {
    private user: string;
    private pwd: string;
    private login_host: string;

    private station: string | null = null;
    private battery_capacity: number | null = null;
    private data_host: string | null = null;
    private dp_session: string = '';
    private connected: boolean = false;
    private last_session_time: Date | null = null;
    private csrf: string | null = null;
    private csrf_time: Date | null = null;

    private sessionMonitor: NodeJS.Timeout | null = null;

    constructor(user: string, pwd: string, login_host: string) {
        this.user = user;
        this.pwd = pwd;
        this.login_host = login_host;
    }

    async login(): Promise<boolean> {
        const publicKeyUrl = `https://${this.login_host}/unisso/pubkey`;
        console.debug(`Getting Public Key at: ${publicKeyUrl}`);

        let response: AxiosResponse;
        try {
            response = await axios.get(publicKeyUrl);
        } catch (err) {
            console.error('Error fetching public key:', err);
            this.connected = false;
            return false;
        }

        const pubkeyData = response.data;
        console.debug('Pubkey Response:', pubkeyData);

        const pubKeyPem = pubkeyData.pubKey;
        const timeStamp = pubkeyData.timeStamp;
        const version = pubkeyData.version;

        const nonce = generateNonce();
        const encryptedPassword = encryptPassword(pubKeyPem, this.pwd) + version;

        const loginUrl = `https://${this.login_host}/unisso/v3/validateUser.action?timeStamp=${timeStamp}&nonce=${nonce}`;
        const payload: Record<string, string> = {
            organizationName: '',
            password: encryptedPassword,
            username: this.user,
        };

        try {
            const loginResp = await axios.post(loginUrl, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'accept-encoding': 'gzip, deflate, br, zstd',
                    connection: 'keep-alive',
                    host: this.login_host,
                    'x-requested-with': 'XMLHttpRequest',
                    origin: `https://${this.login_host}`,
                    referer: `https://${this.login_host}/unisso/login.action`,
                },
            });

            console.debug('Login Response:', loginResp.status, loginResp.data, loginResp.headers);

            if (loginResp.status === 200) {
                console.log('connected');
                let redirect_url = '';
                if (loginResp.data.respMultiRegionName) {
                    redirect_url = `https://${this.login_host}${loginResp.data.respMultiRegionName[1]}`;
                } else if (loginResp.data.redirectURL) {
                    redirect_url = `https://${this.login_host}${loginResp.data.redirectURL}`;
                } else {
                    this.connected = false;
                    return false;
                }

                console.log('Redirect URL:', redirect_url);

                const redirectAuthResp = await fetch(redirect_url, {
                    redirect: 'manual',
                    headers: {
                        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                        'accept-encoding': 'gzip, deflate, br, zstd',
                        connection: 'keep-alive',
                        host: this.login_host,
                        referer: `https://${this.login_host}/pvmswebsite/loginCustomize.html`,
                    },
                });

                console.log('redirectAuthResp response:', redirectAuthResp.status, redirectAuthResp.headers);

                console.log('data host pre:', redirectAuthResp.headers.get('location'));
                this.data_host = new URL(redirectAuthResp.headers.get('location')).host;

                console.log('data host:', this.data_host);
                if (redirectAuthResp.status === 200 || redirectAuthResp.status === 302) {
                    const cookies: string[] = redirectAuthResp.headers.getSetCookie();
                    if (cookies && cookies.length > 0) {
                        console.log('cookies found!', cookies);
                        let dpSession = undefined;
                        cookies[0].split(';').forEach((x) => {
                            if (x.startsWith('dp-session=')) {
                                dpSession = x.split('=')[1];
                            }
                        });

                        if (dpSession) {
                            console.log('dp session found!', dpSession);
                            this.connected = true;
                            this.dp_session = dpSession;
                            this.last_session_time = new Date();
                            await this.refreshCsrf();
                            var stationList = await this.getStationList();
                            console.log('station list', JSON.stringify(stationList.data.list[0]));
                            this.station = stationList.data.list[0].dn;

                            if (!this.battery_capacity || this.battery_capacity == 0) {
                                this.battery_capacity = stationList.data.list[0].batteryCapacity;
                            }

                            this.connected = true;
                            return true;
                        } else {
                            console.log('dp session not found in cookie');
                        }
                    } else {
                        console.log('cookies in redirect response was not found');
                    }
                } else {
                    console.log('invalid response status from auth redirect', redirectAuthResp.status);
                }
            } else {
                console.log('invalid login');
            }
        } catch (err) {
            console.error('Login failed:', err);
        }

        this.connected = false;
        return false;
    }

    logout(): boolean {
        this.connected = false;
        this.stopSessionMonitor();
        return true;
    }

    private renewSession(): void {
        console.info('Renewing session...');
        this.connected = false;
        this.dp_session = '';
        this.login();
    }

    private startSessionMonitor(): void {
        /*if (this.sessionMonitor) return; // already running
    this.sessionMonitor = setInterval(() => {
      if (!this.connected) {
        this.renewSession();
      }
    }, 60_000); // every 60 seconds*/
    }

    private stopSessionMonitor(): void {
        if (this.sessionMonitor) {
            clearInterval(this.sessionMonitor);
            this.sessionMonitor = null;
        }
    }

    private async refreshCsrf(): Promise<void> {
        if (
            this.csrf === null ||
            (this.csrf_time !== null && new Date().getTime() - this.csrf_time.getTime() > 5 * 60 * 1000)
        ) {
            const roarandUrl = `https://${this.data_host}/rest/dpcloud/auth/v1/keep-alive`;
            const roarandCookies = {
                locale: 'en-us',
                'dp-session': this.dp_session,
            };
            const roarandHeaders = {
                accept: 'application/json, text/plain, */*',
                'accept-encoding': 'gzip, deflate, br, zstd',
                Referer: `https://${this.data_host}/uniportal/pvmswebsite/assets/build/cloud.html`,
                Cookie: Object.entries(roarandCookies)
                    .map(([key, value]) => `${key}=${value}`)
                    .join('; '),
            };
            const roarandParams = {};

            console.log(`Getting Roarand at: ${roarandUrl}`);
            const roarandResponse = await axios.get(roarandUrl, {
                headers: roarandHeaders,
                withCredentials: true,
                params: roarandParams,
            });
            this.csrf = roarandResponse.data.payload;
            this.csrf_time = new Date();
            console.log(`CSRF refreshed: ${this.csrf}`);
        }
    }

    async getStationList(): Promise<any> {
        this.refreshCsrf();

        const stationUrl = `https://${this.data_host}/rest/pvms/web/station/v1/station/station-list`;

        const stationCookies = {
            locale: 'en-us',
            'dp-session': this.dp_session,
        };

        const stationHeaders = {
            accept: 'application/json, text/javascript, */*; q=0.01',
            'accept-encoding': 'gzip, deflate, br, zstd',
            'Content-Type': 'application/json',
            Origin: `https://${this.data_host}`,
            Referer: `https://${this.data_host}/uniportal/pvmswebsite/assets/build/cloud.html`,
            Roarand: `${this.csrf}`,
            Cookie: Object.entries(stationCookies)
                .map(([key, value]) => `${key}=${value}`)
                .join('; '),
        };

        const stationPayload = {
            curPage: 1,
            pageSize: 10,
            gridConnectedTime: '',
            queryTime: 1666044000000,
            timeZone: 2,
            sortId: 'createTime',
            sortDir: 'DESC',
            locale: 'en_US',
        };

        console.log(`Getting Station at: ${stationUrl}`);
        const stationResponse = await axios.post(stationUrl, stationPayload, {
            headers: stationHeaders,
            withCredentials: true,
        });
        const jsonResponse = stationResponse.data;
        console.log(`Station info: ${stationResponse.data}`);
        return jsonResponse;
    }

    getDeviceValue(
        deviceId: string,
        deviceType: DeviceType,
        output: Record<string, number | string | null>,
        defaultValue: number = 0
    ): number | string | Date {
        if (deviceType === DeviceType.SENSOR_TIME) {
            return new Date();
        }
        return output[deviceId.toLowerCase().replace(/ /g, '_')] ?? defaultValue;
    }

    async getDevices(): Promise<any> {
        this.refreshCsrf();

        const cookies = `locale=en-us; dp-session=${this.dp_session}`;
        const headers = {
            Accept: 'application/json',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Accept-Language': 'en-GB,en;q=0.9',
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Cookie: cookies,
        };

        const params = new URLSearchParams({ stationDn: decodeURIComponent(this.station) });
        const dataAccessUrl = `https://${
            this.data_host
        }/rest/pvms/web/station/v2/overview/energy-flow?${params.toString()}`;

        const response = await fetch(dataAccessUrl, { headers });

        if (response.ok) {
            const jsonBody = await response.json();

            const result = {
                gridFlow: 0,
                batteryFlow: 0,
                batteryChargeLevel: 0,
                houseConsumption: 0,
                solarGeneration: 0,
            };

            for (const node of jsonBody.data.flow.nodes ?? []) {
                if (node.name === 'neteco.pvms.devTypeLangKey.string') {
                    result.gridFlow = node.value;
                }
                if (node.name === 'neteco.pvms.KPI.kpiView.electricalLoad') {
                    result.houseConsumption = node.value;
                }
                if (node.name === 'neteco.pvms.devTypeLangKey.energy_store') {
                    result.batteryFlow = node.value;
                    result.batteryChargeLevel = node.deviceTips.SOC;
                }
            }

            for (const link of jsonBody.data.flow.links ?? []) {
                if (link.description.label === 'neteco.pvms.energy.flow.input.power') {
                    result.solarGeneration = parseFloat(link.description.value);
                }
            }

            // node - neteco.pvms.devTypeLangKey.energy_store = batteri
            // value = hur mycket batteriet laddas med
            // deviceTips.SOC = % laddning i batteriet

            // node - neteco.pvms.KPI.kpiView.electricalLoad = huset
            // value = hur mycket el som huset använder

            // node - neteco.pvms.devTypeLangKey.string = cellerna
            // value = hur mycket el som genereras just nu

            // link - neteco.pvms.energy.flow.buy.power = elnätet
            // value = hur mycket el som säljs eller köps från nätet

            return result;
        } else {
            console.log('invalid response from getDevices:', response.status);
        }

        return {};
    }
}
