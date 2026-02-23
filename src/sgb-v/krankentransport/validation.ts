import { 
    isArray, isChar, isDate, isInt, isOptionalVarchar, isRequired,
    arrayConstraints, isOptionalInt, isNumber, isVarchar,
} from "../../validation/utils"
import { 
    constraintsBaseAbrechnungsfall,
    constraintsBaseAbrechnungsposition,
    constraintsVerordnung,
} from "../validation"
import { Abrechnungsfall, Abrechnungsposition, Fahrt, KrankentransportVerordnung } from "./types"

export const constraintsAbrechnungsfall = (fall: Abrechnungsfall) => [
    ...constraintsBaseAbrechnungsfall(fall),
    isArray(fall, "fahrten", 1),
    ...arrayConstraints<Fahrt>(fall, "fahrten", constraintsFahrt),
    isArray(fall, "verordnungen", 1),
    ...arrayConstraints<KrankentransportVerordnung>(fall, "verordnungen", constraintsKrankentransportVerordnung),
]

const constraintsFahrt = (fahrt: Fahrt) => [
    isInt(fahrt, "id", 1, 999),
    isRequired(fahrt, "pickupStreetAndHousenumber"),
    isVarchar(fahrt, "pickupStreetAndHousenumber", 30),
    isOptionalVarchar(fahrt, "pickupPostalCode", 7),
    isOptionalVarchar(fahrt, "pickupPlaceName", 25),
    isRequired(fahrt, "dropOffStreetAndHousenumber"),
    isVarchar(fahrt, "dropOffStreetAndHousenumber", 30),
    isVarchar(fahrt, "dropOffPostalCode", 7),
    isOptionalVarchar(fahrt, "dropOffPlaceName", 25),
    isArray(fahrt, "abrechnungspositionen", 1),
    ...arrayConstraints<Abrechnungsposition>(fahrt, "abrechnungspositionen", constraintsAbrechnungsposition),
    ...(fahrt.zuzahlung ? [
        isOptionalInt(fahrt.zuzahlung, "gesetzlicheZuzahlungBetrag", 0, 1e10),
    ] : []),
]

const constraintsAbrechnungsposition = (pos: Abrechnungsposition) => [
    ...constraintsBaseAbrechnungsposition(pos),
    isChar(pos, "positionsnummer", 6),
    isDate(pos, "leistungsDatum"),
    isOptionalInt(pos, "gefahreneKilometer", 0, 1e6),
    isNumber(pos, "einzelpreis", 0, 1e10),
    isNumber(pos, "anzahl", 1, 1e4),
]

const constraintsKrankentransportVerordnung = (v: KrankentransportVerordnung) => [
    ...constraintsVerordnung(v),
    isRequired(v, "zuzahlung"),
]
