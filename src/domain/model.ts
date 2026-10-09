import type { z } from 'zod';
import type {
  ContextSchema,
  DocumentSchema,
  EvidenceSchema,
  FieldSchema,
  IssueSchema,
  ManifestSchema,
  OperationSchema,
  PatchSchema,
  ProductComplianceSchema,
  ProductItemSchema,
  ProductMaterialSchema,
  ReconciledProductsSchema,
  SectionSchema,
  ShipmentSchema,
  SnapshotSchema,
} from './schemas';
export type Context = z.infer<typeof ContextSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Field = z.infer<typeof FieldSchema>;
export type Shipment = z.infer<typeof ShipmentSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
export type Issue = z.infer<typeof IssueSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type Operation = z.infer<typeof OperationSchema>;
export type Patch = z.infer<typeof PatchSchema>;
export type DocumentText = z.infer<typeof DocumentSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type ProductMaterial = z.infer<typeof ProductMaterialSchema>;
export type ProductItem = z.infer<typeof ProductItemSchema>;
export type ReconciledProducts = z.infer<typeof ReconciledProductsSchema>;
export type ProductCompliance = z.infer<typeof ProductComplianceSchema>;
export type Branch = Context['branch'];
export interface Candidate {
  jobNo: string;
  jobDate: string;
  context: Context;
  exporterName: string;
  iec: string | null;
  consigneeName: string;
  cancelled: boolean;
  mode: string;
  customHouse: string;
}
export interface Selection {
  source: Candidate;
  reason: 'same_consignee' | 'exporter_fallback';
}
export const issue = (
  code: string,
  message: string,
  field?: string,
  blocking = true,
): Issue => ({ code, message, field, blocking });
