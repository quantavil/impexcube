# ImpexCube field policy specification

This is the authoritative business policy. `src/policy/fields.ts` implements it.

- Fixed / Default always wins, including blank, zero and false. Document disagreements produce a short warning.
- System Locked means no automation write, even when the native control is technically editable.
- Doc Only uses current evidence/instructions. Doc -> Past Fallback uses current first, then previous. Unavailable values stay empty with a short warning.
- `-` in the default column means empty; it is not a literal hyphen. Fixed unchecked flags mean false.
- Customs city/house resolve the shipment folder code against the live site master.
- Numbered Packing From/To/Unit stay empty; no numbered packing row is added. Total Packages and Package Unit are separate document values.
- Current documents determine invoice identities/count; old invoice count never changes source selection.
- Auxiliary controls below have no inspected native mapping yet. They are reported as unsupported and are not written.

## Section: General Details [AUTOMATED]

| Field Name & ID | Review Status | Rule Selected | Default Value | Remarks & Notes |
|---|:---:|:---:|:---:|---|
| **Shipment Mode**<br/>`general.mode` | ✅ Reviewed | **⚙️ Fixed/Default** | `Land ICD` | Standard default mode: Land ICD |
| **Customs City**<br/>`general.customCity` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Pick From Folder Name |
| **Custom House / POL Port Code**<br/>`general.customHouse` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Pick From Folder Name |
| **Job Received Date**<br/>`general.jobDate` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **Shipping Bill Number**<br/>`general.sbNumber` | ✅ Reviewed | **⚙️ Fixed/Default** | `0` | - |
| **Shipping Bill Date**<br/>`general.sbDate` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | - |
| **Shipping Bill Heading**<br/>`general.heading` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | - |
| **Dock Number**<br/>`general.dockNo` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | - |
| **Exporter Name**<br/>`general.exporter` | ✅ Reviewed | **🔄 Doc -> Past Fallback** | `-` | - |
| **IEC Code Number**<br/>`general.iec` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **Exporter Registered Address**<br/>`general.exporterAddress` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **GSTIN Registration No**<br/>`general.gst` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **Exporter Category (Merchant / Manufacturer)**<br/>`general.category` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **Exporter Class (Govt / Private)**<br/>`general.class` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **AD Code / Bank Dealer Code**<br/>`general.adCode` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **IEC Branch Code**<br/>`general.iecBranch` | ✅ Reviewed | **🔄 Doc -> Past Fallback** | `-` | - |
| **Exporter Invoice / Reference No**<br/>`general.reference` | ✅ Reviewed | **📄 Doc Only** | `-` | Invoice Number |
| **Exporter Reference Date**<br/>`general.referenceDate` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **Consignee Name**<br/>`general.consignee` | ✅ Reviewed | **📄 Doc Only** | `-` | - |
| **Consignee Full Address**<br/>`general.consigneeAddress` | ✅ Reviewed | **📄 Doc Only** | `-` | - |
| **Consignee Destination Country**<br/>`general.consigneeCountry` | ✅ Reviewed | **📄 Doc Only** | `-` | - |
| **Is Buyer Different from Consignee?**<br/>`general.buyerDifferent` | ✅ Reviewed | **📄 Doc Only** | `-` | Conditional on general.buyerDifferent |
| **Buyer Name (when different)**<br/>`general.buyer` | ✅ Reviewed | **📄 Doc Only** | `-` | Conditional on general.buyerDifferent |
| **Buyer Address (when different)**<br/>`general.buyerAddress` | ✅ Reviewed | **📄 Doc Only** | `-` | Conditional on general.buyerDifferent |
| **Buyer Country (when different)**<br/>`general.buyerCountry` | ✅ Reviewed | **📄 Doc Only** | `-` | Conditional on general.buyerDifferent |
| **State of Origin of Goods**<br/>`general.stateOrigin` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **Assigned Employee Name**<br/>`general.assignedTo` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **MOOWR Scheme Flag**<br/>`general.moowr` | ✅ Reviewed | **🔒 System Locked** | `-` | - |

## Section: Shipment & Ports [AUTOMATED]

| Field Name & ID | Review Status | Rule Selected | Default Value | Remarks & Notes |
|---|:---:|:---:|:---:|---|
| **Final Destination Country**<br/>`shipment.destinationCountry` | ✅ Reviewed | **🔄 Doc -> Past Fallback** | `-` | - |
| **Destination Port (UN/LOCODE)**<br/>`shipment.destinationPort` | ✅ Reviewed | **🔄 Doc -> Past Fallback** | `-` | - |
| **Port of Discharge Country**<br/>`shipment.dischargeCountry` | ✅ Reviewed | **🔄 Doc -> Past Fallback** | `-` | - |
| **Port of Discharge (UN/LOCODE)**<br/>`shipment.dischargePort` | ✅ Reviewed | **🔄 Doc -> Past Fallback** | `-` | - |
| **Total Packages / Cartons**<br/>`shipment.packages` | ✅ Reviewed | **📄 Doc Only** | `-` | - |
| **Package Unit (CTN, BOX, PKG)**<br/>`shipment.packageUnit` | ✅ Reviewed | **📄 Doc Only** | `-` | - |
| **Total Gross Weight**<br/>`shipment.grossWeight` | ✅ Reviewed | **📄 Doc Only** | `-` | - |
| **Gross Weight Unit (KGS, LBS)**<br/>`shipment.grossUnit` | ✅ Reviewed | **📄 Doc Only** | `KGS` when unavailable | Explicit current unit or blank wins; never inherit previous unit. |
| **Total Net Weight**<br/>`shipment.netWeight` | ✅ Reviewed | **📄 Doc Only** | `-` | - |
| **Net Weight Unit (KGS, LBS)**<br/>`shipment.netUnit` | ✅ Reviewed | **📄 Doc Only** | `KGS` when unavailable | Explicit current unit or blank wins; never inherit previous unit. |
| **Marks & Numbers Declaration**<br/>`shipment.marks` | ✅ Reviewed | **🔄 Doc -> Past Fallback** | `-` | By default retain previous declarations (including RODTEP/LUT) and update only a recognized package range or TOTAL count from current range/total evidence. Cartons, CTN, packages, PKG and boxes are equivalent package labels; never reinterpret pieces or declaration identifiers. Preserve formatting and leading zeros. Current range cardinality must agree with the current package total when both exist. Ambiguous/multiple ranges require complete instructions; explicit complete instructions or blanks override. |
| **Marks Scheme (None, ROSCTL, etc.)**<br/>`shipment.marksType` | ✅ Reviewed | **🔄 Doc -> Past Fallback** | `-` | - |
| **Nature of Cargo (Container / Bulk)**<br/>`shipment.cargoNature` | ✅ Reviewed | **⚙️ Fixed/Default** | `C-Containerized Cargo` | - |
| **Number of Containers**<br/>`shipment.containerCount` | ✅ Reviewed | **🔄 Doc -> Past Fallback** | `-` | - |
| **Seal Type**<br/>`shipment.sealType` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **Annexure Attached Flag**<br/>`shipment.annexure` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **Loose Packages Count**<br/>`shipment.loosePackages` | ✅ Reviewed | **⚙️ Fixed/Default** | `0` | - |
| **Master Bill of Lading (MBL) No**<br/>`shipment.mbl` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Master B/L issued after vessel load; kept empty at filing |
| **MBL Date**<br/>`shipment.mblDate` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Master B/L date; kept empty |
| **House Bill of Lading (HBL) No**<br/>`shipment.hbl` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | House B/L; kept empty at filing |
| **HBL Date**<br/>`shipment.hblDate` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | House B/L date; kept empty |
| **Vessel Rotation No**<br/>`shipment.rotation` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Post-filing EGM rotation; kept empty at SB draft creation |
| **Rotation Date**<br/>`shipment.rotationDate` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Post-filing EGM rotation date; kept empty |
| **Vessel Sailing Date**<br/>`shipment.sailingDate` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Actual vessel sailing date; kept empty at SB filing |
| **Shipping Line / Carrier Name**<br/>`shipment.shippingLine` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Carrier shipping line; fixed empty |
| **Pre-Carriage By**<br/>`shipment.preCarriage` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Pre-carriage mode; empty by default |
| **Place of Receipt by Pre-Carrier**<br/>`shipment.receipt` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Place of receipt by pre-carrier; empty by default |
| **Vessel Voyage No**<br/>`shipment.voyage` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Vessel voyage; empty at draft filing |
| **Vessel Date**<br/>`shipment.vesselDate` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Vessel date; empty at draft filing |
| **CFS Name / Container Freight Station**<br/>`shipment.cfs` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Container Freight Station (CFS); empty by default |
| **Cargo Volume (CBM)**<br/>`shipment.volume` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Cargo volume (CBM); fixed empty |
| **Estimated Time of Arrival (ETA)**<br/>`shipment.eta` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Estimated arrival date (ETA); empty at filing |
| **Estimated Time of Departure (ETD)**<br/>`shipment.etd` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Estimated departure date (ETD); empty at filing |
| **Liner / Forwarder Name**<br/>`shipment.liner` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Liner / forwarder name; empty by default |
| **Cargo Received Date**<br/>`shipment.cargoReceived` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Cargo arrival date; empty at SB filing |
| **Customs Formality Date**<br/>`shipment.customsFormality` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Customs formality date; empty at SB filing |
| **Factory Stuffed Indicator**<br/>`shipment.factoryStuffed` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Goods Stuffed At Factory; unchecked/false by default |
| **Sample Accompanied Flag**<br/>`shipment.sample` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Sample Accompanied flag; unchecked/false by default |
| **Factory Address**<br/>`shipment.factoryAddress` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Factory address; empty when not factory stuffed |
| **Inspection / Survey Agency Name**<br/>`shipment.agency` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Inspection / survey agency name; empty by default |
| **Numbered Packing Box From**<br/>`shipment.packingFrom` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | - |
| **Numbered Packing Box To**<br/>`shipment.packingTo` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | - |
| **Numbered Packing Box Unit**<br/>`shipment.packingUnit` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | - |

## Section: Invoice Header [AUTOMATED]

| Field Name & ID | Review Status | Rule Selected | Default Value | Remarks & Notes |
|---|:---:|:---:|:---:|---|
| **Commercial Invoice Number**<br/>`invoice.number` | ✅ Reviewed | **📄 Doc Only** | `-` | - |
| **Invoice Date**<br/>`invoice.date` | ✅ Reviewed | **📄 Doc Only** | `-` | - |
| **Invoice Currency Code (USD, EUR, INR)**<br/>`invoice.currency` | ✅ Reviewed | **📄 Doc Only** | `-` | always click update |
| **Total Invoice Foreign Amount**<br/>`invoice.amount` | ✅ Reviewed | **📄 Doc Only** | `-` | - |
| **Incoterms (FOB, CIF, CFR, DAP, EXW)**<br/>`invoice.terms` | ✅ Reviewed | **🔄 Doc -> Past Fallback** | `-` | - |
| **Payment Terms (DP, DA, LC, Advance)**<br/>`invoice.payment` | ✅ Reviewed | **🔄 Doc -> Past Fallback** | `-` | - |
| **Payment Period / Credit Days**<br/>`invoice.period` | ✅ Reviewed | **🔄 Doc -> Past Fallback** | `-` | - |
| **Buyer Purchase Order (PO) No**<br/>`invoice.po` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | - |
| **Buyer PO Date**<br/>`invoice.poDate` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | - |
| **Export Contract No**<br/>`invoice.contract` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | - |
| **Export Contract Date**<br/>`invoice.contractDate` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | - |
| **Bank Exchange Rate (Customs Tariff)**<br/>`invoice.exchangeRate` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **Total Invoice Amount in INR**<br/>`invoice.amountINR` | ✅ Reviewed | **🔒 System Locked** | `-` | - |

## Section: Charges / F&I [AUTOMATED]

| Field Name & ID | Review Status | Rule Selected | Default Value | Remarks & Notes |
|---|:---:|:---:|:---:|---|
| **Freight Charge Amount**<br/>`charges.freight` | ✅ Reviewed | **🔄 Doc -> Past Fallback** | `-` | - |
| **Freight Currency**<br/>`charges.freightCurrency` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **Insurance Charge Amount**<br/>`charges.insurance` | ✅ Reviewed | **🔄 Doc -> Past Fallback** | `-` | - |
| **Insurance Currency**<br/>`charges.insuranceCurrency` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **Insurance Percentage Rate**<br/>`charges.insuranceRate` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **Discount Amount**<br/>`charges.discount` | ✅ Reviewed | **📄 Doc Only** | `-` | - |
| **Discount Currency**<br/>`charges.discountCurrency` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **Discount Percentage Rate**<br/>`charges.discountRate` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **Commission Amount**<br/>`charges.commission` | ✅ Reviewed | **📄 Doc Only** | `-` | - |
| **Commission Currency**<br/>`charges.commissionCurrency` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **Commission Percentage Rate**<br/>`charges.commissionRate` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **Other Deduction Amount**<br/>`charges.deduction` | ✅ Reviewed | **📄 Doc Only** | `-` | - |
| **Other Deduction Currency**<br/>`charges.deductionCurrency` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **Other Deduction Rate**<br/>`charges.deductionRate` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **Packing Charge Amount**<br/>`charges.packing` | ✅ Reviewed | **📄 Doc Only** | `-` | - |
| **Packing Currency**<br/>`charges.packingCurrency` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **Unit Price Includes (FOB, Freight, Insurance, Both)**<br/>`charges.unitIncludes` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **IGST Calculation Basis**<br/>`charges.igstBasis` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **PMV (Market Value) Basis**<br/>`charges.pmvBasis` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **Taxable Value on LUT Basis**<br/>`charges.taxableLut` | ✅ Reviewed | **🔒 System Locked** | `-` | - |

## Section: Third Party / Notify [AUTOMATED]

| Field Name & ID | Review Status | Rule Selected | Default Value | Remarks & Notes |
|---|:---:|:---:|:---:|---|
| **Third Party / Notify Party Name**<br/>`thirdParty.name` | ✅ Reviewed | **📄 Doc Only** | `-` | - |
| **Address Line 1**<br/>`thirdParty.address1` | ✅ Reviewed | **📄 Doc Only** | `-` | - |
| **Address Line 2**<br/>`thirdParty.address2` | ✅ Reviewed | **📄 Doc Only** | `-` | - |
| **State / Province / Sub-division**<br/>`thirdParty.subdivision` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | - |
| **City**<br/>`thirdParty.city` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | - |
| **Postal / Zip Code**<br/>`thirdParty.pin` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | - |
| **Country Code**<br/>`thirdParty.country` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **AEO Certificate Operator Code**<br/>`thirdParty.aeoCode` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | - |
| **AEO Country**<br/>`thirdParty.aeoCountry` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | - |
| **AEO Operator Role**<br/>`thirdParty.aeoRole` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | - |
| **Place of Delivery / Terms Location**<br/>`thirdParty.termsPlace` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | - |

## Section: Auxiliary Portal Controls [AUTOMATED]

| Field Name & ID | Review Status | Rule Selected | Default Value | Remarks & Notes |
|---|:---:|:---:|:---:|---|
| **Flight Number (for Air shipments)**<br/>`shipment.flightNo` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Flight number; Air mode only, empty for ICD/Sea |
| **Flight Date (for Air shipments)**<br/>`shipment.flightDate` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | Flight date; Air mode only, empty for ICD/Sea |
| **ICEGATE Id / CHA Number**<br/>`general.chaNo` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **Filing Mode (Online / Manual / E-mail)**<br/>`general.filingMode` | ✅ Reviewed | **⚙️ Fixed/Default** | `Online` | Filing mode: Online submission |
| **Shipping Bill Type (Normal / Ex-Bond)**<br/>`general.sbType` | ✅ Reviewed | **⚙️ Fixed/Default** | `Normal` | Shipping bill type: Normal (N) |
| **Forex AC / EPZ Code**<br/>`general.epzCode` | ✅ Reviewed | **🔒 System Locked** | `-` | - |
| **RBI Waiver Number & Date**<br/>`general.rbiWaiver` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | - |
| **Final Invoice No & Value (Provisional)**<br/>`invoice.finalInv` | ✅ Reviewed | **⚙️ Fixed/Default** | `-` | - |

