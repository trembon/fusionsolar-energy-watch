import { URL } from 'url';
import { encryptPassword, generateNonce } from './utils';
import { DeviceResult, EnergyFlowResult } from './interfaces/fusion-solar-interfaces';

export class FusionSolarAPI {
    private user: string;
    private pwd: string;
    private login_host: string;

    public station: string | null = null;

    private battery_capacity: number | null = null;
    private data_host: string | null = null;
    private dp_session: string = '';
    private connected: boolean = false;
    private csrf: string | null = null;
    private csrf_time: Date | null = null;
    private dongle_dn: string = null;

    constructor(user: string, pwd: string, login_host: string) {
        this.user = user;
        this.pwd = pwd;
        this.login_host = login_host;
    }

    async login(): Promise<boolean> {
        if (this.connected) return true;

        const publicKeyUrl = `https://${this.login_host}/unisso/pubkey`;

        let response: Response;
        try {
            response = await fetch(publicKeyUrl);
        } catch (err) {
            console.error('Error fetching public key:', err);
            this.connected = false;
            return false;
        }

        const pubkeyData = await response.json();

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
            const loginResp = await fetch(loginUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'accept-encoding': 'gzip, deflate, br, zstd',
                    connection: 'keep-alive',
                    host: this.login_host,
                    'x-requested-with': 'XMLHttpRequest',
                    origin: `https://${this.login_host}`,
                    referer: `https://${this.login_host}/unisso/login.action`,
                },
                body: JSON.stringify(payload),
            });
            const loginRespData = await loginResp.json();

            if (loginResp.status === 200) {
                let redirect_url = '';
                if (loginRespData.respMultiRegionName) {
                    redirect_url = `https://${this.login_host}${loginRespData.respMultiRegionName[1]}`;
                } else if (loginRespData.redirectURL) {
                    redirect_url = `https://${this.login_host}${loginRespData.redirectURL}`;
                } else {
                    this.connected = false;
                    return false;
                }

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

                this.data_host = new URL(redirectAuthResp.headers.get('location')).host;

                if (redirectAuthResp.status === 200 || redirectAuthResp.status === 302) {
                    const cookies: string[] = redirectAuthResp.headers.getSetCookie();
                    if (cookies && cookies.length > 0) {
                        let dpSession = undefined;
                        cookies[0].split(';').forEach((x) => {
                            if (x.startsWith('dp-session=')) {
                                dpSession = x.split('=')[1];
                            }
                        });

                        if (dpSession) {
                            this.connected = true;
                            this.dp_session = dpSession;

                            await this.refreshCsrf();

                            var stationList = await this.getStationList();
                            this.station = stationList.data.list[0].dn;

                            var deviceList = await this.getDevices();
                            const dongleDevice = deviceList.data.find((item) => item.mocTypeName === 'Dongle');
                            if (dongleDevice) {
                                this.dongle_dn = dongleDevice.dn;
                            } else {
                                console.log('dongle device not found');
                            }

                            if (!this.battery_capacity || this.battery_capacity == 0) {
                                this.battery_capacity = stationList.data.list[0].batteryCapacity;
                            }

                            this.connected = true;
                            return true;
                        } else {
                            console.error('FusionSolar :: dp session not found in cookie');
                        }
                    } else {
                        console.error('FusionSolar :: cookies in redirect response was not found');
                    }
                } else {
                    console.error('FusionSolar :: invalid response status from auth redirect', redirectAuthResp.status);
                }
            } else {
                console.error('FusionSolar :: invalid login');
            }
        } catch (err) {
            console.error('FusionSolar :: Login failed:', err);
        }

        this.connected = false;
        return false;
    }

    async renewSession(): Promise<boolean> {
        this.connected = false;
        this.dp_session = '';
        this.csrf = null;
        this.csrf_time = null;

        return await this.login();
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

            const query = new URLSearchParams(roarandParams).toString();
            const urlWithParams = `${roarandUrl}?${query}`;

            const roarandResponse = await fetch(urlWithParams, {
                method: 'GET',
                headers: roarandHeaders,
                credentials: 'include',
            });

            const responseData = await roarandResponse.json();
            this.csrf = responseData.payload;
            this.csrf_time = new Date();
        }
    }

    private async getStationList(): Promise<any> {
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

        const stationResponse = await fetch(stationUrl, {
            method: 'POST',
            headers: stationHeaders,
            body: JSON.stringify(stationPayload),
            credentials: 'include',
        });
        const jsonResponse = await stationResponse.json();
        return jsonResponse;
    }

    private async getDevices(): Promise<DeviceResult | undefined> {
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

        const params = new URLSearchParams({
            'conditionParams.checkShareStationDn': decodeURIComponent(this.station),
            'conditionParams.parentDn': decodeURIComponent(this.station),
            'conditionParams.curPage': '1',
            'conditionParams.recordperpage': '10',
            'conditionParams.sortType': 'BY_DEVICE_NAME',
            'conditionParams.maintenance': 'false',
        });
        const dataAccessUrl = `https://${
            this.data_host
        }/rest/neteco/web/config/device/v1/device-list?${params.toString()}`;

        const response = await fetch(dataAccessUrl, { headers });

        if (response.ok) {
            const jsonBody = await response.json();
            return jsonBody;
        } else {
            console.log('FusionSolar :: invalid response from getDevices:', response.status);
        }

        return undefined;
    }

    async getEnergyFlow(): Promise<EnergyFlowResult | undefined> {
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

            const result: EnergyFlowResult = {
                gridFlow: 0,
                batteryFlow: 0,
                batteryChargeLevel: 0,
                houseConsumption: 0,
                solarGeneration: 0,
            };

            for (const node of jsonBody.data.flow.nodes ?? []) {
                if (node.name === 'neteco.pvms.KPI.kpiView.electricalLoad') {
                    // house energy usage
                    result.houseConsumption = node.value;
                } else if (node.name === 'neteco.pvms.devTypeLangKey.energy_store') {
                    // battery energy flow and current charge level
                    result.batteryFlow = parseFloat(node.deviceTips.BATTERY_POWER);
                    result.batteryChargeLevel = parseFloat(node.deviceTips.SOC);
                } else if (node.name === 'neteco.pvms.devTypeLangKey.string') {
                    // energy generation by solar panels
                    result.solarGeneration = node.value;
                }
            }

            for (const link of jsonBody.data.flow.links ?? []) {
                if (link.description.label === 'neteco.pvms.energy.flow.buy.power') {
                    // grid flow (buy/sell)
                    result.gridFlow = parseFloat(link.description.value);
                    if (link.toNode === '2') {
                        result.gridFlow = -result.gridFlow;
                    }
                }
            }

            return result;
        } else {
            console.log('FusionSolar :: invalid response from getEnergyFlow:', response.status);
        }

        return undefined;
    }

    async setConfigSignals(payload: string): Promise<{ result: boolean }> {
        const cookies = `locale=en-us; dp-session=${this.dp_session}`;
        const headers = {
            Accept: 'application/json',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Accept-Language': 'en-GB,en;q=0.9',
            'Content-Type': 'application/x-www-form-urlencoded',
            Roarand: `${this.csrf}`,
            Origin: `https://${this.data_host}`,
            Referer: `https://${this.data_host}/uniportal/pvmswebsite/assets/build/cloud.html`,
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Cookie: cookies,
        };

        const setConfigUrl = `https://${this.data_host}/rest/pvms/web/device/v1/deviceExt/set-config-signals`;
        const body = `dn=${encodeURIComponent(this.dongle_dn)}&changeValues=%5B${encodeURIComponent(
            JSON.stringify(payload)
        )}%5D`;

        const response = await fetch(setConfigUrl, {
            headers,
            method: 'POST',
            body: body,
        });

        if (response.ok) {
            const jsonBody = await response.json();
            return { result: jsonBody.code === 0 };
        } else {
            console.log('FusionSolar :: invalid response from setConfigSignals:', response.status);
        }

        return { result: false };
    }
}
