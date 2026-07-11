import Testing
@testable import VibeTunnel

@Suite("Application Mover Tests")
@MainActor
struct ApplicationMoverTests {
    private let homeDirectory = "/Users/tester"
    private let currentIdentity = ApplicationMover.ApplicationIdentity(
        bundleIdentifier: "sh.vibetunnel.vibetunnel",
        buildVersion: "100")

    @Test
    func installedSystemApplicationSuppressesMoveOffer() {
        let shouldOffer = self.shouldOffer(
            bundlePath: "/Users/tester/Downloads/VibeTunnel.app",
            installedIdentities: ["/Applications/VibeTunnel.app": self.currentIdentity])

        #expect(!shouldOffer)
    }

    @Test
    func installedUserApplicationSuppressesMoveOffer() {
        let shouldOffer = self.shouldOffer(
            bundlePath: "/Volumes/VibeTunnel/VibeTunnel.app",
            installedIdentities: ["/Users/tester/Applications/VibeTunnel.app": self.currentIdentity],
            isRunningFromDMG: true)

        #expect(!shouldOffer)
    }

    @Test
    func temporaryApplicationWithoutInstallationOffersMove() {
        let shouldOffer = self.shouldOffer(bundlePath: "/Users/tester/Downloads/VibeTunnel.app")

        #expect(shouldOffer)
    }

    @Test
    func applicationAlreadyRunningFromApplicationsDoesNotOfferMove() {
        let shouldOffer = self.shouldOffer(bundlePath: "/Applications/VibeTunnel.app")

        #expect(!shouldOffer)
    }

    @Test
    func differentInstalledBuildStillOffersReplacement() {
        let installedIdentity = ApplicationMover.ApplicationIdentity(
            bundleIdentifier: "sh.vibetunnel.vibetunnel",
            buildVersion: "90")
        let shouldOffer = self.shouldOffer(
            bundlePath: "/Volumes/VibeTunnel/VibeTunnel.app",
            installedIdentities: ["/Applications/VibeTunnel.app": installedIdentity],
            isRunningFromDMG: true)

        #expect(shouldOffer)
    }

    @Test
    func newerInstalledBuildSuppressesDowngradeOffer() {
        let installedIdentity = ApplicationMover.ApplicationIdentity(
            bundleIdentifier: "sh.vibetunnel.vibetunnel",
            buildVersion: "110")
        let shouldOffer = self.shouldOffer(
            bundlePath: "/Volumes/VibeTunnel/VibeTunnel.app",
            installedIdentities: ["/Applications/VibeTunnel.app": installedIdentity],
            isRunningFromDMG: true)

        #expect(!shouldOffer)
    }

    private func shouldOffer(
        bundlePath: String,
        installedIdentities: [String: ApplicationMover.ApplicationIdentity] = [:],
        isRunningFromDMG: Bool = false) -> Bool
    {
        ApplicationMover.shouldOfferToMove(
            bundlePath: bundlePath,
            appName: "VibeTunnel",
            currentIdentity: self.currentIdentity,
            homeDirectory: self.homeDirectory,
            installedIdentity: { installedIdentities[$0] },
            isRunningFromDMG: { _ in isRunningFromDMG })
    }
}
