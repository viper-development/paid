/** based on documents:
 *  - Verordnungsformular für Krankenhauseinweisung: Muster 2
 *
 * see docs/documents.md for more info
 * */

import { ZuzahlungSchluessel, ZuzahlungsartSchluessel } from "../codes";
import { BaseAbrechnungsfall, BaseAbrechnungsposition, Verordnung } from "../types";
import { LaenderkennzeichenSchluessel } from "../../country_codes";

/** See Verordnungsformular für Krankenhauseinweisung: Muster 2 for how the prescription looks */
export type KrankentransportVerordnung = Verordnung & {
    /** gesetzliche Zuzahlungspflicht laut Verordnung */
    zuzahlung: ZuzahlungSchluessel;
    /** optional für Krankentransport */
    verordnungsDatum?: Date;
};

export type Abrechnungsfall = BaseAbrechnungsfall & {
    /** Fahrten innerhalb dieses Abrechnungsfalls */
    fahrten: Fahrt[];
    /** Verordnungen, die diesem Abrechnungsfall zugeordnet sind */
    verordnungen: KrankentransportVerordnung[];
};

export type Fahrt = {
    /** Identifikationsnummer innerhalb des Abrechnungsfalls (1..999) */
    id: number;

    /** Abholadresse */
    pickupStreetAndHousenumber: string;
    pickupPostalCode?: string;
    pickupLaenderkennzeichen?: LaenderkennzeichenSchluessel;
    pickupPlaceName?: string;

    /** Zieladresse */
    dropOffStreetAndHousenumber: string;
    dropOffPostalCode: string;
    dropOffLaenderkennzeichen?: LaenderkennzeichenSchluessel;
    dropOffPlaceName?: string;

    /** erbrachte Abrechnungspositionen zu dieser Fahrt */
    abrechnungspositionen: Abrechnungsposition[];

    /** optionale Angaben zur gesetzlichen Zuzahlung (ZUK) für diese Fahrt */
    zuzahlung?: {
        zuzahlungsart?: ZuzahlungsartSchluessel;
        /** gesetzliche Zuzahlung je Leistung (Betrag) */
        gesetzlicheZuzahlungBetrag?: number;
    };
};

export type Abrechnungsposition = BaseAbrechnungsposition & {
    /** Abrechnungspositionsnummer für Krankentransportleistungen (6-stellig) */
    positionsnummer: string;
    /** Datum der Leistungserbringung */
    leistungsDatum: Date;
    /** Beginn der Leistungserbringung */
    leistungsBeginn?: Date;
    /** Ende der Leistungserbringung */
    leistungsEnde?: Date;
};
