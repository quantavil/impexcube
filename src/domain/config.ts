import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface AppConfig {
  compliance: Record<string, string>;
  tariff_rules: Record<string, any>;
  special_conditions: Record<string, any>;
  materials: Record<string, string>;
  countries: Record<string, string>;
  app: {
    default_branch: string;
    default_financial_year: string;
    artware_prefix_template?: string;
  };
}

let cachedConfig: AppConfig | null = null;

export function loadConfig(configPath?: string): AppConfig {
  if (cachedConfig && !configPath) return cachedConfig;
  const candidates = [
    configPath,
    process.env.IMPEX_CONFIG_PATH,
    resolve('config/defaults.json'),
    resolve(import.meta.dir, '../../config/defaults.json'),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const text = readFileSync(p, 'utf-8');
        cachedConfig = JSON.parse(text);
        return cachedConfig!;
      } catch {}
    }
  }

  return {
    compliance: {
      ritc_code: '94038900',
      sqc_unit: 'NOS',
      drawback_schno: '940399B',
      dbk_rate: '1.2',
      dbk_unit: 'PCS',
      scheme: '19-Drawback (DBK)',
      end_use: 'GNX100',
      payment_status: 'LUT',
      state_origin: '09',
      district_origin: '171',
      country_destination: 'ES',
      fta_code: 'NCPTI',
      reward_item: 'Yes',
      rodtep: 'Yes',
      per: '1',
      per_unit: 'PCS',
      quantity_unit: 'PCS',
      taxable_value: '0',
      igst_rate: '0',
      igst_amount: '0',
    },
    tariff_rules: {},
    special_conditions: {},
    materials: {},
    countries: {},
    app: {
      default_branch: 'MORADABAD',
      default_financial_year: '2026-2027',
    },
  };
}
