/** based on document: Gemeinsame Grundsätze Technik, Anlage 15: Zeichensätze
  * see docs/documents.md for more info
  *
  * ISO 8859-1 (Latin-1) — referred to as Zeichensatz "I1" in the GKV specs.
  * Encodes Unicode code points U+0000 through U+00FF as their corresponding byte values.
  */

import anyAscii from "any-ascii"

const MAX_CODE_POINT = 0xff

export const isEncodableI1 = (text: string): boolean => {
    for (const char of text) {
        if (char.codePointAt(0)! > MAX_CODE_POINT) return false
    }
    return true
}

export const getNonConformingCharactersI1 = (text: string): string[] =>
    [...text].filter(char => char.codePointAt(0)! > MAX_CODE_POINT)

export const encodeI1 = (text: string): Uint8Array => {
    const chars = [...text]
    const bytes = new Uint8Array(chars.length)
    for (let i = 0; i < chars.length; i++) {
        bytes[i] = chars[i].codePointAt(0)!
    }
    return bytes
}

export const decodeI1 = (bytes: Uint8Array): string => {
    let result = ""
    for (let i = 0; i < bytes.length; i++) {
        result += String.fromCharCode(bytes[i])
    }
    return result
}

/** Same as encodeI1, only that any character that cannot be represented in ISO 8859-1 is
 *  transliterated to its ASCII approximation instead. Characters with no available approximation
 *  are dropped. */
export const transliterateI1 = (text: string): string =>
    [...text].map(char => {
        if (char.codePointAt(0)! <= MAX_CODE_POINT) {
            return char
        }
        const ascii = anyAscii(char)
        return isEncodableI1(ascii) ? ascii : ""
    }).join("")
