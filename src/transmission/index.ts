/** based on document: Pflege, Technische Anlage 1 für Abrechnung auf maschinell verwertbaren Datenträgern
  * see docs/documents.md for more info
  */
 
import { Invoice, Leistungserbringer } from "../sgb-xi/types";
import { ResultOrErrors, Transmission, InvoicesWithRecipient, BillingData, TestIndicator, File, GroupInvoiceByRecipientMethod, Versicherter } from "../types";
import { InstitutionListsIndex } from "../kostentraeger";
import { transliterateRecursively } from "../transcoding";
import { encodeI8, getNonConformingCharactersI8, isEncodableI8, transliterateI8 } from "../transcoding/din66003drv";
import { constraintsForTransmission, constraintsLeistungserbringer, constraintsVersicherter } from "../validation";
import { error, validationByType } from "../validation/utils";
import { ValidationError, ValidationResult } from "../validation/index";
import { signAndEncryptMessage } from "../pki/pkcs";
import writeAuftragsdatei from "../auftrag/writer";
import { billingEmail } from "./email";
import { KassenartSchluessel } from "../kostentraeger/filename/codes";
import { absender, transmissionIdentifiers } from "./utils";
import { makeNutzdaten as makeNutzdatenSGBXI, groupInvoiceByRecipient as groupInvoiceByRecipientSGBXI } from "../sgb-xi";
import { makeAnwendungsreferenz as makeAnwendungsreferenzSGBXI, makeDateiname as makeDateinameSGBXI } from "../sgb-xi/filenames";
import { constraintsInvoice as constraintsInvoiceSGBXI } from "../sgb-xi/validation";

export { findRecipientsForSGBVKrankentransport, createTransmissionSGBVKrankentransport } from "./sgb_v_krankentransport";

/**
 * Group a list of SGB XI invoices by corresponsing recipients. The recipients will be determined from institutionList.
 * An institutionList can be either retrieved from calling `deserializeInstitutionLists` on the 
 * string contents of the file `dist/kostentraeger.min.json` or by calling `await fetchInstitutionLists()`.
 * @param invoices 
 * @param institutionLists 
 * @returns an object with two properties:
 * `invoicesWithRecipient`: a list of recipients together with the corresponding invoices
 * `recipientNotFound`: a list of invoices for which an recipient could not be found. Hopefully an empty list.
 */
export const groupInvoicesByRecipientSGBXI = (
    invoices: Invoice[],
    institutionListsIndex: InstitutionListsIndex,
) => groupInvoicesByRecipient(invoices, institutionListsIndex, groupInvoiceByRecipientSGBXI);

const groupInvoicesByRecipient = (
    invoices: Invoice[],
    institutionListsIndex: InstitutionListsIndex,
    groupInvoiceByRecipient: GroupInvoiceByRecipientMethod,
): {
    invoicesWithRecipient: InvoicesWithRecipient[];
    recipientNotFound: Invoice[];
} => {
    const invoicesByRecipient: Record<string, InvoicesWithRecipient> = {};
    const recipientNotFound: Invoice[] = [];

    invoices.forEach(invoice => {
        const invoiceByRecipient = groupInvoiceByRecipient(invoice, (krankenkasseIK, leistungsart, location) => {
            const result = institutionListsIndex.findForData(krankenkasseIK, leistungsart, location);

            if (result) {
                const { kassenart, sendTo, encryptTo, certificate, papierannahmestellen } = result;
                const recipient = { kassenart, sendTo, encryptTo, certificate, papierannahmestellen };
                const key = kassenart + sendTo.ik + encryptTo.ik; // a combination of these values describes a unique transmission recipient
                return { key, recipient };
            } else {
                return { key: "notFound" };
            }
        });

        Object.entries(invoiceByRecipient).forEach(([key, {recipient, invoice}]) => {
            if (recipient) {
                if (!invoicesByRecipient[key]) {
                    invoicesByRecipient[key] = {
                        recipient,
                        invoices: [invoice],
                    }
                } else {
                    invoicesByRecipient[key].invoices.push(invoice);
                }
            } else {
                recipientNotFound.push(invoice);
            }
        })
    });

    return {
        invoicesWithRecipient: Object.values(invoicesByRecipient),
        recipientNotFound
    }
};


type NutzdatenFactory = (
    billingData: BillingData,
    invoices: Invoice[],
    institutionListsIndex: InstitutionListsIndex,
    senderIK: string,
    recipientIK: string,
    datenaustauschreferenz: number,
    anwendungsreferenz: string,
) => {
    nutzdaten: string,
    invoices: Invoice[],
    nextRechnungsnummer: number,
    nextBelegnummer: number,
};

type DateinameFactory = (
    dateiindikator: TestIndicator,
    transferNumber: number,
) => string;

export type AnwendungsreferenzFactory = (
    billingData: BillingData,
    abrechnungsmonat: Date,
    absenderIK: string,
    kassenart: KassenartSchluessel,
    laufendeDatenannahmeImJahr: number,
) => string;

/**
 * Prepares the transmission of invoices to one recipient.
 * Validates the invoices, restructures them if needed according to GKV documentation,
 * automatically adds invoice numbers and dates and document numbers to invoices if missing,
 * generates a payload file (Nutzdatendatei) and an instruction file (Auftragsdatei), 
 * encodes the files, encrypts and signs the payload file, generates the email parameters and returns
 * them together with the files and the invoices including potential changes.
 * @param invoicesWithRecipient one of the returned invoicesWithRecipient items from `groupInvoicesByRecipientSGBXI` which needs to be called first
 * @param billingData addtional data about the sender and its transmission history
 * @returns an object with either a `result` property, containing the `email` parameters, 
 * the signed and encrypted `payloadFile`, a corresponding and readable `unencryptedPayloadFile` and
 * the instructionFile, or with an `errors` property containing a list of errors. In both cases an
 * additional and optional `warnings` property containing a list of warnings can be present in the
 * return object. Errors should be handled, warnings should be presented to the user as they indicate
 * an implicit modification of the data.
 */
export const createTransmissionSGBXI = async (
    invoicesWithRecipient: InvoicesWithRecipient,
    billingData: BillingData,
    institutionListsIndex: InstitutionListsIndex,
): Promise<ResultOrErrors<Transmission>> => 
    createTransmission(
        invoicesWithRecipient, 
        billingData,
        institutionListsIndex,
        makeNutzdatenSGBXI,
        makeDateinameSGBXI,
        makeAnwendungsreferenzSGBXI,
        constraintsInvoiceSGBXI
    );

const createTransmission = async (
    invoicesWithRecipient: InvoicesWithRecipient,
    billingData: BillingData,
    institutionListsIndex: InstitutionListsIndex,
    makeNutzdaten: NutzdatenFactory,
    makeDateiname: DateinameFactory,
    makeAnwendungsreferenz: AnwendungsreferenzFactory,
    constraintsInvoice: (invoice: Invoice) => ValidationResult[],
): Promise<ResultOrErrors<Transmission>> => {
    let { errors, warnings, transliterated } = await validateAndTransliterateForTransmission(
        billingData, 
        invoicesWithRecipient,
        constraintsInvoice
    );

    if (errors.length) {
        return { errors: errors, warnings: warnings };
    }

    const { recipient } = invoicesWithRecipient;
    const transliteratedInvoices = transliterated.invoicesWithRecipient.invoices;
    const { kassenart, sendTo, encryptTo } = recipient;
    const recipientEmail = sendTo.transmissionEmail || "";
    const sender = absender(billingData, transliteratedInvoices[0]);
    const { testIndicator, korrekturlieferung, verarbeitungskennzeichen } = billingData;
    const month = transliteratedInvoices[0].faelle[0].einsaetze[0].leistungsBeginn;
    const {
        datenaustauschreferenz,
        laufendeDatenannahmeImJahr,
        transferNumber,
    } = transmissionIdentifiers(billingData, encryptTo.ik);
    const filename = makeDateiname(testIndicator, transferNumber);
    const anwendungsreferenz = makeAnwendungsreferenz(
        transliterated.billingData, 
        month,
        sender.ik, 
        kassenart, 
        laufendeDatenannahmeImJahr
    );
    const { nutzdaten, invoices, nextRechnungsnummer, nextBelegnummer } = makeNutzdaten(
        transliterated.billingData, 
        transliteratedInvoices, 
        institutionListsIndex,
        sender.ik, 
        encryptTo.ik,
        datenaustauschreferenz, 
        anwendungsreferenz
    );

    if (!recipientEmail) {
        return cancelWith(error("requiredValueMissing", "recipient.sendTo.transmissionEmail"));
    }

    if (!recipient.certificate) {
        return cancelWith(error("requiredValueMissing", "recipient.certificate"));
    }

    if (!isEncodableI8(nutzdaten)) {
        const invalidCharacters = getNonConformingCharactersI8(nutzdaten).join(" ");
        return cancelWith(error("invalidCharacters", undefined, { invalidCharacters }));
    }

    const unencryptedNutzdaten = encodeI8(nutzdaten);
    let auftragsdaten = "";
    let encryptedNutzdaten = new ArrayBuffer(0);

    try {
        encryptedNutzdaten = await signAndEncryptMessage(
            unencryptedNutzdaten.buffer,
            billingData.senderCertificate,
            billingData.senderPrivateKey,
            recipient.certificate.buffer as ArrayBuffer
        );

        auftragsdaten = writeAuftragsdatei({
            verfahrenKennung: "PFL",
            anwendungsreferenz,
            senderIK: sender.ik,
            encryptedForIK: encryptTo.ik,
            sendToIK: sendTo.ik,
            dateCreated: new Date(),
            dateSent: new Date(),
            unencryptedNutzdatenSizeBytes: unencryptedNutzdaten.length,
            encryptedNutzdatenSizeBytes: encryptedNutzdaten.byteLength,
            isTest: billingData.testIndicator != "2",
            transferNumber,
        });
    } catch (thrownError) {
        return cancelWith(error("throwsError", undefined, undefined, (thrownError as Error)?.message));
    }

    const unencryptedPayloadFile = makeFile(unencryptedNutzdaten, filename);
    const payloadFile = makeFile(new Uint8Array(encryptedNutzdaten), filename);
    const instructionFile = makeFile(encodeI8(auftragsdaten), filename + ".AUF");
    const email = billingEmail(sender, recipientEmail, payloadFile, instructionFile);
    const fileCreationDate = new Date();

    return {
        warnings: warnings,
        result: {
            unencryptedPayloadFile,
            payloadFile,
            instructionFile,
            invoices,
            anwendungsreferenz,
            nextRechnungsnummer,
            nextBelegnummer,
            email,
            fileCreationDate,
            datenaustauschreferenz,
            laufendeDatenannahmeImJahr,
            sender,
            recipient,
            verarbeitungskennzeichen,
            korrekturlieferung: korrekturlieferung || null,
            testIndicator,
        }
    };
};

const makeFile = (bytes: Uint8Array, name: string): File => ({ name, bytes });

const cancelWith = (error: ValidationError): { errors: ValidationError[] } => ({ errors: [error] });


/**
 * Validates the data required for a transmission of invoices to one recipient.
 * @param invoicesWithRecipient one of the returned invoicesWithRecipient items from `groupInvoicesByRecipientSGBXI` which needs to be called first
 * @param billingData addtional data about the sender and its transmission history
 * @returns an object with an `errors` property containing an array of errors and 
 * a `warnings` property containing a list of warnings.
 * Errors should be handled, warnings should be presented to the user as they indicate
 * an implicit modification of the data to expect when preparing a transmission.
 */
export const validateForTransmissionSGBXI = async (
    billingData: BillingData,
    invoicesWithRecipient: InvoicesWithRecipient
) => {
    const { errors, warnings } = await validateAndTransliterateForTransmission(
        billingData,
        invoicesWithRecipient,
        constraintsInvoiceSGBXI
    );
    return { errors, warnings };
};

const validateAndTransliterateForTransmission = async (
    billingData: BillingData,
    invoicesWithRecipient: InvoicesWithRecipient,
    constraintsInvoice: (invoice: Invoice) => ValidationResult[]
) => {
    let { warnings, transliterated } = transliterateRecursively({
        billingData,
        invoicesWithRecipient: {
            invoices: invoicesWithRecipient.invoices
        }
    }, transliterateI8);

    const constraints = await constraintsForTransmission(transliterated.billingData, {
        ...invoicesWithRecipient,
        ...transliterated.invoicesWithRecipient
    }, constraintsInvoice);
    const result = validationByType(constraints);

    return {
        errors: result.errors,
        warnings: warnings.concat(result.warnings),
        transliterated
    }
};

export const validateVersicherter = (
    versicherter: Versicherter,
    requiresVersichertenStatus: boolean
) => {
    let { warnings, transliterated } = transliterateRecursively(versicherter, transliterateI8);

    const constraints = constraintsVersicherter({
        ...versicherter,
        ...transliterated
    }, requiresVersichertenStatus);
    const result = validationByType(constraints);

    return {
        errors: result.errors,
        warnings: warnings.concat(result.warnings),
        transliterated
    }
};

export const validateLeistungserbringer = (leistungserbringer: Leistungserbringer) => {
    let { warnings, transliterated } = transliterateRecursively(leistungserbringer, transliterateI8);

    const constraints = constraintsLeistungserbringer({
        ...leistungserbringer,
        ...transliterated
    });
    const result = validationByType(constraints);

    return {
        errors: result.errors,
        warnings: warnings.concat(result.warnings),
        transliterated
    }
};
