import { InstitutionListsIndex } from "../kostentraeger";
import { Einzelrechnung } from "../sgb-v/types";
import { Abrechnungsfall } from "../sgb-v/krankentransport/types";
import { makeNutzdaten } from "../sgb-v/krankentransport/index";
import { makeAnwendungsreferenz, makeDateiname } from "../sgb-v/filenames";
import { constraintsAbrechnungsfall } from "../sgb-v/krankentransport/validation";
import {
    BillingData,
    File,
    Institution,
    Recipient,
    ResultOrErrors,
    SGBVKrankentransportInvoice,
    SGBVKrankentransportInvoiceWithRecipient,
    SGBVKrankentransportTransmission,
} from "../types";
import { Gesamtsummen } from "../sgb-v/types";
import { transliterateRecursively } from "../transcoding";
import {
    encodeI1,
    getNonConformingCharactersI1,
    isEncodableI1,
    transliterateI1,
} from "../transcoding/iso88591";
import {
    constraintsBillingData,
    constraintsRecipient,
    constraintsInstitution,
} from "../validation";
import {
    error,
    validationByType,
    valueConstraints,
    arrayConstraints,
    isArray,
} from "../validation/utils";
import { ValidationError, ValidationResult } from "../validation/index";
import { isValidCertificate } from "../pki/validation";
import { signAndEncryptMessage } from "../pki/pkcs";
import writeAuftragsdatei from "../auftrag/writer";
import { billingEmail } from "./email";
import { transmissionIdentifiers } from "./utils";

/**
 * Group a list of SGB V Krankentransport invoices by corresponding recipients.
 * The recipients are determined from the institutionListsIndex using each invoice's
 * kostentraegerIK, the Leistungserbringer's abrechnungscode and location.
 *
 * Unlike SGB XI, each SGB V Einzelrechnung maps 1:1 to a recipient, since the
 * `makeNutzdaten` function handles one Einzelrechnung at a time.
 *
 * @param invoices
 * @param institutionListsIndex
 * @returns invoicesWithRecipient and recipientNotFound
 */
export const findRecipientsForSGBVKrankentransport = (
    invoices: SGBVKrankentransportInvoice[],
    institutionListsIndex: InstitutionListsIndex,
): {
    invoicesWithRecipient: SGBVKrankentransportInvoiceWithRecipient[];
    recipientNotFound: SGBVKrankentransportInvoice[];
} => {
    const invoicesWithRecipient: SGBVKrankentransportInvoiceWithRecipient[] = [];
    const recipientNotFound: SGBVKrankentransportInvoice[] = [];

    invoices.forEach((invoice) => {
        const { rechnung } = invoice;
        const result = institutionListsIndex.findForData(
            rechnung.kostentraegerIK,
            { sgbvAbrechnungscode: rechnung.leistungserbringer.abrechnungscode },
            rechnung.leistungserbringer.location,
        );

        if (result) {
            const { kassenart, sendTo, encryptTo, certificate, papierannahmestellen } = result;
            const recipient: Recipient = {
                kassenart,
                sendTo,
                encryptTo,
                certificate,
                papierannahmestellen,
            };
            invoicesWithRecipient.push({ ...invoice, recipient });
        } else {
            recipientNotFound.push(invoice);
        }
    });

    return { invoicesWithRecipient, recipientNotFound };
};

/**
 * Prepares the transmission of one SGB V Krankentransport invoice to its recipient.
 * Validates the data, generates the EDIFACT Nutzdaten, signs and encrypts the payload,
 * generates the Auftragsdatei and email parameters.
 *
 * @param invoiceWithRecipient one of the invoicesWithRecipient items from findRecipientsForSGBVKrankentransport
 * @param calculateGesamtsummen a function that calculates the total amounts for the Abrechnungsfaelle
 * @param billingData additional data about the sender and its transmission history
 */
export const createTransmissionSGBVKrankentransport = async (
    invoiceWithRecipient: SGBVKrankentransportInvoiceWithRecipient,
    calculateGesamtsummen: (falls: Abrechnungsfall[]) => Gesamtsummen,
    billingData: BillingData,
): Promise<ResultOrErrors<SGBVKrankentransportTransmission>> => {
    let { errors, warnings, transliterated } = await validateAndTransliterate(
        billingData,
        invoiceWithRecipient,
    );

    if (errors.length) {
        return { errors, warnings };
    }

    const { recipient } = invoiceWithRecipient;
    const { kassenart, sendTo, encryptTo } = recipient;
    const recipientEmail = sendTo.transmissionEmail || "";

    const transliteratedRechnung = transliterated.invoiceWithRecipient.rechnung as Einzelrechnung;
    const transliteratedFaelle = transliterated.invoiceWithRecipient
        .abrechnungsfaelle as Abrechnungsfall[];

    const sender = getSender(transliterated.billingData, transliteratedRechnung);
    const { testIndicator, korrekturlieferung, verarbeitungskennzeichen } = billingData;

    const month = transliteratedFaelle[0].fahrten[0].abrechnungspositionen[0].leistungsDatum;
    const { datenaustauschreferenz, laufendeDatenannahmeImJahr, transferNumber } =
        transmissionIdentifiers(billingData, encryptTo.ik);

    const filename = makeDateiname(testIndicator, transferNumber);
    const anwendungsreferenz = makeAnwendungsreferenz(
        transliterated.billingData,
        month,
        sender.ik,
        kassenart,
        laufendeDatenannahmeImJahr,
    );

    const { nutzdaten, abrechnungsfaelle } = makeNutzdaten(
        transliteratedRechnung,
        transliteratedFaelle,
        calculateGesamtsummen,
        encryptTo.ik,
        datenaustauschreferenz,
        anwendungsreferenz,
        testIndicator,
    );

    if (!recipientEmail) {
        return cancelWith(error("requiredValueMissing", "recipient.sendTo.transmissionEmail"));
    }

    if (!recipient.certificate) {
        return cancelWith(error("requiredValueMissing", "recipient.certificate"));
    }

    if (!isEncodableI1(nutzdaten)) {
        const invalidCharacters = getNonConformingCharactersI1(nutzdaten).join(" ");
        return cancelWith(error("invalidCharacters", undefined, { invalidCharacters }));
    }

    const unencryptedNutzdaten = encodeI1(nutzdaten);
    let auftragsdaten = "";
    let encryptedNutzdaten = new ArrayBuffer(0);

    try {
        encryptedNutzdaten = await signAndEncryptMessage(
            unencryptedNutzdaten.buffer,
            billingData.senderCertificate,
            billingData.senderPrivateKey,
            recipient.certificate.buffer as ArrayBuffer,
        );

        auftragsdaten = writeAuftragsdatei({
            verfahrenKennung: "SOL",
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
            charset: "I1",
        });
    } catch (thrownError) {
        return cancelWith(
            error("throwsError", undefined, undefined, (thrownError as Error)?.message),
        );
    }

    const unencryptedPayloadFile = makeFile(unencryptedNutzdaten, filename);
    const payloadFile = makeFile(new Uint8Array(encryptedNutzdaten), filename);
    const instructionFile = makeFile(encodeI1(auftragsdaten), filename + ".AUF");
    const email = billingEmail(sender, recipientEmail, payloadFile, instructionFile);
    const fileCreationDate = new Date();

    return {
        warnings,
        result: {
            unencryptedPayloadFile,
            payloadFile,
            instructionFile,
            abrechnungsfaelle,
            anwendungsreferenz,
            email,
            fileCreationDate,
            datenaustauschreferenz,
            laufendeDatenannahmeImJahr,
            sender,
            recipient,
            verarbeitungskennzeichen,
            korrekturlieferung: korrekturlieferung || null,
            testIndicator,
        },
    };
};

const getSender = (
    { rechnungsart, abrechnungsstelle }: BillingData,
    rechnung: Einzelrechnung,
): Institution =>
    rechnungsart == "1" || !abrechnungsstelle ? rechnung.leistungserbringer : abrechnungsstelle;

const makeFile = (bytes: Uint8Array, name: string): File => ({ name, bytes });

const cancelWith = (validationError: ValidationError): { errors: ValidationError[] } => ({
    errors: [validationError],
});

const validateAndTransliterate = async (
    billingData: BillingData,
    invoiceWithRecipient: SGBVKrankentransportInvoiceWithRecipient,
) => {
    let { warnings, transliterated } = transliterateRecursively(
        {
            billingData,
            invoiceWithRecipient: {
                rechnung: invoiceWithRecipient.rechnung,
                abrechnungsfaelle: invoiceWithRecipient.abrechnungsfaelle,
            },
        },
        transliterateI1,
    );

    const recipientCertificateResult = await isValidCertificate(
        invoiceWithRecipient.recipient,
        "certificate",
    );
    const senderCertificateResult = await isValidCertificate(
        transliterated.billingData,
        "senderCertificate",
    );

    const transliteratedRechnung = transliterated.invoiceWithRecipient.rechnung as Einzelrechnung;
    const transliteratedFaelleForValidation = transliterated.invoiceWithRecipient
        .abrechnungsfaelle as Abrechnungsfall[];

    const constraints: ValidationResult[] = [
        ...valueConstraints<BillingData>(
            { billingData: transliterated.billingData },
            "billingData",
            (billingData) => [...constraintsBillingData(billingData), ...senderCertificateResult],
        ),
        ...valueConstraints<{ recipient: Recipient }>(
            { invoiceWithRecipient: { recipient: invoiceWithRecipient.recipient } },
            "invoiceWithRecipient",
            (item) => [...constraintsRecipient(item.recipient), ...recipientCertificateResult],
        ),
        ...valueConstraints<Einzelrechnung>(
            { rechnung: transliteratedRechnung },
            "rechnung",
            (rechnung) => [...constraintsInstitution(rechnung.leistungserbringer)],
        ),
        isArray({ abrechnungsfaelle: transliteratedFaelleForValidation }, "abrechnungsfaelle", 1),
        ...arrayConstraints<Abrechnungsfall>(
            { abrechnungsfaelle: transliteratedFaelleForValidation },
            "abrechnungsfaelle",
            constraintsAbrechnungsfall,
        ),
    ];

    const result = validationByType(constraints);

    return {
        errors: result.errors,
        warnings: warnings.concat(result.warnings),
        transliterated,
    };
};
