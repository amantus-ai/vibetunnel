import Foundation

// Terminal buffer cell representation
struct BufferCell {
    let char: String
    let width: Int
    var fg: UInt32? // Foreground color
    var bg: UInt32? // Background color
    var attributes: UInt8? // Attribute flags
}

// Terminal buffer snapshot
struct TerminalBufferSnapshot {
    let cols: Int
    let rows: Int
    let viewportY: Int
    let cursorX: Int
    let cursorY: Int
    let cells: [[BufferCell]]
    let showCursor: Bool = true
}

// Attribute flags
let ATTR_BOLD: UInt8 = 0x01
let ATTR_ITALIC: UInt8 = 0x02
let ATTR_UNDERLINE: UInt8 = 0x04
let ATTR_DIM: UInt8 = 0x08
let ATTR_INVERSE: UInt8 = 0x10
let ATTR_INVISIBLE: UInt8 = 0x20
let ATTR_STRIKETHROUGH: UInt8 = 0x40

// Binary protocol decoder
final class TerminalBufferDecoder {
    
    static func decode(from data: Data) throws -> TerminalBufferSnapshot {
        guard data.count >= 32 else {
            throw DecodingError.insufficientData
        }
        
        var offset = 0
        
        // Read header
        let magic = UInt16(data[offset]) | (UInt16(data[offset + 1]) << 8)
        offset += 2
        
        guard magic == 0x5654 else { // "VT" in little endian
            throw DecodingError.invalidMagic
        }
        
        let version = data[offset]
        offset += 1
        
        guard version == 0x01 else {
            throw DecodingError.unsupportedVersion(version)
        }
        
        let _ = data[offset] // flags
        offset += 1
        
        // Read dimensions and cursor
        let cols = UInt32(data[offset]) |
                  (UInt32(data[offset + 1]) << 8) |
                  (UInt32(data[offset + 2]) << 16) |
                  (UInt32(data[offset + 3]) << 24)
        offset += 4
        
        let rows = UInt32(data[offset]) |
                  (UInt32(data[offset + 1]) << 8) |
                  (UInt32(data[offset + 2]) << 16) |
                  (UInt32(data[offset + 3]) << 24)
        offset += 4
        
        let viewportY = Int32(bitPattern: UInt32(data[offset]) |
                             (UInt32(data[offset + 1]) << 8) |
                             (UInt32(data[offset + 2]) << 16) |
                             (UInt32(data[offset + 3]) << 24))
        offset += 4
        
        let cursorX = Int32(bitPattern: UInt32(data[offset]) |
                           (UInt32(data[offset + 1]) << 8) |
                           (UInt32(data[offset + 2]) << 16) |
                           (UInt32(data[offset + 3]) << 24))
        offset += 4
        
        let cursorY = Int32(bitPattern: UInt32(data[offset]) |
                           (UInt32(data[offset + 1]) << 8) |
                           (UInt32(data[offset + 2]) << 16) |
                           (UInt32(data[offset + 3]) << 24))
        offset += 4
        
        offset += 4 // Skip reserved
        
        // Validate dimensions
        guard cols > 0 && cols < 10000 && rows > 0 && rows < 10000 else {
            throw DecodingError.invalidMagic // Invalid dimensions
        }
        
        // Decode cells
        var cells: [[BufferCell]] = []
        
        while offset < data.count {
            guard offset < data.count else {
                break
            }
            
            let marker = data[offset]
            offset += 1
            
            if marker == 0xFE {
                // Empty row(s)
                guard offset < data.count else {
                    throw DecodingError.insufficientData
                }
                let count = data[offset]
                offset += 1
                
                // Sanity check row count
                guard count > 0 && count <= 255 else {
                    throw DecodingError.insufficientData
                }
                
                for _ in 0..<count {
                    cells.append([BufferCell(char: " ", width: 1)])
                }
            } else if marker == 0xFD {
                // Row with content
                guard offset + 2 <= data.count else {
                    throw DecodingError.insufficientData
                }
                let cellCount = UInt16(data[offset]) | (UInt16(data[offset + 1]) << 8)
                offset += 2
                
                var rowCells: [BufferCell] = []
                for _ in 0..<cellCount {
                    let (cell, newOffset) = try decodeCell(from: data, at: offset)
                    offset = newOffset
                    rowCells.append(cell)
                }
                cells.append(rowCells)
            }
        }
        
        return TerminalBufferSnapshot(
            cols: Int(cols),
            rows: Int(rows),
            viewportY: Int(viewportY),
            cursorX: Int(cursorX),
            cursorY: Int(cursorY),
            cells: cells
        )
    }
    
    private static func decodeCell(from data: Data, at offset: Int) throws -> (BufferCell, Int) {
        var currentOffset = offset
        
        // Bounds check
        guard currentOffset < data.count else {
            throw DecodingError.insufficientData
        }
        
        let typeByte = data[currentOffset]
        currentOffset += 1
        
        // Simple space optimization
        if typeByte == 0x00 {
            return (BufferCell(char: " ", width: 1), currentOffset)
        }
        
        // Decode type byte
        let hasExtended = (typeByte & 0x80) != 0
        let isUnicode = (typeByte & 0x40) != 0
        let hasFg = (typeByte & 0x20) != 0
        let hasBg = (typeByte & 0x10) != 0
        let isRgbFg = (typeByte & 0x08) != 0
        let isRgbBg = (typeByte & 0x04) != 0
        let charType = typeByte & 0x03
        
        // Read character
        let char: String
        if charType == 0x00 {
            char = " "
        } else if isUnicode {
            guard currentOffset < data.count else {
                throw DecodingError.insufficientData
            }
            let charLen = data[currentOffset]
            currentOffset += 1
            
            guard charLen > 0 && charLen < 10 && currentOffset + Int(charLen) <= data.count else {
                throw DecodingError.insufficientData
            }
            
            let charData = data.subdata(in: currentOffset..<(currentOffset + Int(charLen)))
            char = String(data: charData, encoding: .utf8) ?? "?"
            currentOffset += Int(charLen)
        } else {
            guard currentOffset < data.count else {
                throw DecodingError.insufficientData
            }
            char = String(Character(UnicodeScalar(data[currentOffset])))
            currentOffset += 1
        }
        
        var cell = BufferCell(char: char, width: 1)
        
        // Read extended data
        if hasExtended {
            // Always read attributes byte when hasExtended is true
            guard currentOffset < data.count else {
                throw DecodingError.insufficientData
            }
            let attributes = data[currentOffset]
            currentOffset += 1
            if attributes != 0 {
                cell.attributes = attributes
            }
            
            // Foreground color
            if hasFg {
                if isRgbFg {
                    // RGB color (3 bytes)
                    guard currentOffset + 3 <= data.count else {
                        throw DecodingError.insufficientData
                    }
                    let r = data[currentOffset]
                    let g = data[currentOffset + 1]
                    let b = data[currentOffset + 2]
                    currentOffset += 3
                    cell.fg = (UInt32(r) << 16) | (UInt32(g) << 8) | UInt32(b)
                } else {
                    // Palette index
                    guard currentOffset < data.count else {
                        throw DecodingError.insufficientData
                    }
                    cell.fg = UInt32(data[currentOffset])
                    currentOffset += 1
                }
            }
            
            // Background color
            if hasBg {
                if isRgbBg {
                    // RGB color (3 bytes)
                    guard currentOffset + 3 <= data.count else {
                        throw DecodingError.insufficientData
                    }
                    let r = data[currentOffset]
                    let g = data[currentOffset + 1]
                    let b = data[currentOffset + 2]
                    currentOffset += 3
                    cell.bg = (UInt32(r) << 16) | (UInt32(g) << 8) | UInt32(b)
                } else {
                    // Palette index
                    guard currentOffset < data.count else {
                        throw DecodingError.insufficientData
                    }
                    cell.bg = UInt32(data[currentOffset])
                    currentOffset += 1
                }
            }
        }
        
        return (cell, currentOffset)
    }
    
    enum DecodingError: Error {
        case insufficientData
        case invalidMagic
        case unsupportedVersion(UInt8)
    }
}