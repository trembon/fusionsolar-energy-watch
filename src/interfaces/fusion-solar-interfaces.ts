export interface EnergyFlowResult {
    gridFlow: number;
    batteryFlow: number;
    batteryChargeLevel: number;
    houseConsumption: number;
    solarGeneration: number;
}

export interface DeviceResult {
    code: number;
    data: DeviceItemResult[];
}

export interface DeviceItemResult {
    deviceStatus: string;
    dn: string;
    mocTypeName: string;
    name: string;
}
