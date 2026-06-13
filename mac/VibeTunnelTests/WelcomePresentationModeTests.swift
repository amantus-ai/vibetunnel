import Testing
@testable import VibeTunnel

@Suite("Welcome presentation mode")
struct WelcomePresentationModeTests {
    @Test("First launch uses the full onboarding flow")
    func firstLaunch() {
        let mode = WelcomePresentationMode.automatic(storedWelcomeVersion: 0)

        #expect(mode == .full)
        #expect(mode.pageCount == 9)
        #expect(mode.showsPageIndicators)
        #expect(mode.opensSettingsOnFinish)
    }

    @Test("Returning users see only CLI maintenance", arguments: [1, 4, 5])
    func returningUser(storedWelcomeVersion: Int) {
        let mode = WelcomePresentationMode.automatic(storedWelcomeVersion: storedWelcomeVersion)

        #expect(mode == .cliMaintenance)
        #expect(mode.pageCount == 1)
        #expect(!mode.showsPageIndicators)
        #expect(!mode.opensSettingsOnFinish)
    }
}
