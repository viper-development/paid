import { elements } from "../../edifact/builder";
import { Message, Segment } from "../../edifact/types";
import { FKT, REC } from "../segments_slga";
import { INV, NAD } from "../segments_slla";
import { Einzelrechnung, createLeistungserbringergruppe } from "../types";
import { Abrechnungsfall } from "./types";
import { sumBy } from "../../utils";
import { calculateBruttobetrag } from "../calculations";
import { KTL, EKT, ZKT, ZUK, BES } from "./segments";

export const makeMessage = (
    rechnung: Einzelrechnung,
    abrechnungsfaelle: Abrechnungsfall[]
): Message => {
    return {
        header: elements(["SLLA", "20", "0", "0"]),
        segments: [
            FKT("01", rechnung),
            REC(rechnung),
            ...abrechnungsfaelle.flatMap((fall) => buildFallSegments(rechnung, fall)),
        ].filter((s) => s !== undefined) as Segment[],
    };
};

function buildFallSegments(rechnung: Einzelrechnung, fall: Abrechnungsfall): Segment[] {
    const leistungserbringergruppe = createLeistungserbringergruppe(
        rechnung.leistungserbringer,
        fall.tarifkennzeichen
    );

    const fahrtenSegments = fall.fahrten.flatMap((fahrt) => {
        const ktl = KTL(
            fahrt.id,
            fahrt.pickupStreetAndHousenumber,
            fahrt.pickupPostalCode,
            fahrt.pickupLaenderkennzeichen,
            fahrt.pickupPlaceName,
            fahrt.dropOffStreetAndHousenumber,
            fahrt.dropOffPostalCode,
            fahrt.dropOffLaenderkennzeichen,
            fahrt.dropOffPlaceName
        );

        const ektSegments = fahrt.abrechnungspositionen.map((p) =>
            EKT(
                leistungserbringergruppe,
                p.positionsnummer,
                p.anzahl,
                p.einzelpreis,
                p.leistungsDatum,
                p.gefahreneKilometer,
                p.leistungsBeginn,
                p.leistungsEnde
            )
        );

        const fahrtBrutto = sumBy(fahrt.abrechnungspositionen, calculateBruttobetrag);
        const zuk = fahrt.zuzahlung
            ? ZUK(
                  fahrt.id,
                  fahrtBrutto,
                  fahrt.zuzahlung.zuzahlungsart,
                  fahrt.zuzahlung.gesetzlicheZuzahlungBetrag
              )
            : undefined;

        return [ktl, ...ektSegments, zuk].filter((s) => s !== undefined) as Segment[];
    });

    const zktSegments = fall.verordnungen.map((v) => ZKT(v));

    const allePositionen = fall.fahrten.flatMap((f) => f.abrechnungspositionen);
    const gesamtbrutto = sumBy(allePositionen, calculateBruttobetrag);
    const gesZuzahlung = sumBy(
        fall.fahrten
            .map((f) => f.zuzahlung?.gesetzlicheZuzahlungBetrag ?? 0)
            .filter((x) => typeof x === "number"),
        (x) => x as number
    );
    const bes = BES(gesamtbrutto, gesZuzahlung);

    return [INV(fall), NAD(fall.versicherter), ...fahrtenSegments, ...zktSegments, bes];
}
