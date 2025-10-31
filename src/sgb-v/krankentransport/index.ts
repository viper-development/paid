/** based on documents:
 *  - Sonstige Leistungserbringer, Technische Anlage 1 für die maschinelle Abrechnung
 *
 *  see docs/documents.md for more info
 */

import { Interchange } from "../../edifact/types";
import edifactWriter from "../../edifact/writer";
import { TestIndicator } from "../../types";
import { makeInterchangeHeader, makeSLGAMessage } from "../message";
import { Einzelrechnung, Gesamtsummen } from "../types";
import { makeMessage } from "./message";
import { Abrechnungsfall } from "./types";

/**
 * Generate complete EDIFACT Nutzdaten file for Krankentransport (Rechnungsart 1)
 *
 * Structure:
 * - UNB (Interchange header)
 * - UNH + SLGA message + UNT (Gesamtaufstellung)
 * - UNH + SLLA message + UNT (Abrechnungsdaten)
 * - UNZ (Interchange trailer)
 */
export const makeNutzdaten = (
    rechnung: Einzelrechnung,
    abrechnungsfaelle: Abrechnungsfall[],
    calculateGesamtsummen: (falls: Abrechnungsfall[]) => Gesamtsummen,
    encryptedForIK: string,
    datenaustauschreferenz: number,
    anwendungsreferenz: string,
    testIndicator: TestIndicator,
    dateCreated: Date = new Date()
) => {
    // Create SLGA message (Gesamtaufstellung)
    const slgaMessage = makeSLGAMessage(rechnung, abrechnungsfaelle, calculateGesamtsummen);

    // Create SLLA message (Abrechnungsdaten)
    const sllaMessage = makeMessage(rechnung, abrechnungsfaelle);

    // Create interchange header elements
    const headerElements = makeInterchangeHeader(
        rechnung.senderIK,
        encryptedForIK,
        dateCreated,
        datenaustauschreferenz,
        rechnung.leistungsbereich,
        anwendungsreferenz,
        testIndicator
    );

    // Assemble complete interchange
    const interchange: Interchange = {
        header: headerElements,
        messages: [slgaMessage, sllaMessage],
        decimalNotation: ",",
    };

    // Stringify to EDIFACT format
    const nutzdaten = edifactWriter(interchange);

    return {
        nutzdaten,
        abrechnungsfaelle,
    };
};
