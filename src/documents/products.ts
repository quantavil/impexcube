import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { loadConfig } from '../domain/config';
import type { ReconciledProducts } from '../domain/model';
import { ReconciledProductsSchema } from '../domain/schemas';
import {
  type DutyExportInfo,
  fetchDutyExportStructure,
  resolveBestDbk,
} from './duty';

export const COLUMN_NAMES = [
  'InvoiceSNo',
  'ItemSNo',
  'InvoiceNo',
  'Description',
  'EndUse',
  'HAWBL_NO',
  'Total_Package',
  'Accessories',
  'RewardItem',
  'IGST_PaymentStatus',
  'RITCCode',
  'ApplicableExpSchemes',
  'Quantity',
  'QuantityUnit',
  'SQCQTY',
  'SQCUnit',
  'UnitPrice',
  'ProductAmount',
  'Per',
  'PerUnit',
  'drawback_schno',
  'dbk_qty',
  'dbk_rate',
  'dbk_unit',
  'dbk_desc',
  'ROSLRate',
  'ROSLCapValue',
  'CountryDestination',
  'FTACode',
  'StateOrigin',
  'DistrictOrigin',
  'Taxable_Value',
  'IGST_Rate',
  'IGST_Amount',
  'GSTCCessAmount',
  'RODTEP',
  'RoDTEPQty',
];

export const COLUMN_LETTERS = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
  'AA',
  'AB',
  'AC',
  'AD',
  'AE',
  'AF',
  'AG',
  'AH',
  'AI',
  'AJ',
  'AK',
];

export const COL_LETTER_TO_NAME: Record<string, string> = Object.fromEntries(
  COLUMN_LETTERS.map((col, idx) => [col, COLUMN_NAMES[idx]]),
);
export const COL_NAME_TO_LETTER: Record<string, string> = Object.fromEntries(
  COLUMN_NAMES.map((name, idx) => [name, COLUMN_LETTERS[idx]]),
);

const config = loadConfig();

const BASE_MATERIAL_MAP: Record<string, string> = {
  's.steel': 'STAINLESS STEEL',
  's. steel': 'STAINLESS STEEL',
  ss: 'STAINLESS STEEL',
  'stainless steel': 'STAINLESS STEEL',
  iron: 'IRON',
  ms: 'IRON',
  'mild steel': 'IRON',
  'mango wood': 'MANGO WOOD',
  mango: 'MANGO WOOD',
  wood: 'MANGO WOOD',
  wooden: 'MANGO WOOD',
  'sheesham wood': 'MANGO WOOD',
  'acacia wood': 'MANGO WOOD',
  glass: 'GLASS',
  marble: 'MARBLE',
  mb: 'MARBLE',
  jute: 'JUTE',
  brass: 'BRASS',
  aluminium: 'ALUMINIUM',
  aluminum: 'ALUMINIUM',
  alu: 'ALUMINIUM',
  alumi: 'ALUMINIUM',
  copper: 'COPPER',
  cane: 'CANE',
  rattan: 'CANE',
  leather: 'LEATHER',
  fabric: 'FABRIC',
  cotton: 'FABRIC',
  'ceramic tile': 'CERAMIC TILE',
  'creamic tile': 'CERAMIC TILE',
  ceramic: 'CERAMIC',
  mdf: 'MDF',
  plast: 'PLASTIC',
  plastic: 'PLASTIC',
  steel: 'STEEL',
  stone: 'STONE',
};

export const MATERIAL_MAP: Record<string, string> = {
  ...BASE_MATERIAL_MAP,
  ...(config.materials || {}),
};

export const KNOWN_MATERIALS = Object.keys(MATERIAL_MAP).sort(
  (a, b) => b.length - a.length,
);

const BASE_COUNTRY_CODE_MAP: Record<string, string> = {
  SPAIN: 'ES',
  USA: 'US',
  'UNITED STATES': 'US',
  'UNITED STATES OF AMERICA': 'US',
  GERMANY: 'DE',
  'UNITED KINGDOM': 'GB',
  UK: 'GB',
  FRANCE: 'FR',
  ITALY: 'IT',
  NETHERLANDS: 'NL',
  AUSTRALIA: 'AU',
  CANADA: 'CA',
  UAE: 'AE',
  'UNITED ARAB EMIRATES': 'AE',
  BELGIUM: 'BE',
  SWEDEN: 'SE',
  NORWAY: 'NO',
  DENMARK: 'DK',
  POLAND: 'PL',
  MAURETANIA: 'MR',
  MAURITANIA: 'MR',
  SWITZERLAND: 'CH',
};

export const COUNTRY_CODE_MAP: Record<string, string> = {
  ...BASE_COUNTRY_CODE_MAP,
  ...(config.countries || {}),
};

export const DEFAULT_COMPLIANCE = {
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
  ...(config.compliance || {}),
};

function getSheetRows(
  sheet: XLSX.WorkSheet,
): Record<number, Record<string, any>> {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const rows: Record<number, Record<string, any>> = {};
  for (let r = range.s.r; r <= range.e.r; r++) {
    const rowNum = r + 1;
    const rowData: Record<string, any> = {};
    for (let c = range.s.c; c <= range.e.c; c++) {
      const colLetter = XLSX.utils.encode_col(c);
      const cell = sheet[colLetter + rowNum];
      if (cell && cell.v !== undefined) {
        rowData[colLetter] = cell.v;
      }
    }
    rows[rowNum] = rowData;
  }
  return rows;
}

export function extractCommercialInvoice(
  sheets: Record<string, XLSX.WorkSheet>,
) {
  const invSheet = sheets['INVOICE'];
  if (!invSheet) {
    throw new Error("Spreadsheet does not contain an 'INVOICE' sheet");
  }
  const inv = getSheetRows(invSheet);

  let invoice_no: string | null = null;
  let exporter: string | null = null;
  let consignee: string | null = null;
  let country_dest: string | null = null;

  for (const [rStr, cols] of Object.entries(inv)) {
    const r = Number(rStr);
    for (const [c, val] of Object.entries(cols)) {
      if (!val) continue;
      const vStr = String(val).trim();
      const vUp = vStr.toUpperCase();
      if (
        (vUp.includes('INVOICE NO') ||
          vUp.includes('INV NO') ||
          vUp.includes('INVOICE #')) &&
        !invoice_no
      ) {
        const m = vStr.match(
          /(?:INVOICE\s*(?:NO\.?|#)?\s*(?:&\s*DATE)?:?\s*)([A-Z0-9\-/]*\d[A-Z0-9\-/]*)/i,
        );
        if (m && m[1].length > 1) {
          invoice_no = m[1].trim();
        } else {
          const below = String(inv[r + 1]?.[c] ?? '').trim();
          const m2 = below.match(/([A-Z0-9\-/]*\d[A-Z0-9\-/]*)\s*(?:DATE|$)/i);
          if (m2) {
            invoice_no = m2[1].trim();
          } else if (below) {
            const firstTok = below.split(/\s+/)[0].trim();
            if (/\d/.test(firstTok)) invoice_no = firstTok;
          }
        }
      } else if (
        (vUp.includes('EXPORTER') || vUp.includes('MANUFACTURER')) &&
        !exporter
      ) {
        const below = String(inv[r + 1]?.[c] ?? '').trim();
        if (below) exporter = below;
      } else if (vUp.includes('CONSIGNEE') && !consignee) {
        const below = String(inv[r + 1]?.[c] ?? '').trim();
        if (below) consignee = below;
      } else if (
        (vUp.includes('FINAL DESTINATION') ||
          vUp.includes('COUNTRY OF FINAL DESTINATION')) &&
        !country_dest
      ) {
        const below = String(inv[r + 1]?.[c] ?? '').trim();
        if (below) {
          country_dest =
            COUNTRY_CODE_MAP[below.toUpperCase()] ||
            (below.length === 2 ? below.toUpperCase() : null);
        }
      }
    }
  }

  if (!invoice_no) {
    const headerDateStr = String(inv[3]?.['E'] ?? '');
    const invNoMatch = headerDateStr.match(/([A-Z0-9\-/]+)\s*(?:DATE|$)/i);
    invoice_no = invNoMatch ? invNoMatch[1].trim() : null;
  }

  if (!country_dest) {
    const destCountry = String(inv[16]?.['H'] ?? '').trim();
    country_dest =
      COUNTRY_CODE_MAP[destCountry.toUpperCase()] || destCountry || null;
  }

  if (!exporter) exporter = String(inv[3]?.['A'] ?? '').trim();
  if (!consignee) consignee = String(inv[11]?.['A'] ?? '').trim();

  let headerRowIdx: number | null = null;
  for (const [rStr, cols] of Object.entries(inv)) {
    const rowTxt = Object.values(cols).join(' ').toUpperCase();
    if (
      rowTxt.includes('SUP. REF') &&
      (rowTxt.includes('DESCRIPTION') || rowTxt.includes('QUANTITY'))
    ) {
      headerRowIdx = Number(rStr);
      break;
    }
  }
  if (headerRowIdx === null) headerRowIdx = 25;

  const items: any[] = [];
  let itemSNo = 1;
  const rowKeys = Object.keys(inv).map(Number);
  const maxInvRow =
    rowKeys.length > 0 ? Math.max(...rowKeys) : headerRowIdx + 50;

  for (let r = headerRowIdx + 1; r <= maxInvRow; r++) {
    const row = inv[r] || {};
    const colA = String(row['A'] ?? '').trim();
    const colF = String(row['F'] ?? '').trim();
    if (
      colA.toUpperCase().includes('TOTAL INVOICE') ||
      colA.toUpperCase().includes('DECLARATION')
    ) {
      break;
    }
    if (!colA && !colF) continue;
    const colFClean = colF.replace(/,/g, '');
    const qty = parseFloat(colFClean);
    if (Number.isNaN(qty)) continue;

    const priceStr = String(row['H'] ?? '')
      .trim()
      .replace(/,/g, '');
    const amtStr = String(row['I'] ?? '')
      .trim()
      .replace(/,/g, '');
    const unitPrice = priceStr ? parseFloat(priceStr) : 0;
    const amount = amtStr
      ? parseFloat(amtStr)
      : Math.round(qty * unitPrice * 100) / 100;

    const quantityStr = Number.isInteger(qty) ? String(qty) : String(qty);
    const unitPriceStr =
      priceStr ||
      (Number.isInteger(unitPrice) ? String(unitPrice) : String(unitPrice));
    const amountStr =
      amtStr ||
      (Number.isInteger(amount)
        ? String(amount)
        : amount.toFixed(2).replace(/\.?0+$/, ''));

    items.push({
      item_s_no: itemSNo++,
      ref_no: colA,
      idp: String(row['B'] ?? '').trim(),
      idc: String(row['C'] ?? '').trim(),
      description: String(row['D'] ?? '').trim(),
      hsn: String(row['E'] ?? '').trim() || '94038900',
      quantity: qty,
      quantity_str: quantityStr,
      unit: String(row['G'] ?? 'PCS')
        .trim()
        .toUpperCase(),
      unit_price: unitPrice,
      unit_price_str: unitPriceStr,
      amount: amount,
      amount_str: amountStr,
    });
  }

  return {
    invoice_no: invoice_no || '',
    exporter: exporter || '',
    consignee: consignee || '',
    country_destination: country_dest,
    items,
    total_items: items.length,
    total_quantity: items.reduce((sum, it) => sum + it.quantity, 0),
    total_amount: items.reduce((sum, it) => sum + it.amount, 0),
  };
}

export function extractPackingList(sheets: Record<string, XLSX.WorkSheet>) {
  const pkgSheet = sheets['PACKING'];
  if (!pkgSheet) {
    throw new Error("Spreadsheet does not contain a 'PACKING' sheet");
  }
  const pkg = getSheetRows(pkgSheet);

  let headerRowIdx: number | null = null;
  for (const [rStr, cols] of Object.entries(pkg)) {
    const rowTxt = Object.values(cols).join(' ').toUpperCase();
    if (
      rowTxt.includes('SUP. REF') &&
      (rowTxt.includes('DESCRIPTION') || rowTxt.includes('MASTER CASE'))
    ) {
      headerRowIdx = Number(rStr);
      break;
    }
  }
  if (headerRowIdx === null) headerRowIdx = 25;

  const items: any[] = [];
  let currentItem: any = null;
  let totalNetWeightDeclared: number | null = null;

  const rowKeys = Object.keys(pkg).map(Number);
  const maxR = rowKeys.length > 0 ? Math.max(...rowKeys) : headerRowIdx + 100;

  for (let r = headerRowIdx + 1; r <= maxR; r++) {
    const row = pkg[r] || {};
    const colA = String(row['A'] ?? '').trim();
    const colF = String(row['F'] ?? '').trim();
    const colH = String(row['H'] ?? '').trim();
    const colJ = String(row['J'] ?? '').trim();
    const colM = String(row['M'] ?? '').trim();
    const colN = String(row['N'] ?? '').trim();

    if (
      colF.toUpperCase() === 'TOTAL' ||
      colA.toUpperCase().includes('TOTAL CARTON') ||
      colA.toUpperCase().includes('TOTAL NET WEIGHT')
    ) {
      if (currentItem) {
        items.push(currentItem);
        currentItem = null;
      }
      if (colF.toUpperCase() === 'TOTAL' && colN) {
        const val = parseFloat(colN.replace(/,/g, ''));
        if (!Number.isNaN(val)) totalNetWeightDeclared = val;
      }
      continue;
    }

    if (colA && /^\d+$/.test(colF)) {
      if (currentItem) items.push(currentItem);
      const cFrom = parseInt(colF, 10);
      const cTo = /^\d+$/.test(colH) ? parseInt(colH, 10) : cFrom;
      const ctns = /^\d+$/.test(colJ) ? parseInt(colJ, 10) : cTo - cFrom + 1;

      const qty = parseFloat(String(row['L'] ?? 0).replace(/,/g, '')) || 0;
      const netPc = parseFloat(colM.replace(/,/g, '')) || 0;
      const totNet = parseFloat(colN.replace(/,/g, '')) || 0;
      const totGross = parseFloat(String(row['P'] ?? 0).replace(/,/g, '')) || 0;

      currentItem = {
        row: r,
        ref_no: colA,
        idp: String(row['B'] ?? '').trim(),
        idc: String(row['C'] ?? '').trim(),
        description: String(row['D'] ?? '').trim(),
        carton_from: cFrom,
        carton_to: cTo,
        cartons: ctns,
        quantity: qty,
        net_weight_per_piece: netPc,
        total_net_weight: totNet,
        gross_weight: totGross,
        materials: [],
      };
    } else if (currentItem) {
      let matCandidate: string | null = null;
      const colDStr = String(row['D'] ?? '');
      for (const km of KNOWN_MATERIALS) {
        if (colM.toLowerCase().includes(km)) {
          matCandidate = colM;
          break;
        } else if (colN.toLowerCase().includes(km)) {
          matCandidate = colN;
          break;
        } else if (colDStr.toLowerCase().includes(km)) {
          matCandidate = km;
          break;
        }
      }

      if (matCandidate) {
        let wtTot = 0;
        let wtPc = 0;
        if (colN && parseFloat(colN.replace(/,/g, '')) > 0) {
          wtTot = parseFloat(colN.replace(/,/g, ''));
        }
        if (colM && parseFloat(colM.replace(/,/g, '')) > 0) {
          wtPc = parseFloat(colM.replace(/,/g, ''));
        }

        if (wtTot === 0) {
          const prevRow = pkg[r - 1] || {};
          const pM = String(prevRow['M'] ?? '').replace(/,/g, '');
          const pN = String(prevRow['N'] ?? '').replace(/,/g, '');
          if (pN && parseFloat(pN) > 0) wtTot = parseFloat(pN);
          if (pM && parseFloat(pM) > 0) wtPc = parseFloat(pM);
        }

        currentItem.materials.push({
          name: matCandidate,
          net_per_pc:
            wtPc > 0
              ? wtPc
              : currentItem.materials.length === 0
                ? currentItem.net_weight_per_piece
                : 0,
          total_net:
            wtTot > 0
              ? wtTot
              : currentItem.materials.length === 0
                ? currentItem.total_net_weight
                : 0,
        });
      }
    }
  }

  if (currentItem) items.push(currentItem);

  for (const it of items) {
    if (it.materials.length > 0) {
      const matTot = it.materials.reduce(
        (sum: number, m: any) => sum + m.total_net,
        0,
      );
      if (matTot > 0) it.total_net_weight = Math.round(matTot * 100) / 100;
      const matPc = it.materials.reduce(
        (sum: number, m: any) => sum + m.net_per_pc,
        0,
      );
      if (matPc > 0) it.net_weight_per_piece = Math.round(matPc * 100) / 100;
    } else if (it.description) {
      const descL = it.description.toLowerCase();
      for (const km of KNOWN_MATERIALS) {
        if (descL.includes(km)) {
          it.materials.push({
            name: km,
            net_per_pc: it.net_weight_per_piece,
            total_net: it.total_net_weight,
          });
          break;
        }
      }
    }
  }

  const calcTotalNet = items.reduce((sum, it) => sum + it.total_net_weight, 0);
  const finalTotalNet =
    totalNetWeightDeclared !== null
      ? totalNetWeightDeclared
      : Math.round(calcTotalNet * 100) / 100;

  return {
    items,
    total_cartons: items.reduce((sum, it) => sum + it.cartons, 0),
    total_net_weight: finalTotalNet,
    total_gross_weight: items.reduce((sum, it) => sum + it.gross_weight, 0),
  };
}

export function normalizeMaterialName(rawName: string): string {
  const cleaned = rawName.trim().toLowerCase();
  for (const [pattern, normalized] of Object.entries(MATERIAL_MAP)) {
    if (
      pattern === cleaned ||
      new RegExp(
        `\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
      ).test(cleaned)
    ) {
      return normalized;
    }
  }
  return rawName.trim().toUpperCase();
}

export function standardizeProductDescription(
  materials:
    | {
        name: string;
        total_net?: number;
        weight?: number;
        percentage?: number;
      }[]
    | undefined,
  origDesc: string,
  template?: string,
  isArtware = true,
  isFurniture?: boolean,
): string {
  let cleanOrig = origDesc.trim().toUpperCase();
  if (!isArtware) return cleanOrig;

  const isFurn =
    isFurniture ??
    /TABLE|CHAIR|STOOL|BENCH|DESK|CABINET|SOFA|BED|SHELF|WARDROBE/i.test(
      cleanOrig,
    );

  const tpl =
    template ||
    (isFurn && config.app?.artware_prefix_template
      ? config.app.artware_prefix_template
      : 'OTHER ARTICLES OF {materials} ARTWARE - {description}');
  let existingMats: string | null = null;

  const m = cleanOrig.match(
    /^OTHER\s+(?:FURNITURE\s+)?ARTICLES\s+OF\s+(.+?)\s+ARTWARE\s*-\s*(.+)$/,
  );
  if (m) {
    existingMats = m[1].trim();
    cleanOrig = m[2].trim();
  }

  const sortedMats = [...(materials || [])].sort((a, b) => {
    const valA = a.total_net ?? a.weight ?? a.percentage ?? 0;
    const valB = b.total_net ?? b.weight ?? b.percentage ?? 0;
    return valB - valA;
  });
  const matNames: string[] = [];
  for (const mat of sortedMats) {
    const norm = normalizeMaterialName(mat.name);
    if (norm && !matNames.includes(norm)) matNames.push(norm);
  }

  let matStr: string;
  if (matNames.length === 0 && existingMats) {
    matStr = existingMats;
  } else if (matNames.length === 0) {
    const descLower = cleanOrig.toLowerCase();
    for (const km of KNOWN_MATERIALS) {
      if (descLower.includes(km)) {
        const norm = normalizeMaterialName(km);
        if (norm && !matNames.includes(norm)) matNames.push(norm);
      }
    }
    matStr = matNames.length > 0 ? matNames.join(' / ') : 'HANDICRAFTS';
  } else {
    matStr = matNames.join(' / ');
  }

  if (tpl.includes('{materials}') && tpl.includes('{description}')) {
    return tpl
      .replace('{materials}', matStr)
      .replace('{description}', cleanOrig);
  }
  return `OTHER ARTICLES OF ${matStr} ARTWARE - ${cleanOrig}`;
}

export function reconcileProductsData(
  invoiceData: ReturnType<typeof extractCommercialInvoice>,
  packingData: ReturnType<typeof extractPackingList>,
  complianceRules?: any,
  dutyMap?: Map<string, DutyExportInfo | null>,
) {
  const rules = { ...DEFAULT_COMPLIANCE, ...(complianceRules || {}) };
  const invItems = invoiceData.items;
  const pkgItems = packingData.items;

  if (invItems.length !== pkgItems.length) {
    throw new Error(
      `Item count mismatch: Invoice has ${invItems.length} items, Packing list has ${pkgItems.length} items`,
    );
  }

  const matchedPkg: any[] = [];
  const usedPkgIndices = new Set<number>();
  let keyMatchSuccess = true;

  for (const invItem of invItems) {
    let matchIdx: number | null = null;
    const invRef = String(invItem.ref_no || '')
      .replace(/[\s-]+/g, '')
      .toUpperCase();
    const invIdp = String(invItem.idp || '').trim();
    const invIdc = String(invItem.idc || '').trim();

    for (let pIdx = 0; pIdx < pkgItems.length; pIdx++) {
      if (usedPkgIndices.has(pIdx)) continue;
      const pkgItem = pkgItems[pIdx];
      const pkgRef = String(pkgItem.ref_no || '')
        .replace(/[\s-]+/g, '')
        .toUpperCase();
      const pkgIdp = String(pkgItem.idp || '').trim();
      const pkgIdc = String(pkgItem.idc || '').trim();

      if (invRef && pkgRef && invRef === pkgRef) {
        matchIdx = pIdx;
        break;
      } else if (invIdp && pkgIdp && invIdp === pkgIdp) {
        matchIdx = pIdx;
        break;
      } else if (invIdc && pkgIdc && invIdc === pkgIdc) {
        matchIdx = pIdx;
        break;
      }
    }

    if (matchIdx !== null) {
      usedPkgIndices.add(matchIdx);
      matchedPkg.push(pkgItems[matchIdx]);
    } else {
      keyMatchSuccess = false;
      break;
    }
  }

  const finalPkg =
    keyMatchSuccess && matchedPkg.length === invItems.length
      ? matchedPkg
      : pkgItems;

  const reconciled: any[] = [];
  for (let idx = 0; idx < invItems.length; idx++) {
    const invItem = invItems[idx];
    const pkgItem = finalPkg[idx];
    let isArtware = rules.is_artware ?? true;
    if (rules.goods_type === 'industrial') isArtware = false;

    const desc = standardizeProductDescription(
      pkgItem.materials,
      invItem.description,
      rules.artware_prefix_template,
      isArtware,
    );

    const qtyStr = invItem.quantity_str;
    const pVal = invItem.unit_price;
    const priceStr = Number.isInteger(pVal) ? String(pVal) : String(pVal);
    const aVal = invItem.amount;
    const amtStr = Number.isInteger(aVal) ? String(aVal) : String(aVal);

    const destCountryVal =
      complianceRules?.country_destination || rules.country_destination || 'ES';

    const tariffRules = {
      ...(config.tariff_rules || {}),
      ...(rules.tariff_rules || {}),
    };
    const specialConditions = {
      ...(config.special_conditions || {}),
      ...(rules.special_conditions || {}),
    };

    let matchedSpecial: any = null;
    const refDescUpper =
      `${invItem.ref_no} ${invItem.description}`.toUpperCase();
    for (const [condKey, condRule] of Object.entries(specialConditions)) {
      if (refDescUpper.includes(condKey.toUpperCase())) {
        matchedSpecial = condRule;
        break;
      }
    }

    const hsn = String(invItem.hsn || '').trim();
    let ritcVal = rules.ritc_code;
    let schemeVal = rules.scheme;
    let rewardVal = rules.reward_item;
    let rodtepVal = rules.rodtep;
    let sqcUnitVal = rules.sqc_unit;
    let sqcQtyVal = qtyStr;
    let rodtepQtyVal = qtyStr;
    let dbkSchVal = rules.drawback_schno;
    let dbkRateVal: string | null = String(rules.dbk_rate);
    let dbkUnitVal = rules.dbk_unit;
    let dbkDescVal: string | null = null;
    let roslRateVal: string | null = null;
    let roslCapVal: string | null = null;

    if (matchedSpecial) {
      ritcVal = matchedSpecial.ritc_code || rules.ritc_code;
      schemeVal = matchedSpecial.scheme || '00';
      rewardVal = matchedSpecial.reward_item || 'No';
      rodtepVal = matchedSpecial.rodtep || 'No';
      sqcUnitVal = matchedSpecial.sqc_unit || 'NOS';
      sqcQtyVal = qtyStr;
      rodtepQtyVal = qtyStr;
      dbkSchVal = matchedSpecial.dbk_sch || null;
      dbkRateVal = matchedSpecial.dbk_rate || null;
      dbkUnitVal = matchedSpecial.dbk_unit || null;
      dbkDescVal = matchedSpecial.dbk_desc || null;
      roslRateVal = matchedSpecial.rosl_rate || '0.00';
      roslCapVal = matchedSpecial.rosl_cap_value || '0.00';
    } else if (tariffRules[hsn]) {
      const tRule = tariffRules[hsn];
      ritcVal = tRule.ritc_code || hsn;
      schemeVal = tRule.scheme || '19';
      rewardVal = tRule.reward_item || rules.reward_item;
      rodtepVal = tRule.rodtep || rules.rodtep;
      sqcUnitVal = tRule.sqc_unit || 'KGS';
      if (tRule.sqc_from_weight) {
        const totNet = pkgItem.total_net_weight || 0;
        sqcQtyVal =
          totNet > 0 ? String(Math.round(totNet * 100) / 100) : qtyStr;
      }
      rodtepQtyVal = sqcQtyVal;
      dbkSchVal = tRule.drawback_schno || rules.drawback_schno;
      dbkRateVal = String(tRule.dbk_rate || rules.dbk_rate);
      dbkUnitVal = tRule.dbk_unit || rules.dbk_unit;
      dbkDescVal = tRule.dbk_desc || 'Others';
      roslRateVal = tRule.rosl_rate || null;
      roslCapVal = tRule.rosl_cap_value || null;
    } else if (dutyMap?.get(hsn) && rules.ritc_code !== hsn) {
      const dInfo = dutyMap.get(hsn)!;
      ritcVal = hsn;
      sqcUnitVal = dInfo.standardUqc || rules.sqc_unit || 'NOS';
      if (sqcUnitVal === 'KGS') {
        const totNet = pkgItem.total_net_weight || 0;
        sqcQtyVal =
          totNet > 0 ? String(Math.round(totNet * 100) / 100) : qtyStr;
      }
      rodtepVal = dInfo.rodtepRate ? 'Yes' : rules.rodtep || 'Yes';
      rodtepQtyVal =
        dInfo.rodtepUqc === 'KGS' || sqcUnitVal === 'KGS' ? sqcQtyVal : qtyStr;
      const bestDbk = resolveBestDbk(dInfo.dbkEntries, desc);
      if (bestDbk) {
        dbkSchVal = bestDbk.ActualDBK_SERNo?.trim() || null;
        dbkRateVal = bestDbk.ActualDBKRate?.trim() || null;
        dbkUnitVal = bestDbk.ActualUnit?.trim() || rules.dbk_unit || 'PCS';
        dbkDescVal = bestDbk.ActualDBK_Desc?.trim() || null;
        schemeVal = '19';
      }
    }

    reconciled.push({
      InvoiceSNo: '1',
      ItemSNo: String(idx + 1),
      InvoiceNo: invoiceData.invoice_no
        ? invoiceData.invoice_no.replace(/\s/g, '')
        : '',
      Description: desc,
      EndUse: rules.end_use,
      HAWBL_NO: null,
      Total_Package: null,
      Accessories: null,
      RewardItem: rewardVal,
      IGST_PaymentStatus: rules.payment_status,
      RITCCode: ritcVal,
      ApplicableExpSchemes: schemeVal,
      Quantity: qtyStr,
      QuantityUnit: rules.quantity_unit,
      SQCQTY: sqcQtyVal,
      SQCUnit: sqcUnitVal,
      UnitPrice: priceStr,
      ProductAmount: amtStr,
      Per: rules.per,
      PerUnit: rules.per_unit,
      drawback_schno: dbkSchVal,
      dbk_qty: qtyStr,
      dbk_rate: dbkRateVal,
      dbk_unit: dbkUnitVal,
      dbk_desc: dbkDescVal,
      ROSLRate: roslRateVal,
      ROSLCapValue: roslCapVal,
      CountryDestination: destCountryVal,
      FTACode: rules.fta_code,
      StateOrigin: rules.state_origin,
      DistrictOrigin: rules.district_origin,
      Taxable_Value: rules.taxable_value,
      IGST_Rate: rules.igst_rate,
      IGST_Amount: rules.igst_amount,
      GSTCCessAmount: null,
      RODTEP: rodtepVal,
      RoDTEPQty: rodtepQtyVal,
      _ref_no: invItem.ref_no,
      _materials: pkgItem.materials,
      _net_weight: pkgItem.total_net_weight,
      _cartons: pkgItem.cartons,
    });
  }

  return {
    invoice_no: invoiceData.invoice_no,
    items: reconciled,
    total_items: reconciled.length,
    total_quantity: invoiceData.total_quantity,
    total_cartons: packingData.total_cartons,
    total_amount: invoiceData.total_amount,
    total_net_weight: packingData.total_net_weight,
  };
}

export async function reconcileProducts(
  sourcePath: string,
  rules?: any,
): Promise<ReconciledProducts> {
  const wb = XLSX.readFile(sourcePath);
  const invData = extractCommercialInvoice(wb.Sheets);
  const pkgData = extractPackingList(wb.Sheets);

  const dutyMap = new Map<string, DutyExportInfo | null>();
  for (const item of invData.items) {
    const hsn = String(item.hsn || '').trim();
    if (hsn && !dutyMap.has(hsn)) {
      try {
        const info = await fetchDutyExportStructure(hsn);
        dutyMap.set(hsn, info);
      } catch {
        dutyMap.set(hsn, null);
      }
    }
  }

  const reconciled = reconcileProductsData(invData, pkgData, rules, dutyMap);
  return ReconciledProductsSchema.parse(reconciled);
}

export async function writeProductExcelTemplate(
  rowsData: any[],
  templatePath: string,
  outputPath: string,
): Promise<{ status: string; output: string; items: number }> {
  const templateData = await readFile(templatePath);
  const zip = await JSZip.loadAsync(templateData);

  const sstXml = await zip.file('xl/sharedStrings.xml')!.async('text');
  const sharedStrings: string[] = [];
  const stringToIdx = new Map<string, number>();

  const siRegex = /<si>(.*?)<\/si>/gs;
  const tRegex = /<t[^>]*>(.*?)<\/t>/g;
  let match = siRegex.exec(sstXml);
  while (match !== null) {
    let text = '';
    let tm = tRegex.exec(match[1]);
    while (tm !== null) {
      text += tm[1];
      tm = tRegex.exec(match[1]);
    }
    stringToIdx.set(text, sharedStrings.length);
    sharedStrings.push(text);
    match = siRegex.exec(sstXml);
  }

  function getStringIdx(s: string): number {
    if (!stringToIdx.has(s)) {
      stringToIdx.set(s, sharedStrings.length);
      sharedStrings.push(s);
    }
    return stringToIdx.get(s)!;
  }

  const colStyles: Record<string, string> = {
    A: '9',
    B: '9',
    C: '9',
    D: '10',
    E: '10',
    F: '10',
    G: '10',
    H: '10',
    I: '10',
    J: '10',
    K: '9',
    L: '10',
    M: '10',
    N: '10',
    O: '10',
    P: '9',
    Q: '10',
    R: '10',
    S: '10',
    T: '10',
    U: '9',
    V: '10',
    W: '10',
    X: '10',
    Y: '10',
    Z: '10',
    AA: '10',
    AB: '9',
    AC: '10',
    AD: '11',
    AE: '11',
    AF: '10',
    AG: '9',
    AH: '10',
    AI: '8',
    AJ: '8',
    AK: '8',
  };

  const calcChainCells: string[] = [];
  let rowsXml = '';

  for (let idx = 0; idx < rowsData.length; idx++) {
    const rowIdx = idx + 2;
    const rdata: any = rowsData[idx];
    rowsXml += `<row r="${rowIdx}" spans="1:37" x14ac:dyDescent="0.3">`;

    for (let cIdx = 0; cIdx < COLUMN_LETTERS.length; cIdx++) {
      const colLet = COLUMN_LETTERS[cIdx];
      const colName = COLUMN_NAMES[cIdx];
      const cellRef = `${colLet}${rowIdx}`;
      const sStyle = colStyles[colLet] || '10';
      const val = rdata[colLet] ?? rdata[colName];

      if (colLet === 'O') {
        if (rdata.SQCUnit === 'KGS') {
          rowsXml += `<c r="${cellRef}" s="${sStyle}"><v>${val ?? ''}</v></c>`;
        } else {
          rowsXml += `<c r="${cellRef}" s="${sStyle}"><f>M${rowIdx}</f><v>${val ?? ''}</v></c>`;
          calcChainCells.push(cellRef);
        }
      } else if (colLet === 'R') {
        rowsXml += `<c r="${cellRef}" s="${sStyle}"><f>M${rowIdx}*Q${rowIdx}</f><v>${val ?? ''}</v></c>`;
        calcChainCells.push(cellRef);
      } else if (colLet === 'T') {
        rowsXml += `<c r="${cellRef}" s="${sStyle}" t="str"><f>N${rowIdx}</f><v>${val ?? ''}</v></c>`;
        calcChainCells.push(cellRef);
      } else if (colLet === 'V') {
        rowsXml += `<c r="${cellRef}" s="${sStyle}"><f>M${rowIdx}</f><v>${val ?? ''}</v></c>`;
        calcChainCells.push(cellRef);
      } else if (colLet === 'X') {
        rowsXml += `<c r="${cellRef}" s="${sStyle}" t="str"><f>N${rowIdx}</f><v>${val ?? ''}</v></c>`;
        calcChainCells.push(cellRef);
      } else if (colLet === 'AK') {
        if (rdata.SQCUnit === 'KGS') {
          rowsXml += `<c r="${cellRef}" s="${sStyle}"><v>${val ?? ''}</v></c>`;
        } else {
          rowsXml += `<c r="${cellRef}" s="${sStyle}"><f>O${rowIdx}</f><v>${val ?? ''}</v></c>`;
          calcChainCells.push(cellRef);
        }
      } else if (
        val !== null &&
        val !== undefined &&
        String(val).trim() !== ''
      ) {
        const sval = String(val).trim();
        if (
          [
            'C',
            'D',
            'E',
            'I',
            'J',
            'L',
            'N',
            'P',
            'U',
            'Y',
            'Z',
            'AA',
            'AB',
            'AC',
            'AD',
            'AE',
            'AJ',
          ].includes(colLet)
        ) {
          const sIdx = getStringIdx(sval);
          rowsXml += `<c r="${cellRef}" s="${sStyle}" t="s"><v>${sIdx}</v></c>`;
        } else {
          rowsXml += `<c r="${cellRef}" s="${sStyle}"><v>${sval}</v></c>`;
        }
      } else {
        rowsXml += `<c r="${cellRef}" s="${sStyle}"/>`;
      }
    }
    rowsXml += '</row>';
  }

  let sheet1Xml = await zip.file('xl/worksheets/sheet1.xml')!.async('text');
  sheet1Xml = sheet1Xml.replace(
    /<dimension ref="[^"]*"\/>/,
    `<dimension ref="A1:AK${rowsData.length + 1}"/>`,
  );

  const headerRowMatch = sheet1Xml.match(/<row r="1"[^>]*>.*?<\/row>/s);
  const headerRowXml = headerRowMatch ? headerRowMatch[0] : '';
  sheet1Xml = sheet1Xml.replace(
    /<sheetData>.*?<\/sheetData>/s,
    `<sheetData>${headerRowXml}${rowsXml}</sheetData>`,
  );

  let newSstXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
  newSstXml += `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">`;
  for (const s of sharedStrings) {
    const esc = s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    const spacePreserve =
      s.startsWith(' ') || s.endsWith(' ') ? ' xml:space="preserve"' : '';
    newSstXml += `<si><t${spacePreserve}>${esc}</t></si>`;
  }
  newSstXml += '</sst>';

  let newCcXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
  newCcXml +=
    '<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  for (const cRef of calcChainCells) {
    newCcXml += `<c r="${cRef}" i="1"/>`;
  }
  newCcXml += '</calcChain>';

  zip.file('xl/worksheets/sheet1.xml', sheet1Xml);
  zip.file('xl/sharedStrings.xml', newSstXml);
  zip.file('xl/calcChain.xml', newCcXml);

  const outBuf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });
  await writeFile(outputPath, outBuf);

  return { status: 'ok', output: outputPath, items: rowsData.length };
}

export async function generateProductExcel(
  sourcePath: string,
  templatePath: string,
  outputPath: string,
  rules?: any,
): Promise<{ status: string; output: string; items: number }> {
  const reconciled = await reconcileProducts(sourcePath, rules);
  return writeProductExcelTemplate(reconciled.items, templatePath, outputPath);
}

export async function buildProductsFromExtracted(
  extractedData: any,
  manifestData?: any,
  rules?: any,
): Promise<ReconciledProducts> {
  const comp = { ...config.compliance, ...(rules || {}) };
  const instructions = manifestData?.instructions || {};
  const rawInvNo =
    instructions['invoice[0].invoice.number'] ||
    extractedData.invoices?.[0]?.['invoice.number']?.value ||
    extractedData.invoices?.[0]?.['number']?.value ||
    '';
  const invNo = String(rawInvNo).replace(/\s/g, '');

  const dutyCache = new Map<string, any>();
  for (let idx = 0; idx < (extractedData.products || []).length; idx++) {
    const p = extractedData.products[idx];
    const f = p.fields || {};
    const instKey = `product[${idx}].RITCCode`;
    const rawRitc =
      instructions[instKey] ||
      (f.RITCCode?.value !== null && f.RITCCode?.value !== undefined
        ? String(f.RITCCode.value)
        : comp.ritc_code);
    const cleanRitc = String(rawRitc || '').trim();
    if (cleanRitc && !dutyCache.has(cleanRitc)) {
      try {
        const info = await fetchDutyExportStructure(cleanRitc);
        dutyCache.set(cleanRitc, info);
      } catch {
        dutyCache.set(cleanRitc, null);
      }
    }
  }

  const items: any[] = (extractedData.products || []).map(
    (p: any, idx: number) => {
      const f = p.fields || {};
      const getVal = (col: string, fallback: any) => {
        const instKey = `product[${idx}].${col}`;
        if (instructions[instKey] !== undefined) return instructions[instKey];
        if (f[col]?.value !== null && f[col]?.value !== undefined)
          return String(f[col].value);
        return fallback;
      };

      const qty = getVal('Quantity', '1');
      const unitPrice = getVal('UnitPrice', '0');
      const amt = getVal(
        'ProductAmount',
        (Number(qty) * Number(unitPrice)).toFixed(2),
      );

      const ritc = getVal('RITCCode', comp.ritc_code);
      const cleanRitc = String(ritc || '').trim();
      const dutyInfo = dutyCache.get(cleanRitc) || null;
      const isChapter94 = cleanRitc.startsWith('94');

      const origDesc = getVal('Description', '');
      let materials: { name: string; weight?: number; percentage?: number }[] =
        [];
      if (Array.isArray(p.materials)) {
        materials = p.materials;
      } else if (Array.isArray(p._materials)) {
        materials = p._materials;
      } else if (Array.isArray(f.materials?.value)) {
        materials = f.materials.value;
      } else if (typeof f.Material?.value === 'string') {
        const matMatches = Array.from(
          f.Material.value.matchAll(
            /(?:Net\s+Wt\s+)?([A-Za-z]+)\s*[:\s]\s*(\d+(?:\.\d+)?)/gi,
          ),
        );
        materials = matMatches.map((m: any) => ({
          name: m[1].toUpperCase(),
          weight: parseFloat(m[2]),
        }));
      }

      let isArtware = rules?.is_artware;
      if (isArtware === undefined) {
        if (
          rules?.goods_type === 'industrial' ||
          comp.goods_type === 'industrial'
        ) {
          isArtware = false;
        } else if (
          /^(?:84|85|87|90)/.test(cleanRitc) &&
          materials.length === 0 &&
          !/ARTWARE|HANDICRAFT/i.test(origDesc)
        ) {
          isArtware = false;
        } else {
          isArtware = true;
        }
      }

      const standardizedDesc = standardizeProductDescription(
        materials,
        origDesc,
        rules?.artware_prefix_template,
        isArtware,
      );

      const resolvedSqcUnit = getVal(
        'SQCUnit',
        dutyInfo?.standardUqc || comp.sqc_unit || 'NOS',
      );

      const rawNetWeight =
        f.NetWeight?.value !== null && f.NetWeight?.value !== undefined
          ? f.NetWeight.value
          : p.net_weight !== undefined
            ? p.net_weight
            : p._net_weight !== undefined
              ? p._net_weight
              : null;
      const netWeight =
        rawNetWeight !== null && rawNetWeight !== undefined
          ? String(rawNetWeight).trim()
          : null;

      let defaultSqcQty = qty;
      if (resolvedSqcUnit === 'KGS' && netWeight) {
        defaultSqcQty = netWeight;
      }
      const resolvedSqcQty = getVal('SQCQTY', defaultSqcQty);

      const rodtepVal = getVal(
        'RODTEP',
        dutyInfo?.rodtepRate ? 'Y' : comp.rodtep || 'Y',
      );
      let defaultRodtepQty = qty;
      if (
        (dutyInfo?.rodtepUqc === 'KGS' || resolvedSqcUnit === 'KGS') &&
        netWeight
      ) {
        defaultRodtepQty = netWeight;
      }
      const resolvedRodtepQty = getVal('RoDTEPQty', defaultRodtepQty);

      const itemDbk = resolveBestDbk(dutyInfo?.dbkEntries, origDesc);
      const drawbackSch = getVal(
        'drawback_schno',
        itemDbk?.ActualDBK_SERNo?.trim() ||
          dutyInfo?.dbkScheduleNo ||
          (isChapter94 ? comp.drawback_schno : null),
      );
      const dbkRate = drawbackSch
        ? getVal(
            'dbk_rate',
            itemDbk?.ActualDBKRate?.trim() ||
              dutyInfo?.dbkRate ||
              comp.dbk_rate,
          )
        : null;
      const dbkQty = drawbackSch ? getVal('dbk_qty', qty) : null;
      const dbkUnit = drawbackSch
        ? getVal(
            'dbk_unit',
            itemDbk?.ActualUnit?.trim() ||
              dutyInfo?.dbkUnit ||
              comp.dbk_unit ||
              'PCS',
          )
        : null;
      const dbkDesc = drawbackSch
        ? getVal(
            'dbk_desc',
            itemDbk?.ActualDBK_Desc?.trim() || dutyInfo?.dbkDesc || null,
          )
        : null;

      let defaultScheme = comp.scheme;
      if (drawbackSch) {
        defaultScheme = '19';
      }
      let scheme = getVal('ApplicableExpSchemes', defaultScheme);
      if (typeof scheme === 'string' && scheme.includes('-')) {
        scheme = scheme.split('-')[0].trim();
      }

      const destCountry = getVal(
        'CountryDestination',
        instructions['shipment.destinationCountry'] || comp.country_destination,
      );
      const ftaCode = getVal(
        'FTACode',
        comp.fta_code && destCountry === comp.country_destination
          ? comp.fta_code
          : null,
      );

      const totalShipmentPackages =
        extractedData.fields?.['shipment.packages']?.value ||
        extractedData.shipment?.fields?.['shipment.packages']?.value ||
        instructions['shipment.packages'] ||
        null;
      const totalPkg = getVal(
        'Total_Package',
        (extractedData.products?.length ?? 0) <= 1
          ? totalShipmentPackages
          : null,
      );

      const taxableVal = getVal(
        'Taxable_Value',
        rules?.taxable_value !== undefined ? rules.taxable_value : null,
      );

      return {
        InvoiceSNo: String((p.invoiceIndex ?? 0) + 1),
        ItemSNo: String(idx + 1),
        InvoiceNo: invNo,
        Description: standardizedDesc,
        EndUse: getVal('EndUse', comp.end_use),
        HAWBL_NO: getVal('HAWBL_NO', null),
        Total_Package: totalPkg,
        Accessories: getVal('Accessories', null),
        RewardItem: getVal('RewardItem', comp.reward_item),
        IGST_PaymentStatus: getVal('IGST_PaymentStatus', comp.payment_status),
        RITCCode: ritc,
        ApplicableExpSchemes: scheme,
        Quantity: qty,
        QuantityUnit: getVal('QuantityUnit', comp.quantity_unit),
        SQCQTY: resolvedSqcQty,
        SQCUnit: resolvedSqcUnit,
        UnitPrice: unitPrice,
        ProductAmount: amt,
        Per: getVal('Per', comp.per),
        PerUnit: getVal('PerUnit', getVal('QuantityUnit', comp.per_unit)),
        drawback_schno: drawbackSch,
        dbk_qty: dbkQty,
        dbk_rate: dbkRate,
        dbk_unit: dbkUnit,
        dbk_desc: dbkDesc,
        ROSLRate: getVal('ROSLRate', null),
        ROSLCapValue: getVal('ROSLCapValue', null),
        CountryDestination: destCountry,
        FTACode: ftaCode,
        StateOrigin: getVal(
          'StateOrigin',
          instructions['general.stateOrigin'] || comp.state_origin,
        ),
        DistrictOrigin: getVal('DistrictOrigin', comp.district_origin),
        Taxable_Value: taxableVal,
        IGST_Rate: getVal('IGST_Rate', comp.igst_rate),
        IGST_Amount: getVal('IGST_Amount', comp.igst_amount),
        GSTCCessAmount: getVal('GSTCCessAmount', null),
        RODTEP: rodtepVal,
        RoDTEPQty: resolvedRodtepQty,
      };
    },
  );

  const totalQty = items.reduce((sum, i) => sum + Number(i.Quantity || 0), 0);
  const totalAmt = items.reduce(
    (sum, i) => sum + Number(i.ProductAmount || 0),
    0,
  );

  return ReconciledProductsSchema.parse({
    invoice_no: invNo,
    items,
    total_items: items.length,
    total_quantity: totalQty,
    total_cartons: 0,
    total_amount: Math.round(totalAmt * 100) / 100,
    total_net_weight: 0,
  });
}

export async function processProductsFolder(
  folderPath: string,
  outputPath?: string,
  rules?: any,
): Promise<ReconciledProducts> {
  const folder = resolve(folderPath);
  const files = await readdir(folder);
  const excelFiles = files.filter(
    (f) =>
      f.toLowerCase().endsWith('.xlsx') || f.toLowerCase().endsWith('.xls'),
  );

  let sourceXlsx: string | null = null;
  for (const f of excelFiles) {
    const fUp = f.toUpperCase();
    if (
      fUp.includes('INVOICE') &&
      fUp.includes('PACKING') &&
      !fUp.includes('PRODUCTFORMAT')
    ) {
      sourceXlsx = resolve(folder, f);
      break;
    }
  }
  if (!sourceXlsx) {
    for (const f of excelFiles) {
      const fUp = f.toUpperCase();
      if (
        (fUp.includes('INVOICE') || fUp.includes('PACKING')) &&
        !fUp.includes('PRODUCTFORMAT')
      ) {
        sourceXlsx = resolve(folder, f);
        break;
      }
    }
  }
  if (!sourceXlsx) {
    for (const f of excelFiles) {
      if (!f.toUpperCase().includes('PRODUCTFORMAT')) {
        sourceXlsx = resolve(folder, f);
        break;
      }
    }
  }

  let templateXlsx: string | null = null;
  for (const f of excelFiles) {
    if (f.toUpperCase() === 'PRODUCTFORMAT.XLSX') {
      templateXlsx = resolve(folder, f);
      break;
    }
  }
  if (!templateXlsx) {
    for (const cand of [
      resolve('templates/ProductFormat.xlsx'),
      resolve('tests/fixtures/products/ProductFormat.xlsx'),
      resolve(folder, 'ProductFormat.xlsx'),
    ]) {
      if (existsSync(cand)) {
        templateXlsx = cand;
        break;
      }
    }
  }

  if (!sourceXlsx) {
    const extPath = resolve(folder, 'extracted.json');
    if (existsSync(extPath)) {
      try {
        const extData = JSON.parse(await readFile(extPath, 'utf-8'));
        if (Array.isArray(extData.products) && extData.products.length > 0) {
          let manData: any = null;
          const manPath = resolve(folder, 'manifest.json');
          if (existsSync(manPath)) {
            try {
              manData = JSON.parse(await readFile(manPath, 'utf-8'));
            } catch {}
          }
          const reconciled = await buildProductsFromExtracted(
            extData,
            manData,
            rules,
          );
          if (outputPath && templateXlsx) {
            await writeProductExcelTemplate(
              reconciled.items,
              templateXlsx,
              outputPath,
            );
          }
          return reconciled;
        }
      } catch (err: any) {
        console.warn(
          `Could not load products from extracted.json: ${err.message}`,
        );
      }
    }
    throw new Error(
      `No commercial invoice / packing spreadsheet found in ${folder}. PDF/scanned documents require operator or AI interpretation per prompt.md to populate ProductFormat.xlsx.`,
    );
  }

  const reconciled = await reconcileProducts(sourceXlsx, rules);
  if (outputPath && templateXlsx) {
    await writeProductExcelTemplate(reconciled.items, templateXlsx, outputPath);
  }
  return reconciled;
}
