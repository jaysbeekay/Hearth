import AppIntents
import Foundation

// Siri and Shortcuts entry points (#533, phase 1). Each intent only opens the
// app on a screen: it never reads or writes household data, so no SiriKit
// entitlement, App Group or URL scheme is involved. The phrases are listed in
// HearthShortcuts below and show up in the Shortcuts app without any setup.

/// The screens Siri can open. A fixed list, so nothing free-text from Siri
/// ever reaches the WebView.
enum HearthRoute: String {
    case addContract
    case addProduct
    case whatsDue

    /// Path on the user's own Hearth server, used in connected mode.
    var serverPath: String {
        switch self {
        case .addContract: return "/contracts/new"
        case .addProduct: return "/products/new"
        case .whatsDue: return "/dashboard"
        }
    }
}

struct AddContractIntent: AppIntent {
    static let title: LocalizedStringResource = "Add a contract"
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        PendingRoute.set(.addContract)
        return .result()
    }
}

struct AddProductIntent: AppIntent {
    static let title: LocalizedStringResource = "Add a product"
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        PendingRoute.set(.addProduct)
        return .result()
    }
}

struct WhatsDueIntent: AppIntent {
    static let title: LocalizedStringResource = "What's due"
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        PendingRoute.set(.whatsDue)
        return .result()
    }
}

struct HearthShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddContractIntent(),
            phrases: ["Add a contract in \(.applicationName)"],
            shortTitle: "Add a contract",
            systemImageName: "doc.badge.plus"
        )
        AppShortcut(
            intent: AddProductIntent(),
            phrases: ["Add a product in \(.applicationName)"],
            shortTitle: "Add a product",
            systemImageName: "shippingbox"
        )
        AppShortcut(
            intent: WhatsDueIntent(),
            phrases: [
                "What's due in \(.applicationName)",
                "Show what's due in \(.applicationName)"
            ],
            shortTitle: "What's due",
            systemImageName: "calendar.badge.clock"
        )
    }
}
