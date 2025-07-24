//
//  GitInfo.swift
//  VibeTunnel
//
//  Created on 2025-07-24.
//

import Foundation

/// Information about a Git repository
struct GitInfo: Equatable {
    let branch: String?
    let aheadCount: Int?
    let behindCount: Int?
    let hasChanges: Bool
    let isWorktree: Bool
}