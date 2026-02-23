/** based on document: Pflege, Technische Anlage 1 für Abrechnung auf maschinell verwertbaren Datenträgern
  * see docs/documents.md for more info
  */

import { LaenderkennzeichenSchluessel } from "./country_codes"
import { KassenartSchluessel } from "./kostentraeger/filename/codes"
import { 
    PflegegradSchluessel,
    RechnungsartSchluessel as RechnungsartSchluesselSGBXI,
    VerarbeitungskennzeichenSchluessel as VerarbeitungskennzeichenSchluesselSGBXI,
} from "./sgb-xi/codes"
import {
    RechnungsartSchluessel as RechnungsartSchluesselSGBV,
    VerarbeitungskennzeichenSchluessel as VerarbeitungskennzeichenSchluesselSGBV,
} from "./sgb-v/codes"
import { Invoice } from "./sgb-xi/types"
import { Einzelrechnung } from "./sgb-v/types"
import { Abrechnungsfall as KrankentransportAbrechnungsfall } from "./sgb-v/krankentransport/types"
import { ValidationError } from "./validation/index"
import { CareProviderLocationSchluessel, Institution as KostentraegerInstitution } from "./kostentraeger/types"
import { Leistungsart } from "./kostentraeger"
import { DatenlieferungsartSchluessel } from "./kostentraeger/edifact/codes"

export type ResultOrErrors<T> = {
    result?: T
    errors?: ValidationError[]
    warnings?: ValidationError[]
}

export type Recipient = {
    kassenart: KassenartSchluessel;
    sendTo: KostentraegerInstitution;
    encryptTo: KostentraegerInstitution;
    certificate: Uint8Array | null;
    papierannahmestellen: Partial<Record<DatenlieferungsartSchluessel, KostentraegerInstitution>>;
}
export type InvoicesWithRecipient = {
    invoices: Invoice[];
    recipient: Recipient;
}

export type Transmission = {
    email: Email;
    payloadFile: File;
    instructionFile: File;
    unencryptedPayloadFile: File;
    invoices: Invoice[];
    anwendungsreferenz: string;
    nextRechnungsnummer: number;
    nextBelegnummer: number;
    fileCreationDate: Date;
    datenaustauschreferenz: number;
    laufendeDatenannahmeImJahr: number;
    sender: Institution;
    recipient: Recipient;
    verarbeitungskennzeichen: VerarbeitungskennzeichenSchluessel;
    korrekturlieferung: number | null;
    testIndicator: TestIndicator;
}

export type File = {
    name: string;
    bytes: Uint8Array;
}

export type EmailAddress = {
    name: string;
    address: string;
}

export type Email = {
    from: EmailAddress;
    to: EmailAddress[];
    date: string;
    subject: string;
    body: string;
    attachments: File[];
}

export const testIndicator = {
    "0": "Testdatei",
    "1": "Erprobungsdatei",
    "2": "Echtdatei",
}
export type TestIndicator = keyof typeof testIndicator;

export type RechnungsartSchluessel = RechnungsartSchluesselSGBXI | RechnungsartSchluesselSGBV;

export type VerarbeitungskennzeichenSchluessel = VerarbeitungskennzeichenSchluesselSGBXI | VerarbeitungskennzeichenSchluesselSGBV;

export type BillingData = {
    /** Running number per recipient for each bill transmitted, starting with 1 */
    datenaustauschreferenzJeEmpfaengerIK: Record<string, number>
    /** Indicate whether this bill is a test or if it is real data */
    testIndicator: TestIndicator
    /** Kind of bill, see documentation of RechnungsartSchluessel */
    rechnungsart: RechnungsartSchluessel
    /** How the bill should be processed, see documentation of VerarbeitungskennzeichenSchluessel */
    verarbeitungskennzeichen: VerarbeitungskennzeichenSchluessel
    /** X.509 Certificate including public key, ASN.1 Syntax in DER format */
    senderCertificate: ArrayBuffer
    /** corresponds to public key in senderCertificate, PKCS8 in DER format */
    senderPrivateKey: ArrayBuffer

    rechnungsnummerprefix: string
    nextRechnungsnummer: number
    belegnummerprefix?: string
    nextBelegnummer: number
    /** An ascending number indicating a correction of an earlier version of this same bill.
     *  0 or undefined if this is not a correction. */
    korrekturlieferung?: number
    /** Mandatory if rechnungsart is "2" or "3" as it becomes the sender, but not for rechnungsart == "1" */
    abrechnungsstelle?: Institution
    /** Running number per recipient and per year for each file transmitted, starting with 1 */
    laufendeDatenannahmeImJahrJeEmpfaengerIK: Record<string, number>
}

export type Institution = {
    name: string
    ik: string
    ansprechpartner: Ansprechpartner[]
    email: string
}

export type Ansprechpartner = {
    name: string
    phone: string | null
}

export type Versicherter = {
    krankenkasseIK: string
    /** Mandatory if known. If not known, full address must be specified.
     *  On prescription or health insurance card listed in field "Versicherten-Nr." */
    versichertennummer: string | null
    /** Mandatory if known when billing with SGB V. If not known, full address must be specified.
     *  On prescription, listed in field "Status" */
    versichertenstatus: string | null
    /** Mandatory for billing with SGB XI */
    pflegegrad: Pflegegrad[],
    /** first names longer than 30 characters (SGB V) or 45 characters (SGB XI) will be cut off. */
    firstName: string
    /** last names longer than 47 characters (SGB V) or 45 characters (SGB XI) will be cut off. */
    lastName: string
    birthday: Date
    /** Mandatory if the versichertennummer or versichertenstatus is not known */
    address: Address | null
}

export type Pflegegrad = {
    value: PflegegradSchluessel | "",
    since: Date,
}

export type Address = {
    /** street + housenumber longer than 30 characters (SGB V) will be cut off.
     *  For SGB XI, streets longer than 46 characters will be cut off. */
    street: string | null
    /** housenumbers longer than 9 characters will be cut off (SGB XI) */
    houseNumber: string | null
    /** Postal codes longer than 7 characters (SGB V) or 10 characters (SGB XI) will be cut off. */
    postalCode: string | null
    /** City names longer than 25 characters (SGB V) or 40 characters (SGB XI) will be cut off. */
    city: string | null
    /** to be specified if the country is not Germany. Ignored for SGB XI */
    countryCode: LaenderkennzeichenSchluessel | null
}

export type Amounts = {
    /** = sum of all(rechnungsbetrag + zuzahlungsbetrag + beihilfebetrag + mwst) */
    gesamtbruttobetrag: number
    /** max. bis zum Höchstleistungsanspruch */
    rechnungsbetrag: number // 
    /** = sum of all(zuzahlungen + eigenanteil)
     * 
     * bei Pflegehilfsmitteln oder wenn Bruttobetrag über Höchstleistungsanspruch liegt */
    zuzahlungsbetrag: number
    /** gem. §28 Abs. 2 SGB XI */
    beihilfebetrag: number
    mehrwertsteuerbetrag: number
}

export type SGBVKrankentransportInvoice = {
    rechnung: Einzelrechnung
    abrechnungsfaelle: KrankentransportAbrechnungsfall[]
}

export type SGBVKrankentransportInvoiceWithRecipient = SGBVKrankentransportInvoice & {
    recipient: Recipient
}

export type SGBVKrankentransportTransmission = {
    email: Email
    payloadFile: File
    instructionFile: File
    unencryptedPayloadFile: File
    abrechnungsfaelle: KrankentransportAbrechnungsfall[]
    anwendungsreferenz: string
    fileCreationDate: Date
    datenaustauschreferenz: number
    laufendeDatenannahmeImJahr: number
    sender: Institution
    recipient: Recipient
    verarbeitungskennzeichen: VerarbeitungskennzeichenSchluessel
    korrekturlieferung: number | null
    testIndicator: TestIndicator
}

/** A method signature implemented by several functions that group invoices by recipient in different ways. */
export type GroupInvoiceByRecipientMethod = (
    invoice: Invoice,
    findRecipient: (
        pflegekasseIK: string,
        leistungsart: Leistungsart,
        location: CareProviderLocationSchluessel,
    ) => {
        key: string,
        recipient?: Recipient,
    }
) => Record<string, { recipient?: Recipient, invoice: Invoice }>;

