import * as crypto from 'crypto';
import { EnergyFlowResult } from './interfaces/fusion-solar-interfaces';

export function generateNonce(): string {
    return Array.from({ length: 16 }, () => crypto.randomBytes(1).toString('hex')).join('');
}

export function encryptPassword(pubKeyPem: string, password: string): string {
    // Load public key
    const publicKey = crypto.createPublicKey(pubKeyPem);

    // Encrypt password
    const encryptedPassword = crypto.publicEncrypt(
        {
            key: publicKey,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha384',
        },
        Buffer.from(password)
    );

    return encryptedPassword.toString('base64');
}

export function extractNumeric(valueWithUnit: string): number {
    try {
        return parseFloat(valueWithUnit.split(' ')[0]);
    } catch {
        return 0;
    }
}

export function getChangedProperties(
    oldResult: EnergyFlowResult,
    newResult: EnergyFlowResult
): (keyof EnergyFlowResult)[] {
    const changed: (keyof EnergyFlowResult)[] = [];

    (Object.keys(oldResult) as (keyof EnergyFlowResult)[]).forEach((key) => {
        if (oldResult[key] !== newResult[key]) {
            changed.push(key);
        }
    });

    return changed;
}
