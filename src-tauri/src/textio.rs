//! Text encoding detection and round-tripping.
//!
//! Hacknet reads extension files with .NET's XmlReader, which accepts UTF-8 (with or without
//! a BOM) and UTF-16 (with a BOM), and honours `encoding="..."` declarations. Editors on
//! Windows sometimes save files as UTF-16 ("Unicode" in Notepad) or in the ANSI code page.
//! VRift decodes those correctly and writes them back in the same encoding, so opening and
//! saving a file never silently changes how it is stored.

/// Encodings VRift can read and write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoding {
    Utf8,
    Utf16Le,
    Utf16Be,
    Windows1252,
}

impl Encoding {
    pub fn name(self) -> &'static str {
        match self {
            Encoding::Utf8 => "utf-8",
            Encoding::Utf16Le => "utf-16le",
            Encoding::Utf16Be => "utf-16be",
            Encoding::Windows1252 => "windows-1252",
        }
    }

    pub fn from_name(s: &str) -> Encoding {
        match s.to_ascii_lowercase().as_str() {
            "utf-16le" | "utf-16" => Encoding::Utf16Le,
            "utf-16be" => Encoding::Utf16Be,
            "windows-1252" | "cp1252" | "latin1" | "iso-8859-1" => Encoding::Windows1252,
            _ => Encoding::Utf8,
        }
    }
}

const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];
const UTF16LE_BOM: &[u8] = &[0xFF, 0xFE];
const UTF16BE_BOM: &[u8] = &[0xFE, 0xFF];

/// Windows-1252 bytes 0x80..=0x9F. Undefined slots map to the C1 control of the same value.
const CP1252_HIGH: [u16; 32] = [
    0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008D,
    0x017D, 0x008F, 0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A,
    0x0153, 0x009D, 0x017E, 0x0178,
];

pub struct Decoded {
    pub text: String,
    pub bom: bool,
    pub encoding: Encoding,
}

/// Guess UTF-16 without a BOM: ASCII-heavy text has a zero in every other byte.
fn guess_utf16(bytes: &[u8]) -> Option<Encoding> {
    if bytes.len() < 4 || bytes.len() & 1 == 1 {
        return None;
    }
    let sample = &bytes[..bytes.len().min(4096)];
    let pairs = sample.len() / 2;
    let (mut even0, mut odd0) = (0usize, 0usize);
    for k in 0..pairs {
        if sample[2 * k] == 0 {
            even0 += 1;
        }
        if sample[2 * k + 1] == 0 {
            odd0 += 1;
        }
    }
    if odd0 * 10 >= pairs * 7 && even0 * 10 < pairs {
        Some(Encoding::Utf16Le)
    } else if even0 * 10 >= pairs * 7 && odd0 * 10 < pairs {
        Some(Encoding::Utf16Be)
    } else {
        None
    }
}

fn decode_utf16(body: &[u8], le: bool) -> String {
    let units: Vec<u16> = body
        .chunks(2)
        .map(|c| {
            let (a, b) = (c[0], *c.get(1).unwrap_or(&0));
            if le { u16::from_le_bytes([a, b]) } else { u16::from_be_bytes([a, b]) }
        })
        .collect();
    String::from_utf16_lossy(&units)
}

fn decode_1252(body: &[u8]) -> String {
    body.iter()
        .map(|&b| match b {
            0x80..=0x9F => char::from_u32(CP1252_HIGH[(b - 0x80) as usize] as u32).unwrap_or('\u{FFFD}'),
            _ => b as char,
        })
        .collect()
}

pub fn decode(bytes: &[u8]) -> Decoded {
    if let Some(body) = bytes.strip_prefix(UTF8_BOM) {
        return Decoded { text: String::from_utf8_lossy(body).into_owned(), bom: true, encoding: Encoding::Utf8 };
    }
    if let Some(body) = bytes.strip_prefix(UTF16LE_BOM) {
        return Decoded { text: decode_utf16(body, true), bom: true, encoding: Encoding::Utf16Le };
    }
    if let Some(body) = bytes.strip_prefix(UTF16BE_BOM) {
        return Decoded { text: decode_utf16(body, false), bom: true, encoding: Encoding::Utf16Be };
    }
    // Real text never contains NUL bytes, so a NUL-heavy file is UTF-16 even though ASCII
    // UTF-16 is technically also valid UTF-8.
    if let Some(enc) = guess_utf16(bytes) {
        return Decoded { text: decode_utf16(bytes, enc == Encoding::Utf16Le), bom: false, encoding: enc };
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        return Decoded { text: s.to_owned(), bom: false, encoding: Encoding::Utf8 };
    }
    Decoded { text: decode_1252(bytes), bom: false, encoding: Encoding::Windows1252 }
}

pub fn encode(text: &str, encoding: Encoding, bom: bool) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(text.len() + 3);
    match encoding {
        Encoding::Utf8 => {
            if bom {
                out.extend_from_slice(UTF8_BOM);
            }
            out.extend_from_slice(text.as_bytes());
        }
        Encoding::Utf16Le | Encoding::Utf16Be => {
            let le = encoding == Encoding::Utf16Le;
            if bom {
                out.extend_from_slice(if le { UTF16LE_BOM } else { UTF16BE_BOM });
            }
            for u in text.encode_utf16() {
                out.extend_from_slice(&if le { u.to_le_bytes() } else { u.to_be_bytes() });
            }
        }
        Encoding::Windows1252 => {
            for (line, l) in text.split('\n').enumerate() {
                if line > 0 {
                    out.push(b'\n');
                }
                for ch in l.chars() {
                    let c = ch as u32;
                    let byte = if c < 0x80 || (0xA0..=0xFF).contains(&c) {
                        Some(c as u8)
                    } else {
                        CP1252_HIGH.iter().position(|&x| x as u32 == c).map(|p| 0x80 + p as u8)
                    };
                    match byte {
                        Some(b) => out.push(b),
                        None => {
                            return Err(format!(
                                "This file is saved in the Windows-1252 (ANSI) encoding, which cannot store '{}' (line {}). \
                                 Remove the character, or convert the file to UTF-8.",
                                ch,
                                line + 1
                            ))
                        }
                    }
                }
            }
        }
    }
    Ok(out)
}

/// File extensions that are never text, so they are not read when listing a folder.
const BINARY_EXT: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "tga", "dds", "psd", "ogg", "wav", "mp3", "flac", "wma", "m4a",
    "mp4", "webm", "avi", "mov", "dll", "exe", "pdb", "so", "dylib", "xnb", "zip", "7z", "rar", "gz", "tar", "ttf",
    "otf", "woff", "woff2", "spritefont", "bin", "dat", "db", "sqlite", "pdf", "blend", "fbx",
];
/// Extensions that are always treated as text without looking inside.
const TEXT_EXT: &[&str] = &[
    "xml", "txt", "html", "htm", "css", "md", "json", "js", "ts", "cs", "ini", "cfg", "conf", "yml", "yaml", "csv",
    "tsv", "log", "toml", "sh", "bat", "ps1", "py", "lua", "nfo", "readme", "pcap", "frag", "vert", "glsl", "fx",
];

/// Some(true) for extensions that are always text, Some(false) for ones that never are,
/// None when the content has to be inspected.
pub fn known_extension(ext: &str) -> Option<bool> {
    let ext = ext.to_ascii_lowercase();
    if BINARY_EXT.contains(&ext.as_str()) {
        Some(false)
    } else if TEXT_EXT.contains(&ext.as_str()) {
        Some(true)
    } else {
        None
    }
}

/// Decide whether a file is text. `head` is up to the first 8 KB of the file.
pub fn looks_like_text(ext: &str, head: &[u8]) -> bool {
    let ext = ext.to_ascii_lowercase();
    if BINARY_EXT.contains(&ext.as_str()) {
        return false;
    }
    if TEXT_EXT.contains(&ext.as_str()) {
        return true;
    }
    if head.is_empty() {
        return true;
    }
    if head.starts_with(UTF8_BOM) || head.starts_with(UTF16LE_BOM) || head.starts_with(UTF16BE_BOM) {
        return true;
    }
    if guess_utf16(&head[..head.len() & !1]).is_some() {
        return true;
    }
    if head.contains(&0) {
        return false;
    }
    // Valid UTF-8, allowing a multi-byte character cut off at the end of the sample.
    let utf8 = match std::str::from_utf8(head) {
        Ok(_) => true,
        Err(e) => e.error_len().is_none() && e.valid_up_to() + 4 > head.len(),
    };
    if utf8 {
        return true;
    }
    // Otherwise accept mostly-printable single-byte text (ANSI code page).
    let printable = head.iter().filter(|&&b| b >= 0x20 || b == b'\n' || b == b'\r' || b == b'\t').count();
    printable * 100 >= head.len() * 97
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_roundtrip_with_and_without_bom() {
        let s = "<Computer name=\"Caf\u{e9}\" />\r\n";
        for bom in [false, true] {
            let bytes = encode(s, Encoding::Utf8, bom).unwrap();
            let d = decode(&bytes);
            assert_eq!(d.text, s);
            assert_eq!(d.bom, bom);
            assert_eq!(d.encoding, Encoding::Utf8);
        }
    }

    #[test]
    fn utf16_roundtrip_and_detection() {
        let s = "<?xml version=\"1.0\" encoding=\"utf-16\"?>\n<mission id=\"\u{263a}\" />";
        for enc in [Encoding::Utf16Le, Encoding::Utf16Be] {
            let with_bom = encode(s, enc, true).unwrap();
            let d = decode(&with_bom);
            assert_eq!((d.text.as_str(), d.encoding, d.bom), (s, enc, true));
            let no_bom = encode(s, enc, false).unwrap();
            let d = decode(&no_bom);
            assert_eq!((d.text.as_str(), d.encoding, d.bom), (s, enc, false));
            assert!(looks_like_text("", &no_bom));
        }
    }

    #[test]
    fn windows_1252_roundtrip_and_unmappable() {
        let bytes: Vec<u8> = b"<a>caf\xe9 \x93quoted\x94 \x80</a>".to_vec();
        let d = decode(&bytes);
        assert_eq!(d.encoding, Encoding::Windows1252);
        assert_eq!(d.text, "<a>caf\u{e9} \u{201c}quoted\u{201d} \u{20ac}</a>");
        assert_eq!(encode(&d.text, Encoding::Windows1252, false).unwrap(), bytes);
        let err = encode("ok\n\u{4e2d}", Encoding::Windows1252, false).unwrap_err();
        assert!(err.contains("line 2"), "{err}");
    }

    #[test]
    fn text_sniffing() {
        assert!(looks_like_text("json", b"{}"));
        assert_eq!(known_extension("XML"), Some(true));
        assert_eq!(known_extension("ogg"), Some(false));
        assert_eq!(known_extension("weird"), None);
        assert!(!looks_like_text("png", b"<xml>"));
        assert!(looks_like_text("", b"plain notes\nwith lines"));
        assert!(looks_like_text("whatever", "caf\u{e9}".as_bytes()));
        assert!(!looks_like_text("whatever", &[0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0xff, 0xff]));
        // UTF-8 sample cut in the middle of a multi-byte character
        let s = "abc\u{e9}".as_bytes();
        assert!(looks_like_text("", &s[..s.len() - 1]));
    }
}
