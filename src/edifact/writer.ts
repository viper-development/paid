import { segment } from "./builder"
import { fixedInt } from "./formatter"
import { Interchange, Segment, Element, ServiceStringAdvice, Message } from "./types"

/** Writes an EDIFACT interchange.
 *
 *  The does only support syntax UNOC version 3, so, requires the input to be encoded with ISO 8859-1.
 *
 *  The implementation is based on the documentation from
 *
 *  https://www.gs1.org/docs/EDI/eancom/2012/ean02s3/part1/part1_05.htm
 *
 *  By default a UNA service string advice segment is written at the start of the interchange.
 *  Some profiles forbid it: the SGB V §302 Nutzdatei uses the fixed, agreed Steuerzeichen and must
 *  begin directly with UNB, so those callers pass `includeServiceStringAdvice = false`. The same
 *  separators are still used for formatting/escaping; only the UNA segment is omitted.
 */
export default function stringify(interchange: Interchange, includeServiceStringAdvice = true) {
    if (interchange.decimalNotation.length != 1) {
        throw new Error("decimalNotation must be one character (usually ',' or '.'")
    }
    // no need to allow users to define custom separators (not used) but it would be easy to support
    const serviceStringAdvice = {
        componentSeparator: ":",
        elementSeparator: "+",
        decimalNotation: interchange.decimalNotation, 
        releaseCharacter: "?",
        segmentTerminator: "'"
    }

    const messageSegments = messagesToSegments(interchange.messages)

    const allSegments: Segment[] = [
        segment("UNB", ...interchange.header),
         ...messageSegments,
        segment("UNZ",
            // Anzahl Nachrichten (0036): the §302 TA requires 6 digits with leading zeros
            fixedInt(interchange.messages.length, 6),
            // the fifth element in the header is the reference no of this interchange
            interchange.header[4]
        )
    ]

    return [
        ...(includeServiceStringAdvice ? [stringifyServiceStringAdvice(serviceStringAdvice)] : []),
        ...allSegments.map(segment => stringifySegment(segment, serviceStringAdvice))
    ].join("\r\n")
}

const messagesToSegments = (messages: Message[]): Segment[] => {
    let messageNo = 1
    // flatten the messages to segments (the header and trailer of a message are also segments)
    return messages.flatMap(message => messageToSegments(message, messageNo++))
}

/* The §302 TA requires the service segment counters to be fixed-length with leading zeros:
   Nachrichtenreferenznummer (0062) in UNH and UNT = 5 digits, Anzahl Einheiten (0074) in
   UNT = 6 digits, e.g. "00001" for the first message. */
const messageToSegments = (message: Message, no: number): Segment[] => [
    segment("UNH", fixedInt(no, 5), ...message.header),
    ...message.segments,
    // +2 because this is the segment count including UNH and UNT
    segment("UNT", fixedInt(message.segments.length + 2, 6), fixedInt(no, 5))
]

const stringifyServiceStringAdvice = (ssa: ServiceStringAdvice): string =>
    "UNA" + 
    ssa.componentSeparator + 
    ssa.elementSeparator + 
    ssa.decimalNotation + 
    ssa.releaseCharacter + 
    " " + // unused
    ssa.segmentTerminator

const stringifySegment = (segment: Segment, ssa: ServiceStringAdvice): string =>
    segment.tag + 
    ssa.elementSeparator + 
    stringifyElements(segment.elements, ssa) +
    ssa.segmentTerminator

const stringifyElements = (elements: Element[], serviceStringAdvice: ServiceStringAdvice): string => {
    const esc = escapeCharacters(serviceStringAdvice)
    const trailingComponentsRegex = new RegExp("[" + serviceStringAdvice.componentSeparator + "]*$")
    const trailingElementsRegex = new RegExp("[" + serviceStringAdvice.elementSeparator + "]*$")
    /* elements are basically a string[][] and the control characters in each string need to be 
       escaped.
       Furthermore, the EDIFACT standard allows omitting empty components/elements at the end, maybe
       data parsers (incorrectly) require this */
    return elements
        .map(element => element
            .map(component => escape(component, esc))
            .join(serviceStringAdvice.componentSeparator)
            .replace(trailingComponentsRegex, "")
        )
        .join(serviceStringAdvice.elementSeparator)
        .replace(trailingElementsRegex, "")
}

/* Escaping characters increases the length of the string. We were uncertain if the escape 
   characters count towards the (max) field too, so we asked the GKV-Spitzenverband. 
   
   They answered that the escape characters do not count, so the implementation can be easy (i.e.
   validating string length before building the edifact string) here :-)

   > Das Maskierungszeichen wird bei der Feldlänge nicht mitgezählt.
   */
const escape = (str: string, characters: string): string =>
    str.replace(new RegExp("([" + characters + "])", "g"), "?$1")

/* The documentation is vague on whether the decimal notation character (usually ",") should be 
   escaped or not, so we asked GKV-Spitzenverband.
   
   They answered that the decimal notation is NOT escaped:
   
   > Hier handelt es sich um eine Ungenauigkeit in der Technischen Anlage. Das Komma ist als 
   > Dezimalzeichen vorgesehen, aber nicht als Trennzeichen im Sinne der EDIFACT-Syntax. Somit ist
   > das Komma nicht zu maskieren. Zu maskieren sind nur die Zeichen Doppelpunkt, Plus und Apostroph.
*/
const escapeCharacters = ({
    componentSeparator,
    elementSeparator,
    releaseCharacter,
    segmentTerminator
}: ServiceStringAdvice): string =>
    componentSeparator + elementSeparator + releaseCharacter + segmentTerminator
